import "server-only";
import { z } from "zod";
import type { PickerItem } from "@/lib/inventory/types";
import { AI_MODEL, AI_RESPONSE_SCHEMA, buildCatalog, resolveRequests, systemInstruction, textRequests } from "./ai-prompt";
import { aiAnswerSchema, resolveRows, toImportRows, type AiLine } from "./ai-rows";
import { geminiTurn, retryAfterMs, waitFor } from "./gemini-limit";
import { excelRows, extractCandidates, IMPORT_MAX_ROWS, type ImportKind } from "./extract";
import { matchCandidates, type ImportRow } from "./match";
import type { ImportCandidate } from "./parse-lines";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`;
/**
 * The whole AI read, retries included; after that the standard reader takes over. Text and tables
 * get longer (the standard reader is instant for them); a PDF or photo leaves time for OCR.
 */
const TIMEOUT_MS = { text: 95_000, scan: 75_000 };
// Two parts at a time: the free tier allows 15 requests a minute (see gemini-limit.ts).
const PARALLEL_REQUESTS = 2;
const MAX_LINES = 1_000;
const MAX_LINE_CHARS = 500;
/** About 500k tokens: an inventory too big for one request is left to the standard reader. */
const MAX_PROMPT_CHARS = 2_000_000;
/** Pictures larger than this (pixels per side) are shrunk, to stay well within the request size. */
const MAX_IMAGE_SIDE = 3_000;
/** Pictures Gemini reads as they are; others (BMP, GIF, TIFF) are sent as PNG. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
/** `ai`: the AI took part (false: the standard reader's lines, with no AI answer needed or to be had). */
type AiRead = { rows: ImportRow[]; text: string; note?: string; ai: boolean };

/**
 * The standard reader's lines of a document with text, matched to the inventory; null for a
 * picture or a scanned PDF (no text to read exactly), or when it finds no item lines.
 */
async function standardRead(buf: Buffer, kind: ImportKind, inventory: PickerItem[]) {
  const judge = (c: ImportCandidate[]) => matchCandidates(c, inventory).reduce((s, r) => s + (r.status === "matched" ? 2 : r.status === "check" ? 1 : 0), 0);
  const read = await extractCandidates(buf, kind, judge, { ocr: false });
  if (read.ocr || !read.candidates.length) return null;
  return { rows: matchCandidates(read.candidates, inventory), text: read.text, ...(read.note ? { note: read.note } : {}) };
}

/** A line as the AI is given it: the item as written, then its length and the customer's note. */
const describeRow = (r: ImportRow) => [r.text, r.length ? `length: ${r.length}` : "", r.note ? `note: ${r.note}` : ""].filter(Boolean).join(" | ");

const envelopeSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).optional() }).optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

const cleanLines = (lines: string[]) =>
  lines
    .map((l) => l.replace(/\t/g, " | ").replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS))
    .filter((l) => /[a-z0-9]/i.test(l.replace(/\|/g, "")))
    .slice(0, MAX_LINES);

/** The document as requests to the AI (text is split into parts; a PDF or picture goes whole), and its text when it has one. */
async function documentRequests(buf: Buffer, kind: ImportKind, mime: string): Promise<{ requests: Part[][]; text: string }> {
  if (kind === "excel") {
    const lines = cleanLines((await excelRows(buf)).map((r) => r.map((c) => c.trim()).join(" | ")));
    return { requests: textRequests(lines).map((t) => [{ text: t }]), text: lines.join("\n") };
  }
  if (kind === "text" || kind === "csv") {
    const lines = cleanLines(buf.toString("utf8").split(/\r?\n/));
    return { requests: textRequests(lines).map((t) => [{ text: t }]), text: lines.join("\n") };
  }
  let type = kind === "pdf" ? "application/pdf" : mime;
  let data = buf;
  if (kind === "image" && !IMAGE_TYPES.has(type)) {
    const sharp = (await import("sharp")).default;
    data = await sharp(buf).resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    type = "image/png";
  }
  return { requests: [[{ text: "The customer's document is attached." }, { inlineData: { mimeType: type, data: data.toString("base64") } }]], text: "" };
}

/**
 * One request to Gemini, in its turn under the free tier's per-minute limit; one retry when it is
 * busy (after the wait Google asks for) or the network drops.
 */
async function ask(key: string, system: string, parts: Part[], signal: AbortSignal): Promise<AiLine[]> {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: AI_RESPONSE_SCHEMA,
      // "low" gave different verdicts for the same line from run to run; "medium" was steady.
      thinkingConfig: { thinkingLevel: "medium" },
      maxOutputTokens: 32_768,
    },
  });
  for (let attempt = 0; ; attempt++) {
    const retry = attempt === 0 && !signal.aborted;
    let res: Response;
    try {
      await geminiTurn(signal);
      res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body, signal });
    } catch (e) {
      if (retry && !signal.aborted) continue;
      throw e;
    }
    if ((res.status === 429 || res.status >= 500) && retry) {
      const wait = res.status === 429 ? await retryAfterMs(res) : (await res.body?.cancel(), 1500);
      await waitFor(wait, signal);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const reply = envelopeSchema.parse(await res.json());
    const candidate = reply.candidates?.[0];
    if (candidate?.finishReason !== "STOP") throw new Error(`Gemini gave no full answer (${candidate?.finishReason ?? reply.promptFeedback?.blockReason ?? "empty"})`);
    const json = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    return aiAnswerSchema.parse(JSON.parse(json)).lines;
  }
}

/**
 * Runs `fn` over `items`, a few at a time, keeping their order. The first failure stops the rest
 * (their requests are cancelled): one unread part means the AI's reading is not used at all.
 */
async function inParallel<T, R>(items: T[], limit: number, signal: AbortSignal, fn: (item: T, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  const stop = new AbortController();
  const both = AbortSignal.any([signal, stop.signal]);
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length && !both.aborted) {
      const i = next++;
      out[i] = await fn(items[i], both);
      done++;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  } catch (e) {
    stop.abort();
    throw e;
  }
  if (done < items.length) throw new Error("The AI read was stopped (time limit).");
  return out;
}

/**
 * Reads an enquiry with the AI (Gemini) and matches it to the inventory. Returns null when the
 * AI is not set up, fails or finds nothing: the standard reader then reads the file as before.
 */
export async function readWithAi(buf: Buffer, kind: ImportKind, mime: string, inventory: PickerItem[]): Promise<AiRead | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || !inventory.length) return null;
  try {
    const catalog = buildCatalog(inventory);
    const system = systemInstruction(catalog);
    if (system.length > MAX_PROMPT_CHARS) return null;

    // A document with text (Excel, CSV, text, a PDF with a text layer): the standard reader reads
    // every line exactly as written, and the AI only matches the lines it could not match for sure.
    // The AI can't change what the customer wrote, and far fewer requests are sent.
    if (kind !== "image") {
      const std = await standardRead(buf, kind, inventory);
      if (std) {
        const reds = std.rows.flatMap((r, i) => (r.status === "matched" ? [] : [i]));
        if (!reds.length) return { ...std, ai: false };
        try {
          const requests = resolveRequests(reds.map((i) => `${i + 1}: ${describeRow(std.rows[i])}`)).map((t) => [{ text: t }]);
          const answers = (await inParallel(requests, PARALLEL_REQUESTS, AbortSignal.timeout(TIMEOUT_MS.text), (parts, s) => ask(key, system, parts, s))).flat();
          return { ...std, rows: resolveRows(std.rows, answers, catalog), ai: true };
        } catch (e) {
          console.error("import: AI matching failed, the standard reader's lines are used:", (e instanceof Error ? e.message : String(e)).slice(0, 300));
          return { ...std, ai: false };
        }
      }
    }

    const doc = await documentRequests(buf, kind, mime);
    if (!doc.requests.length) return null;
    const signal = AbortSignal.timeout(kind === "pdf" || kind === "image" ? TIMEOUT_MS.scan : TIMEOUT_MS.text);
    const lines = (await inParallel(doc.requests, PARALLEL_REQUESTS, signal, (parts, s) => ask(key, system, parts, s))).flat();
    if (!lines.length) return null;
    const kept = lines.slice(0, IMPORT_MAX_ROWS);
    return {
      ai: true,
      rows: toImportRows(kept, catalog),
      text: doc.text || kept.map((l) => (l.qty != null ? `${l.source}  ${l.qty}` : l.source)).join("\n"),
      note: lines.length > kept.length ? `Only the first ${IMPORT_MAX_ROWS} items were read.` : undefined,
    };
  } catch (e) {
    console.error("import: AI reader failed, the standard reader is used:", (e instanceof Error ? e.message : String(e)).slice(0, 300));
    return null;
  }
}
