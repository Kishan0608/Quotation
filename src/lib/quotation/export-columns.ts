import { STANDARD_COLUMNS, type ExtraColumn, type QuoteDocument, type QuoteHeader, type QuoteLine, type StandardColumn } from "./types";

export type ExportColumnKind = "index" | "text" | "qty" | "weight" | "money" | "totalWeight" | "amount";

export type ExportColumn = {
  key: string;
  header: string;
  kind: ExportColumnKind;
  /** Excel column width in characters. */
  width: number;
  /** PDF width in mm, "auto" = take the remaining space. */
  pdfWidth: number | "auto";
  align: "left" | "center" | "right";
  value?: (line: QuoteLine) => string | number | null;
};

/** Column id on the sheet (the key of `QuoteLine.fmt`) for an export column. */
export const sheetColumnId = (c: Pick<ExportColumn, "key">) => (c.key === "index" ? "idx" : c.key);

/**
 * Merged cells of a line in export column positions: start index -> last index.
 * Only text cells are merged, so the numbers under a merge (and the totals) stay intact.
 */
export function exportMerges(line: QuoteLine, cols: ExportColumn[]) {
  const out = new Map<number, number>();
  cols.forEach((c, i) => {
    const to = line.fmt?.[sheetColumnId(c)]?.merge;
    if (!to) return;
    const end = cols.findIndex((x) => sheetColumnId(x) === to);
    if (end <= i || [...out].some(([s, e]) => i >= s && i <= e)) return;
    if (cols.slice(i + 1, end + 1).every((x) => x.kind === "text" || x.kind === "index")) out.set(i, end);
  });
  return out;
}

/** "RMB/PCS" for a CNY quotation, otherwise e.g. "INR/PCS". */
export const pricePerPieceLabel = (currency: string) => `${currency === "CNY" ? "RMB" : currency}/PCS`;

/** Spreadsheet column letter: 0 = A, 25 = Z, 26 = AA ... */
export function sheetColLetter(n: number) {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

type SheetSlot = { kind: "std"; id: StandardColumn } | { kind: "extra"; col: ExtraColumn; index: number };

/**
 * Column order of the sheet (and the downloads): the standard columns minus deleted ones,
 * each followed by the extra columns inserted right after it; the other extra columns at the end.
 */
export function sheetColumnOrder(header: Pick<QuoteHeader, "extra_columns" | "hidden_columns">): SheetSlot[] {
  const hidden = new Set<string>(header.hidden_columns ?? []);
  const extras = (header.extra_columns ?? []).map((col, index) => ({ kind: "extra" as const, col, index }));
  const out: SheetSlot[] = [];
  for (const id of STANDARD_COLUMNS) {
    if (!hidden.has(id)) out.push({ kind: "std", id });
    out.push(...extras.filter((x) => x.col.after === id));
  }
  out.push(...extras.filter((x) => !x.col.after || !STANDARD_COLUMNS.includes(x.col.after)));
  return out;
}

/** Title of an extra column: its own name, or "Column L" style after its letter on the sheet. */
export function extraColumnTitle(header: Pick<QuoteHeader, "extra_columns" | "hidden_columns">, i: number) {
  const name = header.extra_columns[i]?.name.trim();
  if (name) return name;
  // Letter as on the sheet, which doesn't show the No. column.
  const onSheet = sheetColumnOrder(header).filter((s) => !(s.kind === "std" && s.id === "idx"));
  return `Column ${sheetColLetter(onSheet.findIndex((s) => s.kind === "extra" && s.index === i))}`;
}

/** A typed number stays a number in Excel ("1,250.5" -> 1250.5); anything else stays text. */
function extraValue(raw: string | undefined) {
  const v = raw?.trim();
  if (!v) return null;
  if (/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(v)) return Number(v.replace(/,/g, ""));
  return v;
}

/**
 * Columns in the Excel and PDF output, in the sheet's order:
 * No. | Items | WT IN KGS | RMB/PCS | QTY | Total KG | Total Amount | Actual Weight | Note / Length
 * with the extra columns where they sit on the sheet: the file always matches the sheet
 * (columns deleted on the sheet are left out).
 */
export function exportColumns(doc: Pick<QuoteDocument, "company" | "header">): ExportColumn[] {
  const { company, header } = doc;
  const cols: ExportColumn[] = [
    { key: "index", header: "No.", kind: "index", width: 6, pdfWidth: 8, align: "center" },
    { key: "description", header: "Items", kind: "text", width: 34, pdfWidth: "auto", align: "left", value: (l) => l.description },
  ];
  cols.push({ key: "unit_weight_kg", header: "WT IN KGS", kind: "weight", width: 11, pdfWidth: 14, align: "right", value: (l) => l.unit_weight_kg });
  cols.push({ key: "actual_weight", header: "Actual Weight", kind: "text", width: 18, pdfWidth: 22, align: "left", value: (l) => l.actual_weight || null });
  cols.push(
    { key: "unit_price", header: pricePerPieceLabel(company.base_currency), kind: "money", width: 12, pdfWidth: 18, align: "right", value: (l) => l.unit_price ?? 0 },
    { key: "qty", header: "QTY", kind: "qty", width: 10, pdfWidth: 13, align: "right", value: (l) => l.qty ?? 0 },
  );
  cols.push({ key: "total_weight", header: "Total KG", kind: "totalWeight", width: 12, pdfWidth: 16, align: "right" });
  cols.push({ key: "amount", header: "Total Amount", kind: "amount", width: 14, pdfWidth: 19, align: "right" });
  // Wide enough in the PDF for "CONCENTRIC, CS," on one line (narrower splits the word and makes rows tall).
  cols.push({ key: "remarks", header: "Note / Length", kind: "text", width: 16, pdfWidth: 24, align: "left", value: (l) => l.remarks || null });
  const byKey = new Map(cols.map((c) => [c.key === "index" ? "idx" : c.key, c]));
  const shown: ExportColumn[] = [];
  for (const slot of sheetColumnOrder(header)) {
    if (slot.kind === "std") {
      const c = byKey.get(slot.id);
      const title = header.column_titles?.[slot.id]?.trim(); // renamed on the sheet
      if (c) shown.push(title ? { ...c, header: title } : c);
    } else {
      const key = slot.col.key;
      shown.push({ key: `x:${key}`, header: extraColumnTitle(header, slot.index), kind: "text", width: 14, pdfWidth: 18, align: "left", value: (l) => extraValue(l.extra?.[key]) });
    }
  }
  return shown;
}

/**
 * The download's name: the customer's company and the quotation date, so the files say whose
 * quotation it is and when it was made ("KAMALA_FITTINGS_INDIA_2026-10-31.pdf"). Without a
 * customer, the quotation number.
 */
export function quoteFileName(quoteNo: string, customer: string, date: string, ext: "xlsx" | "pdf", tag = "") {
  const safe = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 60);
  const parts = [safe(customer) || safe(quoteNo) || "Quotation", /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", tag].filter(Boolean);
  return `${parts.join("_")}.${ext}`;
}

/** Triggers a browser download for a generated file (nothing is uploaded or stored). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
