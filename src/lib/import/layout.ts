import { parseLine, readNumber, type ImportCandidate } from "./parse-lines";

/** A word (or text chunk) with its position on the page and how sure the reader is of it (0-100). */
export type Box = { text: string; x0: number; x1: number; y0: number; y1: number; conf: number };

type Col = { x0: number; x1: number; title: string; words: Box[] };

const ITEM_H = /^(items?|item\s*name|item\s*description|description|desc\.?|particulars?|material|product|products|size|name)$/i;
const CODE_H = /^(items?\s*no\.?|item\s*code|item\s*#|code|sku)$/i;
const QTY_H = /^(qty\.?(\s*\/?\s*(pcs|nos)\.?)?|quantity|qnty|pcs|nos\.?|no\.?\s*of\s*pcs)$/i;
const NOTE_H = /^(note|length|remarks?|note\s*\/\s*length)$/i;
const STOP = /^(total|grand\s*total|sub\s*total|amount\s*in\s*words|rupees|terms)/i;

const height = (b: Box) => b.y1 - b.y0;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const cx = (b: { x0: number; x1: number }) => (b.x0 + b.x1) / 2;
const cy = (l: Box[]) => median(l.map((b) => (b.y0 + b.y1) / 2));

/** Puts loose words into text lines (same height on the page), top to bottom, left to right. */
export function groupLines(boxes: Box[]): Box[][] {
  const sorted = boxes.filter((b) => b.text.trim()).sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines: Box[][] = [];
  for (const b of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs((b.y0 + b.y1) / 2 - cy(line)) <= Math.max(2, 0.5 * median(line.map(height)))) line.push(b);
    else lines.push([b]);
  }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

/** Header columns: the header line plus wrapped titles just above/below it ("WT IN" / "KGS"). */
function headerColumns(lines: Box[][], hi: number): Col[] {
  const head = lines[hi];
  const h = median(head.map(height)) || 10;
  const band = lines.filter((l, i) => Math.abs(i - hi) <= 2 && Math.abs(cy(l) - cy(head)) <= 1.1 * h).flat();
  const words = [...band].sort((a, b) => a.x0 - b.x0);
  const group = (gap: number) => {
    const cols: Col[] = [];
    for (const w of words) {
      const last = cols[cols.length - 1];
      if (last && w.x0 <= last.x1 + gap) {
        last.x1 = Math.max(last.x1, w.x1);
        last.words.push(w);
      } else cols.push({ x0: w.x0, x1: w.x1, title: "", words: [w] });
    }
    for (const c of cols) c.title = [...c.words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((w) => w.text).join(" ");
    return cols;
  };
  let cols = group(0.6 * h);
  // Titles that ran together ("No. Items", "QTY Total KG"): split until the item / qty titles stand alone.
  if (!cols.some((c) => ITEM_H.test(c.title)) || !cols.some((c) => QTY_H.test(c.title))) {
    const split: Col[] = [];
    for (const c of cols) {
      const parts = c.words.some((w) => ITEM_H.test(w.text) || QTY_H.test(w.text)) && !CODE_H.test(c.title) && !QTY_H.test(c.title) ? c.words : [c.words];
      for (const p of parts) {
        const ws = Array.isArray(p) ? p : [p];
        split.push({ x0: Math.min(...ws.map((w) => w.x0)), x1: Math.max(...ws.map((w) => w.x1)), title: ws.map((w) => w.text).join(" "), words: ws });
      }
    }
    // "QTY" + "/PCS" belong together again.
    cols = split.reduce<Col[]>((acc, c) => {
      const prev = acc[acc.length - 1];
      if (prev && /^qty/i.test(prev.title) && /^\/?\s*(pcs|nos|pc)\.?$/i.test(c.title)) {
        prev.x1 = c.x1;
        prev.title = `${prev.title} ${c.title}`;
        prev.words.push(...c.words);
      } else acc.push(c);
      return acc;
    }, []);
  }
  return cols;
}

function findHeader(lines: Box[][]) {
  for (let i = 0; i < lines.length; i++) {
    const texts = lines[i].map((b) => b.text.trim());
    const joined = texts.join(" ");
    const hasItem = texts.some((t) => ITEM_H.test(t)) || /\b(item\s*description|description|particulars)\b/i.test(joined);
    const hasQty = texts.some((t) => /^(qty|quantity|qnty|pcs|nos)\b/i.test(t));
    if (hasItem && hasQty) return i;
  }
  return -1;
}

/**
 * Turns the words of a page (from the PDF text or from OCR) into item lines. A table with an
 * item and a quantity heading is read column by column, so the quantity comes from the QTY
 * column (not from a price or an amount); other pages are read line by line.
 */
export function boxesToCandidates(lines: Box[][]): { candidates: ImportCandidate[]; table: boolean } {
  const byLine = () => {
    const candidates: ImportCandidate[] = [];
    for (const l of lines) {
      const c = parseLine(l.map((b) => b.text).join(" "));
      if (c) candidates.push({ ...c, conf: Math.min(...l.map((b) => b.conf)) });
    }
    return { candidates, table: false };
  };
  const hi = findHeader(lines);
  if (hi < 0) return byLine();

  const cols = headerColumns(lines, hi);
  const h = median(lines[hi].map(height)) || 10;
  const itemCol = cols.findIndex((c) => ITEM_H.test(c.title));
  const qtyCol = cols.findIndex((c) => QTY_H.test(c.title));
  const codeCol = cols.findIndex((c, i) => i !== itemCol && CODE_H.test(c.title));
  const noteCol = cols.findIndex((c, i) => i !== itemCol && NOTE_H.test(c.title));
  if (itemCol < 0) return byLine();

  // Column edges: halfway between headings, except around the item column. Item names are
  // left-aligned under a heading that may be centred, so that column starts right after the
  // column before it and reaches up to the next heading.
  const edges = cols.slice(0, -1).map((c, i) =>
    i === itemCol ? cols[i + 1].x0 - 0.2 * h : i + 1 === itemCol ? c.x1 + 0.3 * h : (c.x1 + cols[i + 1].x0) / 2,
  );
  const colOf = (b: Box) => {
    const x = cx(b);
    let i = 0;
    while (i < edges.length && x > edges[i]) i++;
    return i;
  };

  const headerBottom = Math.max(...lines.filter((l) => Math.abs(cy(l) - cy(lines[hi])) <= 1.1 * h).flat().map((b) => b.y1));
  const candidates: ImportCandidate[] = [];
  for (const line of lines) {
    if (cy(line) <= headerBottom) continue;
    const cells: Box[][] = cols.map(() => []);
    for (const b of line) cells[colOf(b)].push(b);
    const text = (i: number) => (i < 0 ? "" : cells[i].map((b) => b.text).join(" ").trim());
    const item = text(itemCol);
    if (STOP.test(item) || STOP.test(line.map((b) => b.text).join(" "))) break;
    if (!item) continue;
    const qtyText = text(qtyCol);
    const qty = qtyCol >= 0 ? readNumber(qtyText) : null;
    const used = [itemCol, codeCol, noteCol].flatMap((i) => (i < 0 ? [] : cells[i]));
    candidates.push({
      text: [text(codeCol), item, text(noteCol)].filter(Boolean).join(" ").slice(0, 200),
      name: item,
      code: text(codeCol) || undefined,
      note: text(noteCol) || undefined,
      qty,
      conf: used.length ? Math.min(...used.map((b) => b.conf)) : undefined,
      qtyConf: qtyCol >= 0 && cells[qtyCol].length ? Math.min(...cells[qtyCol].map((b) => b.conf)) : undefined,
      qtyFromColumn: qtyCol >= 0,
      tableRow: true,
    });
  }
  return { candidates, table: true };
}
