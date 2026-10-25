import type { CellValue, Workbook, Worksheet } from "exceljs";
import { parseNumber } from "../format";
import { cleanActualWeight, cleanNote, cleanSupplierText } from "./clean-text";
import { inventoryItemSchema, MAX_IMPORT_ROWS, type InventoryInput } from "./schema";

export type ImportRow = { row: number; data: InventoryInput };
export type ImportIssue = { row: number; message: string };
export type ImportResult = { sheetName: string; rows: ImportRow[]; issues: ImportIssue[]; truncated: boolean };

type Field = "item_code" | "description" | "weight_kg" | "unit_price" | "stock_qty" | "loading_charges" | "actual_weight" | "note" | "total";

// Header text -> field. Order matters: first match wins for each column.
const HEADER_RULES: [Field, RegExp][] = [
  ["item_code", /^(items?\s*no\.?|item\s*code|code|sku|part\s*no\.?)$/i],
  ["description", /^(items?|description|item\s*name|product|size|specification)$/i],
  ["weight_kg", /^(wt|weight)(\s*(in)?\s*kgs?)?(\s*\/\s*pcs?)?$|^unit\s*w(eigh)?t/i],
  // "QTY /PCS" is a quantity, not a price per piece.
  ["unit_price", /^(rm[bp]|cny|price|rate|unit\s*price)(\s*\/\s*pcs?)?$|^(?!qty|quantity).*\/\s*pcs$/i],
  ["stock_qty", /^(qty|quantity|stock|pcs|nos)(\s*\/\s*pcs)?$/i],
  ["loading_charges", /^loading\s*charges?\W*$/i],
  ["actual_weight", /^actual\s*w(eigh)?t\W*$/i],
  // NOTE and LENGTH are the same column (标准, 1280MM, CONCENTRIC…); sheets use either header.
  ["note", /^(note|notes|remark|remarks|length|note\s*\/\s*length|length\s*\/\s*note)$/i],
  // Only used to find the unlabeled actual-weight column (see below).
  ["total", /^total$/i],
];

export function cellToValue(value: CellValue): string | number | null {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) {
      const r = (value as { result?: unknown }).result;
      return typeof r === "number" || typeof r === "string" ? r : null;
    }
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text);
    if ("error" in value) return null;
  }
  return null;
}

function text(value: CellValue) {
  const v = cellToValue(value);
  return v == null ? "" : String(v).trim();
}

function findHeader(ws: Worksheet) {
  const maxScan = Math.min(ws.rowCount, 15);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const map = new Map<Field, number>();
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const header = text(cell.value).replace(/\s+/g, " ");
      for (const [field, re] of HEADER_RULES) {
        if (!map.has(field) && re.test(header)) {
          map.set(field, col);
          break;
        }
      }
    });
    if (map.has("description")) return { headerRow: r, columns: map };
  }
  return null;
}

/**
 * Reads the first worksheet that has an "ITEMS"/"Description" header (like
 * the supplier loading plan) and turns every row into a validated inventory
 * item with the same columns: ITEMS NO., ITEMS, WT IN KGS, RMB/PCS, QTY,
 * LOADING CHARGES, Actual Weight, NOTE (or LENGTH).
 */
export function parseInventoryWorkbook(workbook: Workbook): ImportResult {
  for (const ws of workbook.worksheets) {
    const header = findHeader(ws);
    if (!header) continue;

    const rows: ImportRow[] = [];
    const issues: ImportIssue[] = [];
    let truncated = false;
    // Most sheets write the actual weight without a header in the column after TOTAL
    // (two columns after LOADING CHARGES when TOTAL has no header either).
    const unlabeledActual = header.columns.has("actual_weight")
      ? undefined
      : header.columns.has("total")
        ? header.columns.get("total")! + 1
        : header.columns.has("loading_charges")
          ? header.columns.get("loading_charges")! + 2
          : undefined;
    const actualIsUnlabeled = unlabeledActual != null;
    const col = (f: Field) => (f === "actual_weight" && actualIsUnlabeled ? unlabeledActual : header.columns.get(f));

    for (let r = header.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (f: Field) => {
        const c = col(f);
        return c ? cellToValue(row.getCell(c).value) : null;
      };

      const rawDescription = get("description");
      if (rawDescription == null || String(rawDescription).trim() === "") continue; // blank / totals row
      if (rows.length >= MAX_IMPORT_ROWS) {
        truncated = true;
        break;
      }

      const weight = parseNumber(get("weight_kg"));
      const price = parseNumber(get("unit_price"));
      const qty = parseNumber(get("stock_qty"));
      // Sheets with several containers repeat the title and header rows between
      // them; those rows have no numbers at all.
      if (weight == null && price == null && qty == null) continue;

      const description = cleanSupplierText(String(rawDescription));
      const rawNote = get("note");
      let rawActual = get("actual_weight");
      if (actualIsUnlabeled && !/\d.*MM/i.test(String(rawActual ?? ""))) rawActual = null;

      const candidate = {
        item_code: get("item_code"),
        description,
        weight_kg: weight,
        unit_price: price,
        stock_qty: qty ?? 0,
        loading_charges: parseNumber(get("loading_charges")) ?? 0,
        actual_weight: cleanActualWeight(rawActual == null ? null : String(rawActual)),
        note: cleanNote(rawNote == null ? null : String(rawNote)),
      };

      const result = inventoryItemSchema.safeParse(candidate);
      if (result.success) rows.push({ row: r, data: result.data });
      else issues.push({ row: r, message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    }

    return { sheetName: ws.name, rows, issues, truncated };
  }
  return { sheetName: "", rows: [], issues: [{ row: 0, message: "No sheet with an ITEMS / Description header was found." }], truncated: false };
}
