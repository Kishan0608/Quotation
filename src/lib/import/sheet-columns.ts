import type { Workbook, Worksheet } from "exceljs";
import { cellToValue } from "../inventory/excel-import";

/** Which column (1 = A) holds each field, read from the header row `headerRow` of `sheet`. */
export type ColumnChoice<F extends string> = { sheet: string; headerRow: number; columns: Partial<Record<F, number>> };

/** The top of a sheet as text, for the AI and for the column pickers. */
export type SheetTop = { sheet: string; rows: string[][] };

export const TOP_ROWS = 12;
export const TOP_COLS = 26;

const cellText = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, 60));

/** "A".."Z", "AA".. */
export function columnLetter(n: number) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function sheetTop(ws: Worksheet, rows = TOP_ROWS, cols = TOP_COLS): string[][] {
  const out: string[][] = [];
  for (let r = 1; r <= Math.min(ws.rowCount, rows); r++) {
    const row = ws.getRow(r);
    out.push(Array.from({ length: Math.min(Math.max(ws.columnCount, 1), cols) }, (_, i) => cellText(cellToValue(row.getCell(i + 1).value))));
  }
  return out;
}

/** The visible sheets that have something in them, top rows as text. */
export function workbookTops(workbook: Workbook): SheetTop[] {
  return workbook.worksheets.filter((ws) => ws.state !== "hidden" && ws.state !== "veryHidden" && ws.rowCount > 0).map((ws) => ({ sheet: ws.name, rows: sheetTop(ws) }));
}

/**
 * The rules' columns with the AI's filling the gaps: a column the rules found is kept (they read
 * the headers exactly); a field they missed takes the AI's column when no other field uses it.
 */
export function fillGaps<F extends string>(rules: ColumnChoice<F> | null, ai: ColumnChoice<F> | null): ColumnChoice<F> | null {
  if (!rules) return ai;
  if (!ai || ai.sheet !== rules.sheet || ai.headerRow !== rules.headerRow) return rules;
  const columns = { ...rules.columns };
  const used = new Set(Object.values(columns));
  for (const [field, col] of Object.entries(ai.columns) as [F, number | undefined][]) {
    if (col && columns[field] == null && !used.has(col)) {
      columns[field] = col;
      used.add(col);
    }
  }
  return { ...rules, columns };
}
