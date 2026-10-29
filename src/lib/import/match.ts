import type { PickerItem } from "@/lib/inventory/types";
import { PIPE_CHART } from "@/lib/pipe/chart-data";
import { SCHEDULES } from "@/lib/pipe/schedules";
import { parseNpsValue } from "@/lib/pipe/sizes";
import type { ImportCandidate } from "./parse-lines";

export type ImportMatch = { item: PickerItem; score: number };

/** Why a line needs a look (shown in red). */
export type ImportIssue =
  | "missing" // nothing like it in the inventory
  | "similar" // several inventory items fit equally well (e.g. other lengths)
  | "size" // the numbers (size / thickness / length) differ from the inventory item
  | "code" // the item code in the file differs from the inventory item
  | "fuzzy" // the name is only similar
  | "qty-missing" // no quantity found
  | "qty-unclear"; // the photo was hard to read at the quantity

export type ImportRow = {
  text: string;
  qty: number | null;
  /** Best inventory matches, best first (at most 6). */
  matches: ImportMatch[];
  /** "matched" = the right item for sure, "check" = a suggestion to confirm, "none" = not found. */
  status: "matched" | "check" | "none";
  issues: ImportIssue[];
  /** A length that came with the line ("440MM", "Standard"): the sheet's Length. */
  length?: string;
  /** The customer's own note ("B CLASS", "galvanised", "with marking"). */
  note?: string;
  /** The AI reader's reason for its verdict (lines read by the AI only). */
  why?: string;
};

/** A note that is really a length (the inventory keeps lengths in its note): "440MM", "6MTRS", "Standard". */
const isLength = (s: string) => /^(\d+(\.\d+)?\s*(MM|M|MTR|MTRS|METERS?)|STANDARD|STD\.?\s*LENGTH|CONCENTRIC|ECCENTRIC)$/i.test(s.trim());

type Section = { kind: string; length: string };
/** A line that already says what kind of fitting it is. */
const FITTING_WORD = /\b(TEE|CAP|REDUCER|BEND|ELBOW|ELL|COUPLING|NIPPLE|FLANGE)\b|°/i;

/**
 * A heading over a block of lines in a purchase order ("MS ELBOW", "MS END CAP", "MS REDUCER
 * CONCENTRIC", "MS LONG BEDN 3D"), as the inventory writes that kind of fitting: elbows have no
 * word, a U bend is 180°, reducers carry CONCENTRIC / ECCENTRIC as their length.
 */
