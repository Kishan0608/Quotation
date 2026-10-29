import "server-only";
import { boxesToCandidates, groupLines, type Box } from "./layout";
import { ocrImage } from "./ocr";
import { parseLine, parseTable, type ImportCandidate } from "./parse-lines";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 300;
const MAX_PDF_PAGES = 10;
const MAX_SCANNED_PAGES = 5;

export type ImportKind = "excel" | "csv" | "text" | "pdf" | "image";

/** What kind of file this is, from its name and type (null = not supported). */
export function importKind(name: string, type: string): ImportKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || type.includes("spreadsheetml")) return "excel";
  if (ext === "csv" || type === "text/csv") return "csv";
  if (ext === "txt" || type === "text/plain") return "text";
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"].includes(ext) || type.startsWith("image/")) return "image";
  return null;
}

function splitCsv(line: string) {
  const sep = line.includes("\t") ? "\t" : line.split(";").length > line.split(",").length ? ";" : ",";
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function excelRows(buf: Buffer) {
  const mod = (await import("exceljs")) as unknown as typeof import("exceljs") & { default?: typeof import("exceljs") };
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const rows: string[][] = [];
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = (cell.text ?? "").toString();
      });
      rows.push(Array.from(cells, (c) => c ?? ""));
    });
  });
  return rows;
}

type PdfDoc = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

/** The words of each PDF page with their positions (top-left origin), as text lines. */
async function pdfPages(pdf: PdfDoc): Promise<Box[][][]> {
  const pages: Box[][][] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_PDF_PAGES); p++) {
    const page = await pdf.getPage(p);
    const { height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boxes: Box[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , d, e, f] = item.transform as number[];
      const h = Math.abs(item.height || d || 8);
      boxes.push({ text: item.str.trim(), x0: e, x1: e + item.width, y0: height - f - h, y1: height - f, conf: 100 });
    }
    pages.push(groupLines(boxes));
  }
  return pages;
}

export type Extracted = { candidates: ImportCandidate[]; text: string; note?: string; ocr: boolean };

/**
 * Reads the item lines (text + quantity) out of an uploaded enquiry list. `judge` scores a set
 * of candidates (how many inventory items they find), so the OCR keeps its better read.
 */
export async function extractCandidates(buf: Buffer, kind: ImportKind, judge: (c: ImportCandidate[]) => number): Promise<Extracted> {
  const limit = (c: ImportCandidate[]) => c.slice(0, IMPORT_MAX_ROWS);
  const scoreLines = (lines: Box[][]) => judge(boxesToCandidates(lines).candidates);
  const fromOcr = async (image: Buffer) => {
    const { lines, text } = await ocrImage(image, scoreLines);
    return { candidates: boxesToCandidates(lines).candidates, text };
  };

  if (kind === "excel") {
    const rows = await excelRows(buf);
    return { candidates: limit(parseTable(rows)), text: rows.map((r) => r.filter(Boolean).join("  ")).join("\n"), ocr: false };
  }
  if (kind === "csv") {
    const rows = buf.toString("utf8").split(/\r?\n/).map(splitCsv);
    return { candidates: limit(parseTable(rows)), text: buf.toString("utf8"), ocr: false };
  }
  if (kind === "text") {
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    // Cells copied from Excel come with tabs: read them as a table (item / QTY columns).
    if (lines.length && lines.filter((l) => l.includes("\t")).length >= lines.length / 2) {
      return { candidates: limit(parseTable(lines.map((l) => l.split("\t")))), text, ocr: false };
    }
    return { candidates: limit(lines.map(parseLine).filter((c): c is ImportCandidate => c != null)), text, ocr: false };
  }
  if (kind === "image") {
    const r = await fromOcr(buf);
    return { candidates: limit(r.candidates), text: r.text, ocr: true };
  }

  // PDF: the text inside it (exact), page by page; a scanned PDF (pictures only) is read with OCR.
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages = await pdfPages(pdf);
  const candidates = pages.flatMap((lines) => boxesToCandidates(lines).candidates);
  const text = pages.map((lines) => lines.map((l) => l.map((b) => b.text).join(" ")).join("\n")).join("\n\n");
  if (judge(candidates) > 0 || text.replace(/\s/g, "").length > 200) return { candidates: limit(candidates), text, ocr: false };

  const scanned: ImportCandidate[] = [];
  const texts: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_SCANNED_PAGES); p++) {
    const png = await renderPageAsImage(pdf, p, { canvasImport: () => import("@napi-rs/canvas"), scale: 3 });
    const r = await fromOcr(Buffer.from(png));
    scanned.push(...r.candidates);
    texts.push(r.text);
  }
  return {
    candidates: limit(scanned),
    text: texts.join("\n\n"),
    ocr: true,
    note: pdf.numPages > MAX_SCANNED_PAGES ? `Only the first ${MAX_SCANNED_PAGES} pages of this scanned PDF were read.` : undefined,
  };
}
