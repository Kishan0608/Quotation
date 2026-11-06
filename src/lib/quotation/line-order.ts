import { centricOf, kindOf } from "@/lib/import/ai-checks";
import { nominalSize, normalizeName, orderText, pipeSize } from "@/lib/import/match";
import { parseNpsValue } from "@/lib/pipe/sizes";
import { isBlankLine } from "./calc";
import type { QuoteLine } from "./types";

/*
 * The standard order of a quotation's lines (the user's, 2026-11-02):
 *   1. elbows: B / C class (wall in mm) by size, B before C at each size (1" B, 1" C, 2" B, 2" C),
 *      then SCH40 by size (STD with it), then SCH80 by size (XS with it); other schedules go by
 *      wall (SCH10 / SCH20 before SCH40, SCH160 after SCH80);
 *   2. 1D, 45° and 180° elbows, then bends, each in the same order;
 *   3. reducers: eccentric, then concentric;
 *   4. tees; then caps, pipes and flanges.
 * Lines that name no fitting keep their order after those; empty rows go last.
 */

/** Kinds in quotation order, as kindOf names them ("BEND" = any 3D / 5D bend). */
const KIND_ORDER = ["ELBOW", "1D ELBOW", "45° ELBOW", "180° BEND", "BEND", "REDUCER", "TEE", "CAP", "PIPE", "FLANGE"];
const UNKNOWN = KIND_ORDER.length;
const REDUCER = KIND_ORDER.indexOf("REDUCER");

/** Wall blocks after B / C class (0), thin to thick: STD sorts with SCH40, XS with SCH80. */
const SCHEDULE_BLOCK: Record<string, number> = {
  "5S": 1, "10S": 2, "10": 3, "20": 4, "30": 5,
  "40S": 6, STD: 6, "40": 6,
  "60": 7,
  "80S": 8, XS: 8, "80": 8,
  "100": 9, "120": 10, "140": 11, "160": 12, XXS: 13,
};
const NO_WALL = 14;

/** "B CLASS", "C-CLASS", "CLASS B" (orderText reads "B/2.5 MM" as "B CLASS"). */
const CLASS_LETTER = /\b([A-D])\s*[-/]?\s*CLASS\b|\bCLASS\s*[-:]?\s*([A-D])\b/i;

/** The kind a line's words name: kindOf's, plus "EQTEE", a bend with no radius and a reducer known by its Note / Length. */
function kindNamed(text: string, remarks: string) {
  const kind = kindOf(text, false);
  // 114XSCH40(OIL PIPE) is an elbow for oil pipe.
  if (kind) return kind === "PIPE" && /\bOIL\s*PIPE/i.test(text) ? "ELBOW" : kind;
  if (/\b(?:EQ|UNEQ)TEES?\b/i.test(text)) return "TEE";
  // 3"X11/2"X4MM with ECCENTRIC as its length.
  if (centricOf(remarks)) return "REDUCER";
  return /\bBE(?:ND|DN)S?\b/i.test(text) ? "BEND" : null;
}

/** The size a name starts with: "114X3.5MM", "2"XSCH40", and 114XSCH40 = 4"XSCH40. */
function sizeAtStart(text: string) {
  const name = normalizeName(text);
  const od = name.match(/^(\d{2,4}(?:\.\d+)?)(?=X(?:SCH|STD|XXS|XS))/);
  const nps = od ? nominalSize(Number(od[1])) : null;
  return od && nps != null ? pipeSize(`${nps}"${name.slice(od[0].length)}`) : pipeSize(name);
}

