import type { CellFmt, QuoteLine } from "./types";

/** Fonts offered in the sheet's Font box (all common on Windows; Excel and the PDF map them). */
export const FONTS = ["Calibri", "Arial", "Cambria", "Times New Roman", "Georgia", "Segoe UI", "Tahoma", "Verdana", "Courier New"] as const;
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const DEFAULT_FONT = "Calibri";
export const DEFAULT_SIZE = 11;

/** Excel's colour picker: theme colours (the picker adds their tints and shades) and standard colours. */
export const THEME_COLORS = ["#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];
export const STANDARD_COLORS = ["#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050", "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0"];

export type BorderPreset = "bottom" | "top" | "left" | "right" | "none" | "all" | "outside" | "thick";
export type MergeMode = "center" | "across" | "cells" | "unmerge";

/** Drops unset/default values; returns undefined when nothing is left. */
export function cleanFmt(f: CellFmt | undefined): CellFmt | undefined {
  if (!f) return undefined;
  const out: CellFmt = {};
  for (const [k, v] of Object.entries(f) as [keyof CellFmt, CellFmt[keyof CellFmt]][]) {
    if (v === undefined || v === null || v === false || v === 0 || v === "") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Sets (patch) or replaces (`replace`) the format of one cell of a line. */
export function withFmt(line: QuoteLine, colId: string, patch: Partial<CellFmt> | undefined, replace = false): QuoteLine {
  const current = line.fmt?.[colId];
  const nextCell = cleanFmt(replace ? patch : { ...current, ...patch });
  if (JSON.stringify(nextCell) === JSON.stringify(current)) return line;
  const fmt = { ...line.fmt };
  if (nextCell) fmt[colId] = nextCell;
  else delete fmt[colId];
  return { ...line, fmt };
}

/** Font size in screen pixels for an Excel point size. */
export const ptToPx = (pt: number) => Math.round((pt * 96) / 72);
