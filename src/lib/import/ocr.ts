import "server-only";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "tesseract.js";
import type { Box } from "./layout";

/**
 * OCR for photos, screenshots and scanned PDFs. The picture is cleaned up first (turned upright,
 * enlarged so the letters are big enough, grey, contrast stretched, sharpened), read with word
 * positions, and - when that read is weak - read again from an "evened out" copy that removes
 * shadows and uneven light (phone photos). The better of the two reads wins.
 */

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      // The English data (~10 MB) is downloaded once and kept in the server's temp folder.
      return createWorker("eng", OEM.LSTM_ONLY, { cachePath: join(tmpdir(), "quotation-ocr") });
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** One OCR job at a time (the reader's settings are shared). */
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

type Prepared = { png: Buffer; scale: number };

/**
 * The same picture with the table's ruling lines painted white: long dark runs across (more than
 * an eighth of the width) or down (more than a twentieth of the height). Cell borders around
 * small text make the reader lose whole rows.
 */
async function withoutGrid(png: Buffer) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const out = Buffer.from(data);
  const dark = (i: number) => data[i] < 110;
  const paint = (x: number, y: number) => {
    if (x >= 0 && x < w && y >= 0 && y < h) out[y * w + x] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0, run = 0; x <= w; x++) {
      if (x < w && dark(y * w + x)) run++;
      else {
        if (run > w * 0.12) for (let k = x - run; k < x; k++) for (let d = -1; d <= 1; d++) paint(k, y + d);
        run = 0;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0, run = 0; y <= h; y++) {
      if (y < h && dark(y * w + x)) run++;
      else {
        if (run > h * 0.05) for (let k = y - run; k < y; k++) for (let d = -1; d <= 1; d++) paint(x + d, k);
        run = 0;
      }
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

async function prepare(input: Buffer, mode: "clean" | "even" | "grid"): Promise<Prepared> {
  const sharp = (await import("sharp")).default;
  const base = sharp(input, { failOn: "none", limitInputPixels: 80_000_000 }).rotate().flatten({ background: "#ffffff" });
  const meta = await base.metadata();
  const w = meta.autoOrient?.width ?? meta.width ?? 1200;
  // Letters read best at ~30 px high: screenshots and small photos are enlarged, big phone
  // photos are brought down to a size that reads fast.
  const target = Math.round(w < 1000 ? w * 3 : w < 1600 ? w * 2 : Math.min(w, 3200));
  const grey = await base.resize({ width: target, kernel: "lanczos3" }).grayscale().toBuffer();
  if (mode === "clean" || mode === "grid") {
    const clean = await sharp(grey).normalize().sharpen({ sigma: 1 }).png().toBuffer();
    return { png: mode === "grid" ? await withoutGrid(clean) : clean, scale: target / w };
  }
  // Divide by a heavily blurred copy: the page background becomes even white (shadows gone).
  const background = await sharp(grey).blur(Math.max(8, target / 80)).negate().toBuffer();
  const even = await sharp(grey).composite([{ input: background, blend: "colour-dodge" }]).normalize().sharpen({ sigma: 1 }).png().toBuffer();
  return { png: even, scale: target / w };
}

type Read = { lines: Box[][]; text: string; confidence: number };

/**
 * Table borders and shadows come out as stray marks on the edges of words ("“Items", "QTY]",
 * "250)", "1000,"). They are taken off; an inch mark after a number ("12\"") stays.
 */
export function cleanWord(raw: string) {
  // A list number ("2)", "3.") stays as it is.
  if (/^\d{1,3}[.)]$/.test(raw.trim())) return raw.trim();
  let t = raw.trim().replace(/^[“”"'‘’`|\[\]{}()_~,;:]+/, "").replace(/[\]|}{,;:“”‘’`_~]+$/, "");
  if (t.endsWith(")") && !t.includes("(")) t = t.slice(0, -1);
  if (t.endsWith("'") && !/\d'$/.test(t)) t = t.slice(0, -1);
  return /^[|\-–—=_.]+$/.test(t) ? "" : t;
}

async function read(png: Buffer): Promise<Read> {
  const worker = await getWorker();
  return exclusive(async () => {
    const { PSM } = await import("tesseract.js");
    // One block of text with the spacing kept: table rows stay whole lines.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1", user_defined_dpi: "300" });
    const { data } = await worker.recognize(png, { rotateAuto: true }, { text: true, blocks: true });
    const lines: Box[][] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const words = line.words
            .map((w) => ({ text: cleanWord(w.text), x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, conf: Math.round(w.confidence) }))
            .filter((w) => w.text);
          if (words.length) lines.push(words);
        }
      }
    }
    return { lines, text: data.text ?? "", confidence: data.confidence ?? 0 };
  });
}

/**
 * Reads a picture. `judge` scores a read (e.g. how many inventory items it found); a weak first
 * read gets a second try from the evened-out copy and the higher score is kept.
 */
export async function ocrImage(input: Buffer, judge: (lines: Box[][]) => number): Promise<{ lines: Box[][]; text: string }> {
  const first = await read((await prepare(input, "clean")).png);
  const firstScore = judge(first.lines);
  if (first.confidence >= 88 && firstScore > 0) return first;
  // A weak read: try an evened-out copy (phone photos) and one without the table's lines
  // (small text in boxed cells), and keep the best.
  let best = { read: first, score: firstScore };
  for (const mode of ["even", "grid"] as const) {
    const next = await read((await prepare(input, mode)).png);
    const score = judge(next.lines);
    if (score > best.score || (score === best.score && next.confidence > best.read.confidence)) best = { read: next, score };
  }
  return best.read;
}