function sectionOf(text: string): Section | null {
  const t = text.toUpperCase().trim();
  if (!t || t.split(/\s+/).length > 6 || /\d\s*("|”|’|'|MM|X\s*\d)|\d{3,}|\d\/\d/.test(t)) return null;
  const ecc = /\bE{1,2}C{1,2}ENTRIC\b|\bECC\b/.test(t);
  // "CON OR ECC" over a sheet with both: reducers, the kind given on each line.
  if (ecc && /\bCONC?(ENTRIC)?\b/.test(t)) return { kind: "REDUCER", length: "" };
  if (ecc) return { kind: "REDUCER", length: "ECCENTRIC" };
  if (/\bCONC?ENTRIC\b|\bREDUCER\b/.test(t)) return { kind: "REDUCER", length: /CONC?ENTRIC/.test(t) ? "CONCENTRIC" : "" };
  if (/\bU\s*-?\s*BEND\b|\bRETURN\s*BEND\b/.test(t)) return { kind: "180°", length: "" };
  if (/\bBEND\b|\bBEDN\b/.test(t)) {
    const radius = t.match(/\b(\d)\s*D\b/);
    return { kind: radius ? `${radius[1]}D BEND` : "BEND", length: "" };
  }
  if (/\bCAP\b/.test(t)) return { kind: "CAP", length: "" };
  if (/\bTEE\b/.test(t)) return { kind: "TEE", length: "" };
  if (/\bELBOW\b|\bELL\b/.test(t)) return { kind: /\b45\b/.test(t) ? "45°" : "", length: "" };
  return null;
}

const UNICODE_FRACTIONS: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4" };

/**
 * An order line written the way people type it, in the inventory's form: 1.1/2’’ -> 1 1/2",
 * ½ -> 1/2, SL/40 -> SCH40, B/2.5 MM -> X 2.5MM (with "B CLASS" as the note).
 */
function orderText(s: string): { text: string; classNote: string; centric: string } {
  let classNote = "";
  let centric = "";
  let text = s
    .replace(/[’‘′´`']{2}|[”“″]/g, '"')
    .replace(/(\d)\s*(?:INCH(?:ES)?|IN)\b/gi, '$1"')
    .replace(/(\d)?\s*([½¼¾])/g, (_, whole: string | undefined, f: string) => `${whole ? `${whole} ` : ""}${UNICODE_FRACTIONS[f]}`)
    .replace(/(\d)\.(\d\/\d)(?=\s*")/g, "$1 $2")
    // Photo slips in a size: "20"Xx18"", "12'x8"" (an apostrophe for the inch mark), "6x3"" (no mark).
    .replace(/(\d"?)\s*[Xx]\s*[Xx]\s*(?=\d)/g, "$1X")
    .replace(/(\d)'(?=\s*[Xx]\s*\d)/g, '$1"')
    .replace(/(?<![\d.\/"])(\d{1,2})\s*[Xx]\s*(?=\d[\d.\/ ]*")/g, '$1" X ')
    // A photo reads S/40 as "s/a0" (4 -> a, 0 -> o).
    .replace(/\b(SL|SCH|S)\s*\/\s*([0-9AOI]{2,3})\b/gi, (w: string, p: string, n: string) => {
      const digits = n.toUpperCase().replace(/A/g, "4").replace(/O/g, "0").replace(/I/g, "1");
      return /^(10|20|30|40|60|80|100|120|140|160)$/.test(digits) ? `${p}/${digits}` : w;
    })
    .replace(/(?<![A-Z])S[T7][DO0](?![A-Z])/gi, "STD")
    .replace(/\b(?:SL|SCH)\s*[\/.\-]?\s*(\d{2,3}S?|STD|XXS|XS)\b|\bS\s*\/\s*(\d{2,3})\b/gi, (_, a: string | undefined, b: string | undefined) => {
      const s = (a ?? b ?? "").toUpperCase();
      return /^\d/.test(s) ? `SCH${s}` : s; // SCH STD is just STD
    })
    .replace(/\b([A-D])\s*\/\s*(\d+(?:\.\d+)?)\s*MM\b/gi, (_, cls: string, wall: string) => {
      classNote = `${cls.toUpperCase()} CLASS`;
      return `X ${wall}MM`;
    })
    .replace(/\s+/g, " ")
    .trim();
  // "CON" / "ECC" next to a size: a concentric / eccentric reducer (the inventory keeps that as the length).
  if (/\d/.test(text)) {
    text = text.replace(/\b(CONC?|CONCENTRIC|E?C{1,2}ENTRIC|EC{1,2})\b\.?/gi, (w: string) => {
      centric = /^CON/i.test(w) ? "CONCENTRIC" : "ECCENTRIC";
      return "";
    });
    if (centric && !/\bREDUCER\b/i.test(text)) text = `${text} REDUCER`;
    text = text.replace(/\s+/g, " ").trim();
  }
  return { text, classNote, centric };
}

/** A schedule as written in a spec ("40", "S40", "SCH40", "XS/80", "STD"; a photo's "540" is S40). */
function specSchedule(t: string): string | null {
  let s = t.replace(/^SCH/, "").replace(/^S(?=\d)/, "");
  if (/^5(10|20|40|60|80|160)$/.test(s)) s = s.slice(1);
  if (/^XS\/?\d+$/.test(s)) s = s.replace(/^XS\/?/, "");
  if (/^(10|20|30|40|60|80|100|120|140|160)S?$/.test(s)) return `SCH${s}`;
  return /^(STD|XS|XXS)$/.test(s) ? s : null;
}

/**
 * A comma-separated spec line, as buyers' systems print them ("ELBO,90,LR,BW,CS,A234,WPB,2IN,S40",
 * "RED,CONC,BW,CS,A234,WPB,4x2IN,40x80"), in the inventory's words: 2"XSCH40,
 * 4"XSCH40X2"XSCH80 REDUCER (CONCENTRIC). The material and ends (BW CS A234 WPB) are the note.
 */
function specLine(s: string): { text: string; note: string; centric: string } | null {
  if ((s.match(/,/g) ?? []).length < 3) return null;
  const tokens = s.toUpperCase().split(/[,;\s]+/).filter(Boolean);
  const kind = tokens[0];
  const elbow = /^(ELBO|ELBOW|ELL)$/.test(kind);
  const tee = kind === "TEE";
  const reducer = /^(RED|REDU|REDUCER)$/.test(kind);
  const cap = /^(CAP|ENDCAP)$/.test(kind);
  if (!elbow && !tee && !reducer && !cap) return null;
  // The size ("2IN", "3x2IN"; a photo reads "4IN" as "41N" and the x as ">").
  const sizeAt = tokens.findIndex((t) => /^\d[\d.\/-]*([X>]\d[\d.\/-]*)?(IN|1N|INCH|")$/.test(t));
  if (sizeAt < 0) return null;
  const sizes = tokens[sizeAt].replace(/(IN|1N|INCH|")$/, "").split(/[X>]/);
  const schedules = (tokens[sizeAt + 1] ?? "").split(/X(?!S)/).map(specSchedule);
  if (!schedules[0]) return null;
  const [big, small] = sizes;
  const [sch, schSmall] = schedules as string[];
  const words = new Set(tokens.slice(1, sizeAt));
  let text: string;
  let centric = "";
  if (elbow) {
    const angle = words.has("45") ? " 45°" : words.has("180") ? " 180°" : "";
    text = `${big}"X${sch}${angle}${words.has("SR") ? " 1D" : ""}`;
  } else if (tee) text = small ? `${big}"X${small}"X${sch} TEE` : `${big}"X${sch} TEE`;
  else if (cap) text = `${big}"X${sch} CAP`;
  else {
    centric = [...words].some((w) => /^E?CC?ENTRIC$|^ECC$/.test(w)) ? "ECCENTRIC" : "CONCENTRIC";
    text = schSmall && schSmall !== sch ? `${big}"X${sch}X${small}"X${schSmall} REDUCER` : `${big}"X${small ?? ""}"X${sch} REDUCER`;
  }
  const variant = /^(45|90|180|LR|SR|EQ|UNEQ|CONC?|CONCENTRIC|ECC|E?CC?ENTRIC)$/;
  const note = tokens.slice(1, sizeAt).filter((w) => !variant.test(w)).join(" ");
  return { text, note, centric };
}

/**
 * A row holding two items side by side ("24"X20" STD CON | 24"X20" STD ECC"): one candidate per
 * item. When a photo garbled the second size but every character it could read agrees with the
 * first ("2a"X1g"" next to 24"X18"), the second is the same size.
 */
function splitPairs(c: ImportCandidate): ImportCandidate[] {
  if (c.tableRow) return [c];
  // Table borders read as letters: "|CON", "JcON", "Jecc", "[sTD".
  const text = c.text
    .replace(/[\[\]|{}]/g, " ")
    .replace(/(?<![A-Z])[JIl](?=(?:CONC?|E?CC?|STD|ST[O0])\b)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const centricWord = /\b(?:CONC?|CONCENTRIC|E?C{1,2}ENTRIC|EC{1,2})\b\.?/gi;
  const ends = [...text.matchAll(centricWord)].map((m) => (m.index ?? 0) + m[0].length);
  if (ends.length < 2) return [c];
  const parts = ends.map((end, i) => text.slice(i ? ends[i - 1] : 0, end).trim()).filter((p) => /\d/.test(p));
  if (parts.length < 2) return [c];
  // Each half as size + class, cleaned the same way ("5x3"" and "s"x3"" -> 5"X3" and S"X3").
  const pieces = (p: string) => {
    const t = orderText(p).text.replace(/\bREDUCER\b/i, "").toUpperCase();
    const size = t.match(/^.*?"\s*X\s*[^"\s]*"/)?.[0] ?? t.split(" ")[0];
    return { size: size.replace(/\s+/g, ""), cls: t.slice(size.length).replace(/\s+/g, "") };
  };
  // A size is garbled when it has letters besides the X ("10"Xs"" for 10"X8"); a class when it is not a schedule.
  const garbledSize = (s: string) => /[A-WYZ]/.test(s.replace(/X/g, ""));
  const garbled = (s: string) => /[A-WYZ]/.test(s.replace(/SCH\d+|STD|XXS|XS/g, ""));
  // Every character the photo could read (digits, inch marks, /) is the same.
  const agrees = (a: string, b: string) => a.length === b.length && [...a].every((ch, j) => !/[\d"\/]/.test(ch) || ch === b[j]);
  const left = pieces(parts[0]);
  const fixed = parts.map((p, i) => {
    if (i === 0) return p;
    const right = pieces(p);
    if (!(garbledSize(right.size) || garbled(right.cls)) || !agrees(right.size, left.size) || garbledSize(left.size)) return p;
    // Same size as the item next to it: the same item, with its own CON / ECC.
    const own = p.match(centricWord)?.[0] ?? "";
    const classToo = right.cls === left.cls || (garbled(right.cls) && (agrees(right.cls, left.cls) || (right.cls.length > 0 && left.cls.startsWith(right.cls))));
    return classToo ? parts[0].replace(centricWord, own) : `${parts[0].match(/^.*?"\s*[Xx]\s*[^"\s]*"/)?.[0] ?? left.size} ${p.slice(p.indexOf(" ") + 1)}`;
  });
  return fixed.map((p) => ({ ...c, text: p, name: undefined }));
}

/** Words around an item that say nothing on their own (units, "qty", list marks). */
const FILLER = new Set(["PCS", "PC", "PCS.", "NOS", "NOS.", "NO", "NO.", "QTY", "QTY.", "QTY:", "QUANTITY", "EACH", "PIECES", "PIECE", "UNITS", "UNIT", "NUMBERS", "-", "–", "—", ":", "=", "X", "@", "&"]);

/** What is left of a line once the item and its quantity are taken out: its note (or ""). */
function leftoverNote(words: string[]) {
  const kept = words.filter((w) => !NUMBERISH.test(w) && !FILLER.has(w.toUpperCase()) && /[a-z]/i.test(w));
  return kept.join(" ").replace(/^[\s,;:()\-–]+|[\s,;:()\-–]+$/g, "").slice(0, 100);
}

const FRACTIONS: Record<string, string> = { "125": "1/8", "25": "1/4", "375": "3/8", "5": "1/2", "625": "5/8", "75": "3/4", "875": "7/8" };

/** Compares item names the way people write them: case, spaces, quote marks and "x" don't matter. */
export function normalizeName(s: string) {
  return (
    s
      .toUpperCase()
      // A 90° elbow is a plain elbow ("12"XSTD 90°" = "12"XSTD").
      .replace(/\s+90\s*°/g, "")
      .replace(/(\d)\s*(?:INCH|INCHES|IN)\b/g, '$1"')
      .replace(/[″“”°]/g, '"')
      .replace(/[‘’′]/g, "'")
      .replace(/[×*]/g, "X")
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9."'\/-]/g, "")
      // Inches as the inventory writes them: 1.5" / 1-1/2" / 1 1/2" -> 11/2", 0.5" -> 1/2".
      .replace(/(?<![\d.\/])(\d*)\.(125|25|375|5|625|75|875)0*"/g, (_, whole: string, dec: string) => `${whole.replace(/^0+/, "")}${FRACTIONS[dec]}"`)
      .replace(/(\d)-(\d\/\d")/g, "$1$2")
      // "SCH STD" is STD.
      .replace(/SCH(?=STD)/g, "")
      // 2"SCH40 TEE is written 2"XSCH40 TEE in the inventory.
      .replace(/"(?=[A-WYZ])/g, '"X')
  );
}

/** The same name with the usual OCR slips next to digits put right ("SCH4O" -> "SCH40", "1I4" -> "114"). */
function ocrFixed(n: string) {
  return n.replace(/(?<=\d)O|O(?=\d)/g, "0").replace(/(?<=\d)[IL|]|[IL|](?=\d)/g, "1");
}

/** A stray stroke read between a digit and the unit ("89X3IMM" -> "89X3MM"). */
function ocrStripped(n: string) {
  return n.replace(/(?<=\d)[IL|](?=MM|X|")/g, "");
}

const numbers = (n: string) => new Set(n.match(/\d+(?:\.\d+)?/g) ?? []);

function bigrams(s: string) {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice similarity of two normalised names (0 = nothing alike, 1 = the same). */
function dice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

/**
 * The nominal pipe size (inches) of an outside diameter in mm, from the pipe chart. Suppliers and
 * customers write the same size differently (2 1/2": 73 or 76, 3": 88 or 89, 6": 165 or 168).
 */
function nominalSize(od: number) {
  const row = PIPE_CHART.find(([, , , chartOd]) => Math.abs(od - chartOd) <= Math.max(3.5, chartOd * 0.045));
  return row ? row[1] : null;
}

type PipeSize = {
  /** The nominal size: 73X3MM, 76X3MM and 21/2"XSCH40 are all 2 1/2". */
  key: string;
  /** Written as an outside diameter (76X3MM) or in inches (21/2"XSCH40). */
  form: "mm" | "inch";
  /** Outside diameter in mm (from the pipe chart for inches). */
  od: number | null;
  /** Wall thickness in mm (from the pipe chart for a schedule). */
  wall: number | null;
  /** Where the wall comes from: written in mm, or a schedule. */
  family: "mm" | "sch" | null;
  /** What comes after the size: TEE, 45", a second size... */
  rest: string;
};

/** Schedules written after an inch size, longest first ("SCH100" is not "SCH10"). */
const SCHEDULE = /^X?SCH(100|120|140|160|5S|10S|40S|80S|10|20|30|40|60|80|STD|XXS|XS)|^X(STD|XXS|XS)/;
const LATER_SCHEDULE = /SCH(100|120|140|160|5S|10S|40S|80S|10|20|30|40|60|80|XXS|XS)/;

/**
 * The pipe size a normalised name starts with: an outside diameter and wall ("76X3MM") or inches
 * with a wall in mm or a schedule ("21/2"X4MM", "10"X5.75/6MM", "4"XSCH40").
 */
export function pipeSize(n: string): PipeSize | null {
  const mm = n.match(/^(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)(?:\/\d+(?:\.\d+)?)?(?:MM)?(?![\d"])/);
  if (mm && Number(mm[1]) >= 10) {
    const od = Number(mm[1]);
    const nps = nominalSize(od);
    return { key: nps != null ? `${nps}"` : `${od}MM`, form: "mm", od, wall: Number(mm[2]), family: "mm", rest: n.slice(mm[0].length) };
  }
  const inch = n.match(/^(\d*\d\/\d|\d+(?:\.\d+)?)"/);
  const nps = inch ? parseNpsValue(inch[1]) : null;
  if (!inch || nps == null) return null;
  const row = PIPE_CHART.find((r) => r[1] === nps);
  let rest = n.slice(inch[0].length);
  let wall: number | null = null;
  let family: PipeSize["family"] = null;
  const mmWall = rest.match(/^X(\d+(?:\.\d+)?)(?:\/\d+(?:\.\d+)?)?MM/);
  // The schedule, also after other words ("3" X OIL PIPE SCH40", "14"X12"XSCH40 REDUCER").
  const schedule = mmWall ? null : (rest.match(SCHEDULE) ?? rest.match(LATER_SCHEDULE));
  if (mmWall) {
    wall = Number(mmWall[1]);
    family = "mm";
    rest = rest.slice(mmWall[0].length);
  } else if (schedule) {
    const i = SCHEDULES.findIndex((s) => s.code === (schedule[1] ?? schedule[2]));
    wall = row && i >= 0 ? row[4][i] : null;
    family = "sch";
    rest = rest.slice(0, schedule.index) + rest.slice((schedule.index ?? 0) + schedule[0].length);
  }
  return { key: `${nps}"`, form: "inch", od: row ? row[3] : null, wall, family, rest };
}

/**
 * What an item search means in the inventory's own names. Inches with a wall in mm become the
 * outside diameters of that size (1" B/2.5 MM -> 30X2.5MM … 36X2.5MM, so 33X2.5MM is found);
 * other sizes are written the inventory's way (1.1/2" SL/40 -> 11/2"XSCH40). `prefixes` are the
 * starts of the item name, `words` what else the search said (TEE, CAP...). Null without a size.
 */
export function sizeQuery(search: string): { prefixes: string[]; words: string } | null {
  const tokens = orderText(search).text.replace(/(\d)\s+MM\b/gi, "$1MM").split(" ");
  const sizeEnd = tokens.findIndex((t) => !/\d|^X$|^SCH|^(STD|XS|XXS|MM)$/i.test(t));
  const sizeTokens = sizeEnd < 0 ? tokens : tokens.slice(0, sizeEnd);
  if (!sizeTokens.some((t) => t.includes('"'))) return null;
  // "1" 2.5" or "1" x 2.5" (a bare number after an inch size) is a wall in mm.
  const joined = sizeTokens.map((t, i) => (/^\d+(\.\d+)?$/.test(t) && Number(t) < 40 && sizeTokens.slice(0, i).some((x) => /"$/.test(x)) ? `${t}MM` : t)).join(" ");
  const name = normalizeName(joined).replace(/"(?=\d)/g, '"X');
  const size = pipeSize(name);
  if (!size) return null;
  const words = (sizeEnd < 0 ? [] : tokens.slice(sizeEnd)).join(" ");
  const prefixes = [name];
  if (size.form === "inch" && size.family === "mm" && size.wall != null && !size.rest) {
    const row = PIPE_CHART.find((r) => `${r[1]}"` === size.key);
    if (row) {
      const tol = Math.max(3.5, row[3] * 0.045);
      for (let od = Math.ceil(row[3] - tol); od <= Math.floor(row[3] + tol); od++) if (nominalSize(od) === row[1]) prefixes.push(`${od}X${size.wall}MM`);
    }
  }
  return { prefixes, words };
}

/** Supplier item codes look like "F5", "D4", "P1", "CN3". */
const CODE = /^[A-Z]{1,3}\d{1,3}$/;
/** Words that look like a pipe-fitting item: a size, a schedule, inches... */
const ITEMISH = /\d\s*(mm|"|inch|in\b|nb\b|x\s*\d)|\bsch\s*\d|\bdn\s*\d|\d+\s*[x×*]\s*\d|\d"|\b\d+\s*(std|xs|xxs)\b/i;
const NUMBERISH = /^[\d.,%₹$¥()\-]+$/;
/** A quantity is a whole number ("500", "10,000"); prices and amounts have decimals ("302.00"). */
const WHOLE = /^(\d{1,3}(,\d{3})+|\d+)$/;

type Prepared = {
  item: PickerItem;
  desc: string;
  /** desc without decimal points, for an OCR read that lost one ("45MM" for "4.5MM"). */
  dotless: string;
  note: string;
  withNote: string;
  code: string | null;
  descNums: Set<string>;
  noteNums: Set<string>;
  words: Set<string>;
  size: PipeSize | null;
  /** The words of its name that say what it is (TEE, CAP...). */
  kind: Set<string>;
};
type Ranked = ImportMatch & { name: string };

/** Words that say what a thing is (TEE, CAP, ELBOW, CTW...). Units and "Standard" don't count. */
const GENERIC = new Set(["MM", "SCH", "STD", "STANDARD", "INCH", "INCHES", "IN", "NB", "NOS", "NO", "PCS", "PC", "QTY", "OF", "AND", "THE", "WITH"]);
const wordsOf = (s: string) => (s.toUpperCase().match(/[A-Z]{2,}/g) ?? []).filter((w) => !GENERIC.has(w));
/** The same, without the "X" between a size and the next word ("2"XSCH40 TEE" -> TEE). */
const kindOf = (s: string) => wordsOf(s.toUpperCase().replace(/(?<=["'\d\s])X(?=[A-Z])/g, " ")).filter((w) => w !== "XS" && w !== "XXS");

function textScore(text: string, target: string) {
  if (!target) return 0;
  if (text === target) return 1;
  const ratio = Math.min(text.length, target.length) / Math.max(text.length, target.length);
  // One name inside the other counts only when they are of similar length.
  if (ratio >= 0.5 && (target.includes(text) || text.includes(target))) return 0.72 + 0.2 * ratio;
  return 0.9 * dice(text, target);
}

/**
 * How well a name (and its note / length, if the file has one) fits an inventory item.
 * Can go a little over 1 when the length also agrees, so that it wins over the same name with
 * another length.
 */
function similarity(name: string, note: string, code: string | null, p: Prepared) {
  // Item names always carry a size ("114XSCH40", "4\"X4.5MM TEE"): words without a digit are not items.
  if (!/\d/.test(name)) return 0;
  let s = Math.max(textScore(name, p.desc), textScore(note ? name + note : name, p.withNote));
  // Same name once the decimal points are ignored: a likely match, but always to be checked.
  if (s < 0.9 && name.replace(/\./g, "") === p.dotless) s = 0.9;
  if (note && p.note && note === p.note) s += 0.05;
  // A concentric reducer is not an eccentric one, however alike the names.
  if (note && p.note && note !== p.note && /CENTRIC/.test(note + p.note)) s = Math.min(s, 0.85);
  if (code && p.code) s = p.code === code ? s + 0.08 : Math.min(s, 0.9);
  return s;
}

/** Best matches for a name, trying the OCR-corrected spelling too. */
function rank(name: string, note: string, code: string | null, inventory: Prepared[]): Ranked[] {
  const variants = [...new Set([name, ocrFixed(name), ocrStripped(name)])];
  const best = new Map<string, Ranked>();
  for (const v of variants) {
    for (const p of inventory) {
      const score = Math.round(similarity(v, note, code, p) * 1000) / 1000;
      if (score < 0.45) continue;
      const prev = best.get(p.item.id);
      if (!prev || score > prev.score) best.set(p.item.id, { item: p.item, score, name: v });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 6);
}

/** The sizes in the file must be the inventory item's sizes (its length may be added). */
function sameSizes(name: string, note: string, p: Prepared) {
  const nums = numbers(name + note);
  for (const n of p.descNums) if (!nums.has(n)) return false;
  for (const n of nums) if (!p.descNums.has(n) && !p.noteNums.has(n)) return false;
  return true;
}

/** How far an inventory item of the same nominal size is from the pipe a line asks for (0 = the same). */
function sizeDistance(line: PipeSize, lineKind: Set<string>, p: Prepared) {
  const s = p.size!;
  let d = 0;
  // A TEE / CAP / REDUCER the line doesn't ask for, or the other way round.
  for (const w of p.kind) if (!lineKind.has(w)) d += 100;
  for (const w of lineKind) if (!p.kind.has(w)) d += 100;
  // More numbers after the size: 45°, 1D, a second size.
  const lineRest = numbers(line.rest);
  if ([...numbers(s.rest)].some((n) => !lineRest.has(n))) d += 50;
  // The wall counts most; 73 or 76 for 2 1/2" is only a way of writing it, and so is mm or inches.
  d += line.wall != null && s.wall != null ? Math.abs(line.wall - s.wall) : 3;
  if (line.od != null && s.od != null) d += Math.abs(line.od - s.od) * 0.1;
  // A wall written in mm is closest to walls written in mm (1" X 2.5MM: 33X2.5MM before 1"XSCH40).
  return d + (line.family === s.family ? 0 : 0.5);
}

/** Finds the inventory items that best match each line of the uploaded list. */
export function matchCandidates(candidates: ImportCandidate[], inventory: PickerItem[]): ImportRow[] {
  const prepared: Prepared[] = inventory.map((item) => {
    const desc = normalizeName(item.description);
    const note = normalizeName(item.note ?? "");
    return {
      item,
      desc,
      dotless: desc.replace(/\./g, ""),
      note,
      withNote: desc + note,
      code: item.item_code ? normalizeName(item.item_code) : null,
      descNums: numbers(desc),
      noteNums: numbers(note),
      words: new Set(wordsOf(`${item.description} ${item.note ?? ""}`)),
      size: pipeSize(desc),
      kind: new Set(kindOf(item.description)),
    };
  });
  const byId = new Map(prepared.map((p) => [p.item.id, p]));
  const vocabulary = new Set(prepared.flatMap((p) => [...p.words]));
  const kinds = new Set(prepared.flatMap((p) => [...p.kind]));
  const rows: ImportRow[] = [];
  /** The heading the lines are under ("MS TEE"), and the last row number seen ("1", "2", ...). */
  let section: Section | null = null;
  let lastSerial = 0;

  for (const raw of candidates.flatMap(splitPairs)) {
    // A heading over a block of a purchase order: the lines below it are that kind of fitting.
    const heading = raw.qty == null ? sectionOf(raw.name ?? raw.text) : null;
    if (heading) {
      section = heading;
      continue;
    }
    // A purchase-order line: "3 2’’ B/3 MM" = row 3, 2" with a 3 mm wall, B class.
    let source = (raw.name ?? raw.text).trim();
    const parts = source.split(/\s+/);
    const serial = /^\d{1,3}[.)]?$/.test(parts[0] ?? "") ? parseInt(parts[0], 10) : NaN;
    const numbered =
      !raw.tableRow && parts.length > 1 && /^[\d½¼¾]/.test(parts[1]) && serial > lastSerial && serial <= lastSerial + 5 && (lastSerial > 0 || !/^\d\/\d/.test(parts[1]));
    if (numbered) {
      lastSerial = serial;
      source = parts.slice(1).join(" ");
    }
    const spec = specLine(source);
    const order = spec ? { text: spec.text, classNote: spec.note, centric: spec.centric } : orderText(source);
    // Only a line with a size is an item (the letterhead repeated on every page is not).
    const sized = /\d\s*"|\d\s*X\s*\d|\d\s*MM\b/i.test(order.text);
    const kindAdded = sized && section != null && section.kind !== "" && !FITTING_WORD.test(order.text);
    const whole = Boolean(raw.tableRow || (sized && (spec || numbered || order.classNote || order.centric || kindAdded)));
    const itemText = kindAdded ? `${order.text} ${section!.kind}` : order.text;
    // A whole line that is the item (a numbered order line) is read like a table cell.
    const c: ImportCandidate = whole ? { ...raw, text: itemText, name: itemText, tableRow: true } : { ...raw, text: itemText, ...(raw.name ? { name: itemText } : {}) };

    // The item code: its own column, or a leading "F5" on the line.
    const tokens = (c.name ?? c.text).trim().split(/\s+/);
    const first = normalizeName(tokens[0] ?? "");
    const leadingCode = !c.code && tokens.length > 1 && CODE.test(first);
    // Item numbers play no part (the user removed them everywhere); a leading one is only dropped from the name.
    const code: string | null = null;
    let words = leadingCode ? tokens.slice(1) : tokens;
    // The file's note column: a length is compared with the inventory length, anything else
    // ("B CLASS") is the customer's own note and plays no part in finding the item.
    // A reducer under a "CONCENTRIC" heading has that length, like in the inventory.
    const fileLength = c.note && isLength(c.note) ? c.note.trim() : order.centric || (section?.length ?? "");
    const note = fileLength ? normalizeName(fileLength) : "";
    // A table row shows its item (and code) only; its note is shown on its own.
    let text = c.tableRow ? [c.code, c.name].filter(Boolean).join(" ") || c.text : c.text;
    let qty = c.qty;
    let fileNote = c.note && !isLength(c.note) ? c.note.trim() : order.classNote;
    let matches = rank(normalizeName(words.join(" ")), note, code, prepared);
    if (!c.tableRow && words.length && /^\d{1,2}[.)]\d/.test(words[0])) {
      const unglued = [words[0].replace(/^\d{1,2}[.)]/, ""), ...words.slice(1)];
      const m = rank(normalizeName(unglued.join(" ")), note, code, prepared);
      if ((m[0]?.score ?? 0) > (matches[0]?.score ?? 0)) {
        words = unglued;
        matches = m;
        text = unglued.join(" ");
      }
    }

    // Free text ("1 508X5.8MM 302.00 500 0 151,000.00"): find the words that name an item (the
    // longest exact name wins); the quantity is then the first whole number after them. A table
    // cell is the item itself, so it is only searched like this when nothing fits at all.
    const searchWords = !c.tableRow ? !matches[0] || matches[0].score < 0.92 : !matches[0] || matches[0].score < 0.6;
    if (searchWords) {
      let best: { key: number; start: number; end: number; matches: Ranked[] } | null = null;
      for (let i = 0; i < words.length; i++) {
        for (let len = 1; len <= 5 && i + len <= words.length; len++) {
          const win = words.slice(i, i + len);
          if (win.every((w) => NUMBERISH.test(w))) continue;
          const m = rank(normalizeName(win.join(" ")), note, code, prepared);
          const key = m[0] ? m[0].score + 0.002 * len : 0;
          if (m[0] && (!best || key > best.key)) best = { key, start: i, end: i + len, matches: m };
        }
      }
      if (best && best.matches[0].score > (matches[0]?.score ?? 0) + 0.02) {
        // A table cell is the item: its sizes are checked against the whole cell ("12" X 6MM" is not 12"XSTD).
        matches = c.tableRow ? best.matches.map((m) => ({ ...m, name: normalizeName(words.join(" ")) })) : best.matches;
        if (!c.tableRow) text = [leadingCode ? tokens[0] : "", ...words.slice(best.start, best.end)].filter(Boolean).join(" ");
        if (qty == null && !c.qtyFromColumn) {
          const q = words.slice(best.end).find((w) => WHOLE.test(w) && Number(w.replace(/,/g, "")) > 0);
          if (q) qty = Number(q.replace(/,/g, ""));
        }
        // The other words of a free-text line are its note ("galvanised", "with marking").
        if (!c.tableRow && !fileNote) fileNote = leftoverNote([...words.slice(0, best.start), ...words.slice(best.end)]);
      }
    }

    let keep = matches.filter((m) => m.score >= 0.6);
    // Items with the same name that fit equally well: if they are copies of each other for a
    // quotation (same length, price, weight), take one (the one with a code) instead of asking.
    const tied = keep.filter((m) => keep[0] && m.score >= keep[0].score - 0.01);
    if (tied.length > 1) {
      const same = (a: PickerItem, b: PickerItem) =>
        normalizeName(a.description) === normalizeName(b.description) &&
        normalizeName(a.note ?? "") === normalizeName(b.note ?? "") &&
        Number(a.unit_price) === Number(b.unit_price) &&
        Number(a.weight_kg) === Number(b.weight_kg) &&
        normalizeName(a.actual_weight ?? "") === normalizeName(b.actual_weight ?? "");
      if (tied.every((m) => same(m.item, tied[0].item))) {
        const pick = tied.find((m) => m.item.item_code) ?? tied[0];
        keep = [pick, ...keep.filter((m) => !tied.includes(m))];
      } else {
        // "2"XSCH40" and "2"XSCH40 90°" both in the inventory: the name as written wins.
        const says90 = /\b90\s*(°|DEG)/i.test(c.text);
        const asWritten = tied.filter((m) => /\b90\s*°/.test(m.item.description) === says90);
        if (asWritten.length === 1) keep = [{ ...asWritten[0], score: asWritten[0].score + 0.02 }, ...keep.filter((m) => m !== asWritten[0])];
      }
    }
    // A line that isn't an item (heading, address, total...) is left out; a table row is always kept.
    if (!keep.length && !c.tableRow && !ITEMISH.test(c.text)) continue;

    // A word that says what the thing is (TEE, CAP...) and that the inventory item doesn't have.
    const lineWords = wordsOf(c.tableRow ? `${c.name ?? ""} ${fileLength}` : c.text).filter((w) => vocabulary.has(w));
    const lineName = keep[0]?.name || normalizeName(words.join(" "));
    const size = pipeSize(lineName);
    const lineKind = new Set(kindOf(c.tableRow ? (c.name ?? text) : text).filter((w) => kinds.has(w)));
    // Inches with a wall in mm and an outside diameter are the same pipe when the nominal size and
    // the wall agree: 1" X 2.5MM is 33X2.5MM, 21/2" X 3MM is 76X3MM.
    // So are two schedules with the same wall: up to 10", STD is SCH40 (8"XSTD = 8" SCH40).
    const samePipe = (p: Prepared) => {
      const s = p.size;
      if (!size || !s || s.key !== size.key || size.wall == null || s.wall == null || Math.abs(size.wall - s.wall) > 0.001) return false;
      if (s.family !== size.family) return false;
      if (size.family === "mm" && s.form === size.form) return false;
      const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
      return sameSet(p.kind, lineKind) && sameSet(numbers(size.rest), numbers(s.rest));
    };
    const issuesOf = (list: Ranked[], ranked: boolean) => {
      const [top, second] = list;
      if (!top) return ["missing"] as ImportIssue[];
      const p = byId.get(top.item.id)!;
      const out: ImportIssue[] = [];
      const pipe = samePipe(p);
      if (ranked && second && second.score >= top.score - 0.01 && (!pipe || samePipe(byId.get(second.item.id)!))) out.push("similar");
      // A concentric reducer is not an eccentric one.
      const otherLength = /CENTRIC/.test(note + p.note) && note !== p.note;
      if ((!pipe && !sameSizes(top.name, note, p)) || otherLength) out.push("size");
      if (code && p.code && p.code !== code) out.push("code");
      const otherThing = lineWords.some((w) => !p.words.has(w));
      if (((top.score < 0.92 && !pipe) || otherThing) && !out.includes("size") && !out.includes("code")) out.push("fuzzy");
      return out;
    };
    let itemIssues = issuesOf(keep, true);

    // Another size, or another kind of fitting (a TEE for a plain line): offer the inventory items
    // of the same nominal pipe size first, the closest first (73 X 2.5MM -> 76X2.5MM, 76X3MM;
    // 10" X 6MM -> 273X5.75MM; 3" X 4MM -> 89X4.25MM before 3"X4MM TEE).
    const top = keep[0] && byId.get(keep[0].item.id)!;
    const otherKind = top != null && [...top.kind].some((w) => !lineKind.has(w));
    if (size && (itemIssues.includes("size") || itemIssues.includes("missing") || (itemIssues.includes("fuzzy") && otherKind))) {
      const distance = new Map(prepared.filter((p) => p.size?.key === size.key).map((p) => [p, sizeDistance(size, lineKind, p) - (samePipe(p) ? 1000 : 0)]));
      const same = [...distance.keys()]
        .sort((a, b) => distance.get(a)! - distance.get(b)!)
        .slice(0, 5)
        .map((p) => keep.find((m) => m.item.id === p.item.id) ?? { item: p.item, score: Math.round(similarity(lineName, note, code, p) * 1000) / 1000, name: lineName });
      // A photo that lost a decimal point ("4"X45MM TEE" for 4"X4.5MM TEE) keeps that item first.
      const pinned = top && keep[0].name.replace(/\./g, "") === top.dotless ? [keep[0]] : [];
      if (same.length) {
        const before = keep[0];
        keep = [...pinned, ...same.filter((m) => !pinned.includes(m)), ...keep.filter((m) => !same.includes(m) && !pinned.includes(m))].slice(0, 6);
        if (keep[0] !== before) itemIssues = issuesOf(keep, false);
      }
    }

    const issues = [...itemIssues];
    if (qty == null) issues.push("qty-missing");
    else if (c.qtyConf != null && c.qtyConf < 80) issues.push("qty-unclear");
    rows.push({
      text,
      qty,
      matches: keep.map(({ item, score }) => ({ item, score: Math.min(1, score) })),
      status: !keep.length ? "none" : itemIssues.length ? "check" : "matched",
      issues,
      ...(fileLength ? { length: fileLength } : {}),
      ...(fileNote ? { note: fileNote } : {}),
    });
  }
  return rows;
}