/** A size further on, in a name that says its kind: "90° Elbow LR 30"X8 mm", "TEE D323.9X36.5-WPC". */
function sizeInside(text: string) {
  const inch = text.match(/(?<![\d./])(?:\d+\s\d\/\d|\d*\d\/\d|\d+(?:\.\d+)?)\s*"/);
  const fromInch = inch ? pipeSize(normalizeName(text.slice(inch.index))) : null;
  if (fromInch) return fromInch;
  const mm = text.match(/(?<![\d.])(\d{2,4}(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)/i);
  return mm ? pipeSize(`${mm[1]}X${mm[2]}MM`) : null;
}

/** What a line's name says: the cleaned text, the kind it names and its size. */
function readLine(line: Pick<QuoteLine, "description" | "remarks">) {
  // "D323 .9X36 .5" (a supplier's spacing) is 323.9 x 36.5.
  const read = orderText(line.description.replace(/(\d)\s+\.\s*(?=\d)/g, "$1."));
  // An angle is not a size: "90° Elbow LR 30"X8 mm" is a 30" elbow.
  const text = read.text.replace(/\d+\s*°/g, " ");
  const named = kindNamed(read.text, line.remarks);
  return { read, named, size: sizeAtStart(text) ?? (named ? sizeInside(text) : null) };
}

const inchesOf = (size: NonNullable<ReturnType<typeof readLine>["size"]>) =>
  size.key.endsWith('"') ? Number(size.key.slice(0, -1)) : (size.od ?? Infinity) / 25.4;

/** A line's kind, wall block (B / C class = 0, see SCHEDULE_BLOCK) and size, as the order and the search read them. */
function classify(line: Pick<QuoteLine, "description" | "remarks">) {
  const { read, named, size } = readLine(line);
  // A size with no kind word is a 90° elbow, as the inventory names them.
  const kind = named ?? (size ? "ELBOW" : null);
  const letter = `${read.classNote} ${line.remarks} ${line.description}`.match(CLASS_LETTER);
  // A reducer's wall in mm comes after both sizes: 3"X11/2"X4MM.
  const laterWall = size && size.family == null ? size.rest.match(/X(\d+(?:\.\d+)?)(?:\/\d+(?:\.\d+)?)?MM/) : null;
  const block = size?.family === "mm" || laterWall ? 0 : size?.code ? (SCHEDULE_BLOCK[size.code] ?? NO_WALL) : letter ? 0 : NO_WALL;
  return { read, size, kind, letter, laterWall, block };
}

/** Wall groups for the search: B / C class (wall in mm), SCH40 with STD, SCH80 with XS, other schedules. */
export type WallGroup = "class" | "sch40" | "sch80" | "other";

/**
 * What the search filters on: the kind (as KIND_ORDER names it; every bend is "BEND"), the wall
 * group, and the size in inches (33X2.5MM = 1, 4"X3" REDUCER = 4) and as outside diameter in mm.
 */
export function lineFacts(line: Pick<QuoteLine, "description" | "remarks">) {
  const { size, kind, block } = classify(line);
  const inches = size ? inchesOf(size) : Infinity;
  const wall: WallGroup | null = !kind || block === NO_WALL ? null : block === 0 ? "class" : block === SCHEDULE_BLOCK["40"] ? "sch40" : block === SCHEDULE_BLOCK["80"] ? "sch80" : "other";
  return {
    kind: kind && /^\dD BEND$/.test(kind) ? "BEND" : kind,
    wall,
    inches: Number.isFinite(inches) ? inches : null,
    od: size?.od ?? null,
  };
}

/** Where a line goes: compared number by number; a line that names no fitting keeps its place (`index`). */
function placeOf(line: QuoteLine, index: number): number[] {
  const { read, size, kind, letter, laterWall, block } = classify(line);
  if (!kind) return [UNKNOWN, index];

  const radius = kind.match(/^(\d)D BEND$/);
  const at = KIND_ORDER.indexOf(radius ? "BEND" : kind);
  const centric = at === REDUCER ? ["ECCENTRIC", "CONCENTRIC"].indexOf(read.centric || centricOf(line.remarks) || centricOf(line.description) || "") : 0;
  const nominal = !size ? Infinity : inchesOf(size);
  // Equal tees first, then the branch (a reducer's small end) from large to small, as in B16.9.
  const second = size?.rest.match(/^X(\d*\d\/\d|\d+(?:\.\d+)?)"/);
  const branch = (second ? parseNpsValue(second[1]) : null) ?? nominal;
  return [
    at,
    radius ? Number(radius[1]) : 0,
    centric < 0 ? 2 : centric,
    block,
    nominal,
    -branch,
    size?.wall ?? (laterWall ? Number(laterWall[1]) : Infinity),
    letter ? "ABCD".indexOf((letter[1] ?? letter[2]).toUpperCase()) : 9,
    size?.od ?? Infinity,
  ];
}

function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The lines in the standard order (the same line objects), empty rows last; `lines` itself when nothing moves. */
export function sortLines(lines: QuoteLine[]): QuoteLine[] {
  const placed = lines.filter((l) => !isBlankLine(l)).map((line, i) => ({ line, i, at: placeOf(line, i) }));
  placed.sort(
    (a, b) =>
      compare(a.at, b.at) ||
      // Same kind, size and wall: by name (2"XSCH40 before 2"XSCH40 CTW), then as they were.
      (a.at[0] === UNKNOWN ? 0 : a.line.description.localeCompare(b.line.description, undefined, { numeric: true, sensitivity: "base" })) ||
      a.i - b.i,
  );
  const sorted = [...placed.map((p) => p.line), ...lines.filter((l) => isBlankLine(l))];
  return sorted.every((l, i) => l === lines[i]) ? lines : sorted;
}
