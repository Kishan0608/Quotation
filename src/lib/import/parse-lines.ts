/** One item line found in an uploaded enquiry list: the item text and the quantity (if any). */
export type ImportCandidate = {
  /** The line as read (shown to the user). */
  text: string;
  /** Table rows: the item cell, the code cell and the note / length cell, each on its own. */
  name?: string;
  code?: string;
  note?: string;
  qty: number | null;
  /** How sure the reader (OCR) was of the item text / the quantity, 0-100 (absent = typed text). */
  conf?: number;
  qtyConf?: number;
  /** The quantity was read from a QTY column of a table. */
  qtyFromColumn?: boolean;
  /** A row under an item heading of a table (kept even when it isn't in the inventory). */
  tableRow?: boolean;
};

const num = (s: string) => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A number as written in a table cell, forgiving the usual OCR slips in digits
 * ("5OO" -> 500, "1,2O0" -> 1200, "l00" -> 100). Null when the cell isn't a number.
 */
export function readNumber(cell: string): number | null {
  const s = cell.replace(/\s+/g, "");
  if (!s || !/\d/.test(s)) return null;
  const fixed = s.replace(/[Oo]/g, "0").replace(/[Il|!]/g, "1").replace(/(?<=\d)[Ss]|[Ss](?=\d)/g, "5").replace(/(?<=\d)B|B(?=\d)/g, "8");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(fixed)) return null;
  return num(fixed);
}

const SKIP = /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|total|grand\s*total|sub\s*total|subtotal|amount|page\s+\d+)\b/i;

/**
 * Reads one line of free text ("1. 114XSCH40 - 500 pcs", "F5 114X3.5MM 300MM 200") into the
 * item text and its quantity. Returns null for blank lines, headings and totals.
 */
export function parseLine(line: string): ImportCandidate | null {
  let s = line.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
  if (!s || !/[a-z0-9]/i.test(s)) return null;
  if (SKIP.test(s) || (/\b(item|description|particulars?)\b/i.test(s) && /\b(qty|quantity)\b/i.test(s))) return null;

  let qty: number | null = null;
  const patterns = [
    /\b(?:qty|quantity|nos?\.?)\s*[:=\-]?\s*(\d[\d,]*(?:\.\d+)?)/i, // "Qty: 500", "Nos 20"
    /(?<![x×*.\d])(\d[\d,]*(?:\.\d+)?)\s*(?:pcs|pc|nos|pieces|units|qty)\b\.?/i, // "500 pcs"
    /(?<=[\s,;|:\-])(\d[\d,]*)\s*$/, // a number on its own at the end: "114XSCH40  500"
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (!m) continue;
    const n = num(m[1]);
    if (n == null) continue;
    qty = n;
    s = (s.slice(0, m.index) + " " + s.slice((m.index ?? 0) + m[0].length)).trim();
    break;
  }

  // Leading serial number: "1.", "2)", "3 -", "#4".
  s = s.replace(/^#?\d{1,3}\s*[.):\-]\s+/, "").replace(/^[\s\-–|,;:]+|[\s\-–|,;:]+$/g, "").trim();
  if (!/[a-z0-9]/i.test(s) || s.length < 2) return null;
  return { text: s.slice(0, 200), qty };
}

/** Header names that mark the item and quantity columns of a table. */
const ITEM_HEAD = /^(items?|item\s*name|description|item\s*description|particulars?|material|product|size|name)$/i;
const CODE_HEAD = /^(items?\s*no\.?|item\s*code|code|item\s*#|sku)$/i;
const QTY_HEAD = /^(qty\.?|quantity|qty\s*\/?\s*pcs|pcs|nos\.?|no\.?\s*of\s*pcs)$/i;
const NOTE_HEAD = /^(note|length|size\s*note|note\s*\/\s*length|remarks?)$/i;

/**
 * Reads table rows (Excel / CSV): uses the header row when it names the item and quantity
 * columns ("ITEMS", "QTY"...); otherwise every row is read like a line of text.
 */
export function parseTable(rows: string[][]): ImportCandidate[] {
  const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
  let header = -1;
  let itemCol = -1;
  let qtyCol = -1;
  let codeCol = -1;
  let noteCol = -1;
  for (let r = 0; r < Math.min(rows.length, 20) && header < 0; r++) {
    const cells = rows[r].map(clean);
    const i = cells.findIndex((c) => ITEM_HEAD.test(c));
    if (i < 0) continue;
    header = r;
    itemCol = i;
    qtyCol = cells.findIndex((c) => QTY_HEAD.test(c));
    codeCol = cells.findIndex((c, k) => k !== i && CODE_HEAD.test(c));
    noteCol = cells.findIndex((c, k) => k !== i && NOTE_HEAD.test(c));
  }
  const out: ImportCandidate[] = [];
  if (header < 0) {
    for (const row of rows) {
      const c = parseLine(row.map(clean).filter(Boolean).join(" "));
      if (c) out.push(c);
    }
    return out;
  }
  for (const row of rows.slice(header + 1)) {
    const item = clean(row[itemCol]);
    if (!item || SKIP.test(item)) continue;
    const code = codeCol >= 0 ? clean(row[codeCol]) : "";
    const note = noteCol >= 0 ? clean(row[noteCol]) : "";
    const text = [code, item, note].filter(Boolean).join(" ");
    const qty = qtyCol >= 0 ? readNumber(clean(row[qtyCol])) : null;
    out.push({ text: text.slice(0, 200), name: item, code: code || undefined, note: note || undefined, qty, qtyFromColumn: qtyCol >= 0, tableRow: true });
  }
  return out;
}
