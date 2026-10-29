import type { PickerItem } from "@/lib/inventory/types";
import { parseNpsValue } from "@/lib/pipe/sizes";
import { itemNps } from "./ai-prompt";
import { normalizeName, pipeSize } from "./match";

/** What a line asks for, as the AI read it. */
export type Asked = { source: string; length: string | null; size_inch: string | null };

/** Kinds in the order they are looked for: a REDUCING TEE is a tee, a 45° elbow is not a plain one. */
const KINDS: [string, RegExp][] = [
  ["TEE", /\bTEES?\b/],
  ["CAP", /\bCAPS?\b/],
  ["FLANGE", /FLANGE|\bFLG\b|WELD\s*NECK|SLIP\s*-?\s*ON|\bBLIND\b|\b(SORF|SOFF|BLRF|BLFF|WNRF|WN|SO|BL)\b/],
  ["REDUCER", /\bRED(UCER|UCING|U)?\b|CONCENTRIC|ECCENTRIC|\bCONC?\b|\bECC\b|\bSWAGE/],
  ["180° BEND", /\b180\s*(°|DEG|D\b)|\b180\s*(ELB|BEND)|\bU\s*-?\s*BEND|RETURN\s*BEND/],
  ["45° ELBOW", /\b45\s*(°|DEG|D\b)|\b45\s*(ELB|BEND)|ELBOW\s*45\b/],
  ["1D ELBOW", /\b1\s*D\b|\bSR\b|SHORT\s*RAD/],
];
const ELBOW = /ELBOW|\bELBO\b|\bELL\b|\b90\s*(°|DEG)|\bLR\b/;

/** The kind of fitting a text names (null = it doesn't say). An inventory name with a size and no kind word is a 90° elbow. */
export function kindOf(text: string, isItem: boolean): string | null {
  const t = text.toUpperCase();
  const bend = t.match(/\b([2-9])\s*D\b(?=.*BEND)|\b([2-9])\s*D\s*BEND/);
  for (const [kind, re] of KINDS) if (re.test(t)) return kind;
  if (bend) return `${bend[1] ?? bend[2]}D BEND`;
  if (ELBOW.test(t)) return "ELBOW";
  return isItem && pipeSize(normalizeName(text)) ? "ELBOW" : null;
}

const classOf = (t: string) => {
  const m = t.toUpperCase().match(/\b(?:CL|CLASS)\s*\.?\s*(\d{3,4})\b|\b(\d{3,4})\s*(?:#|LBS?\b)/);
  return m ? (m[1] ?? m[2]) : null;
};

function flangeOf(text: string) {
  const t = text.toUpperCase();
  const type = /\bWN|WELD\s*NECK/.test(t) ? "weld neck" : /\bSO(RF|FF)?\b|SLIP\s*-?\s*ON/.test(t) ? "slip-on" : /\bBL(RF|FF)?\b|BLIND|BLANK|BLNK/.test(t) ? "blind" : null;
  const face = /RTJ|\bRJ\b|RING\s*(TYPE\s*)?JOINT/.test(t) ? "RTJ" : /RF\b|RAISED?\s*FACE/.test(t) ? "raised face" : /FF\b|FLAT\s*FACE/.test(t) ? "flat face" : null;
  return { type, face };
}

const STAINLESS = /STAINLESS|\bSS\b|\bSS\s*\d{3}|\b[FP]?3(04|16|21|47)L?H?\b|\bTP\s*3\d\d|\bA182\s*F3|\bA312\b|\bA403\b|DUPLEX/;

const centricOf = (t: string) => (/\bE?CC?ENTRIC\b|\bECC\b/.test(t.toUpperCase()) ? "ECCENTRIC" : /\bCONC?(ENTRIC)?\b/.test(t.toUpperCase()) ? "CONCENTRIC" : null);

const mmLength = (t: string | null) => t?.trim().match(/^(\d+(?:\.\d+)?)\s*MM$/i)?.[1] ?? null;

/** The size a line starts with, after a row number or bullet ("1. 114X3.5MM", "- 4" SCH40"). */
const sizeOfLine = (source: string) => pipeSize(normalizeName(source.replace(/^\s*(\(?\d{1,3}[.)]|[-•*#])\s+/, "")));

/**
 * Why an inventory item is not what a line asks for, from what both say outright: the nominal size,
 * the wall, the kind, a flange's class, type and facing, stainless steel, a reducer's type and a
 * length in mm. Null when nothing disagrees (what neither says is left to the AI).
 */
export function conflict(asked: Asked, item: PickerItem): string | null {
  const name = item.description;
  const note = item.note ?? "";

  const want = parseNpsValue(asked.size_inch);
  const has = parseNpsValue(itemNps(name));
  if (want != null && has != null && Math.abs(want - has) > 1e-6) return `the file asks for ${asked.size_inch}", the item is ${itemNps(name)}"`;

  const lineSize = sizeOfLine(asked.source);
  const itemSize = pipeSize(normalizeName(name));
  if (lineSize?.wall != null && itemSize?.wall != null && lineSize.family === itemSize.family && Math.abs(lineSize.wall - itemSize.wall) > 0.001) {
    return `the wall differs (${lineSize.wall} mm in the file, ${itemSize.wall} mm in the item)`;
  }

  const kindWanted = kindOf(asked.source, false);
  const kindHas = kindOf(name, true);
  if (kindWanted && kindHas && kindWanted !== kindHas) return `the file asks for a ${kindWanted}, the item is a ${kindHas}`;

  const classWanted = classOf(asked.source);
  const classHas = classOf(name);
  if (classWanted && classHas && classWanted !== classHas) return `the file asks for class ${classWanted}, the item is class ${classHas}`;

  if (kindWanted === "FLANGE" && kindHas === "FLANGE") {
    const a = flangeOf(asked.source);
    const b = flangeOf(name);
    if (a.type && b.type && a.type !== b.type) return `the file asks for a ${a.type} flange, the item is ${b.type}`;
    if (a.face && b.face && a.face !== b.face) return `the file asks for ${a.face}, the item is ${b.face}`;
  }

  if (STAINLESS.test(asked.source.toUpperCase()) && !STAINLESS.test(`${name} ${note}`.toUpperCase())) return "the file asks for stainless steel, the item doesn't say so";

  const centricWanted = centricOf(`${asked.source} ${asked.length ?? ""}`);
  const centricHas = centricOf(note);
  if (centricWanted && centricHas && centricWanted !== centricHas) return `the file asks for ${centricWanted}, the item is ${centricHas}`;

  const lengthWanted = mmLength(asked.length);
  const lengthHas = mmLength(note) ?? (/^STANDARD$/i.test(note.trim()) ? "Standard" : null);
  if (lengthWanted && lengthHas && lengthWanted !== lengthHas) return `the file asks for ${lengthWanted}MM long, the item is ${lengthHas === "Standard" ? "Standard" : `${lengthHas}MM`}`;

  return null;
}
