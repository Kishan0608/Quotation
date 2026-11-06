import { parseNumber } from "../format";
import { parseNpsValue } from "../pipe/sizes";
import { isBlankLine, lineAmount } from "./calc";
import { lineFacts, sortLines, type WallGroup } from "./line-order";
import type { QuoteLine } from "./types";

/**
 * The search above the sheet (the user's, 2026-11-06): any text typed (item, note, actual
 * weight), a kind and wall filter (only B / C class, only tees...), and a "from ... to ..."
 * range on size (inches or mm), China price, customer price or row number. Used on the
 * inventory (to add items) and on the quotation's own lines; it only lists them.
 */
export type RangeField = "size" | "od" | "china" | "customer" | "row";
export const RANGE_FIELDS: { id: RangeField; label: string }[] = [
  { id: "size", label: "Size (inch)" },
  { id: "od", label: "Size (mm OD)" },
  { id: "china", label: "China price" },
  { id: "customer", label: "Customer price" },
  { id: "row", label: "Row no." },
];

/** Kinds in the standard order (lineFacts' names). */
export const KIND_FILTERS = [
  { id: "ELBOW", label: "90° elbow" },
  { id: "1D ELBOW", label: "1D elbow" },
  { id: "45° ELBOW", label: "45° elbow" },
  { id: "180° BEND", label: "180°" },
  { id: "BEND", label: "Bend" },
  { id: "REDUCER", label: "Reducer" },
  { id: "TEE", label: "Tee" },
  { id: "CAP", label: "Cap" },
  { id: "PIPE", label: "Pipe" },
  { id: "FLANGE", label: "Flange" },
];

export const WALL_FILTERS: { id: WallGroup; label: string }[] = [
  { id: "class", label: "B / C class (mm)" },
  { id: "sch40", label: "SCH40 / STD" },
  { id: "sch80", label: "SCH80 / XS" },
  { id: "other", label: "Other schedules" },
];

export type LineSearch = { text: string; kind: string; wall: WallGroup | ""; field: RangeField; from: string; to: string };
export const NO_SEARCH: LineSearch = { text: "", kind: "", wall: "", field: "size", from: "", to: "" };

/** A matching line: `index` in the list searched, `row` as the sheet numbers it (row 1 holds the headings). */
export type FoundLine = { line: QuoteLine; index: number; row: number } & ReturnType<typeof lineFacts>;

export type SortKey = "standard" | RangeField | "qty" | "amount" | "weight";

export const isSearching = (s: LineSearch) => Boolean(s.text.trim() || s.kind || s.wall || s.from.trim() || s.to.trim());

/** A bound as typed: inch sizes the way people write them (1/2, 1 1/2, 11/2, 2"), the rest as numbers. */
function bound(raw: string, field: RangeField) {
  const t = raw.trim();
  if (!t) return null;
  return field === "size" ? (parseNpsValue(t) ?? parseNumber(t)) : parseNumber(t.replace(/mm$/i, ""));
}

export function valueOf(found: FoundLine, key: Exclude<SortKey, "standard">): number | null {
  switch (key) {
    case "size":
      return found.inches;
    case "od":
      return found.od;
    case "china":
      return found.line.base_price;
    case "customer":
      return found.line.unit_price;
    case "row":
      return found.row;
    case "qty":
      return found.line.qty;
    case "amount":
      return lineAmount(found.line);
    case "weight":
      return found.line.unit_weight_kg;
  }
}

/** Case, quote marks and spacing don't matter: "2 sch40" finds 2"XSCH40, "b class" a B CLASS note. */
const plain = (s: string) => s.toLowerCase().replace(/["”″'’]/g, "").replace(/\s+/g, " ");

/** The lines with every typed word in their item, note or actual weight, of the kind and wall picked, and their value in the range (either end may be empty). */
export function searchLines(lines: QuoteLine[], s: LineSearch): FoundLine[] {
  const words = plain(s.text).split(" ").filter(Boolean);
  let from = bound(s.from, s.field);
  let to = bound(s.to, s.field);
  if (from != null && to != null && from > to) [from, to] = [to, from];
  return lines.flatMap((line, index) => {
    if (isBlankLine(line)) return [];
    const text = plain(`${line.description} ${line.remarks} ${line.actual_weight}`);
    if (!words.every((w) => text.includes(w))) return [];
    const found: FoundLine = { line, index, row: index + 2, ...lineFacts(line) };
    if ((s.kind && found.kind !== s.kind) || (s.wall && found.wall !== s.wall)) return [];
    if (from == null && to == null) return [found];
    const v = valueOf(found, s.field);
    return v != null && (from == null || v >= from) && (to == null || v <= to) ? [found] : [];
  });
}

/** Sorted by one column (lines without that value last), or in the standard order: the pipe-chart order of a quotation. */
export function sortFound(found: FoundLine[], key: SortKey, dir: "asc" | "desc"): FoundLine[] {
  if (key === "standard") {
    const rank = new Map(sortLines(found.map((f) => f.line)).map((l, i) => [l, i]));
    const sorted = [...found].sort((a, b) => (rank.get(a.line) ?? 0) - (rank.get(b.line) ?? 0));
    return dir === "asc" ? sorted : sorted.reverse();
  }
  return [...found].sort((a, b) => {
    const x = valueOf(a, key);
    const y = valueOf(b, key);
    if (x == null || y == null) return x == null && y == null ? a.index - b.index : x == null ? 1 : -1;
    return (dir === "asc" ? x - y : y - x) || a.index - b.index;
  });
}
