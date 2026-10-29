import { z } from "zod";
import type { PickerItem } from "@/lib/inventory/types";
import { conflict } from "./ai-checks";
import type { Catalog } from "./ai-prompt";
import { matchCandidates, normalizeName, type ImportIssue, type ImportMatch, type ImportRow } from "./match";

const aiLineSchema = z.object({
  source: z.string(),
  qty: z.number().nullable(),
  qty_sure: z.boolean(),
  length: z.string().nullable(),
  note: z.string().nullable(),
  size_inch: z.string().nullable(),
  reason: z.string(),
  items: z.array(z.object({ n: z.number().int(), name: z.string() })),
  several_fit: z.boolean(),
  differences: z.array(z.string()),
});

/** The AI's answer for one request, checked before anything in it is used. */
export const aiAnswerSchema = z.object({ lines: z.array(aiLineSchema) });
export type AiLine = z.infer<typeof aiLineSchema>;

const MAX_MATCHES = 6;
/** A quantity above this is more likely a misread number (a code, an amount) than pieces. */
const MAX_SURE_QTY = 1_000_000;
const SCORE = { exact: 1, close: 0.8 } as const;

const text = (s: string | null, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Two inventory rows that quote the same (same name, length, price and weights). */
function isCopy(a: PickerItem, b: PickerItem) {
  return (
    a.id === b.id ||
    (normalizeName(a.description) === normalizeName(b.description) &&
      normalizeName(a.note ?? "") === normalizeName(b.note ?? "") &&
      Number(a.unit_price) === Number(b.unit_price) &&
      Number(a.weight_kg) === Number(b.weight_kg) &&
      normalizeName(a.actual_weight ?? "") === normalizeName(b.actual_weight ?? ""))
  );
}

/**
 * The ways the AI may have written an item's name: the name alone, or copied from its inventory
 * line ("1"|33X2.5MM|80MM": size, name, note), with or without the note.
 */
function namesOf(written: string): string[] {
  const parts = written
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1 && /^(-|\d+(\s+\d\/\d)?"?|\d\/\d"?)$/.test(parts[0])) parts.shift();
  return [...new Set([normalizeName(parts.join(" ")), normalizeName(parts[0] ?? "")])].filter(Boolean);
}

/** The name the AI gave is this item's name (with or without its note). */
const named = (item: PickerItem, names: string[]) => {
  const own = normalizeName(item.description);
  const withNote = normalizeName(`${item.description}${item.note ?? ""}`);
  return names.some((n) => n === own || n === withNote);
};

/** One pick as an inventory item: its number and name must agree, or its name must be one item; else null. */
function resolvePick(p: AiLine["items"][number], catalog: Catalog): PickerItem | null {
  const names = namesOf(p.name);
  if (!names.length) return null;
  const byNumber = catalog.items[p.n - 1];
  if (byNumber && named(byNumber, names)) return byNumber;
  // With its note the name is one item; without it, it may be several lengths.
  const byFullName = catalog.items.filter((i) => named(i, names.slice(0, 1)));
  const found = byFullName.length ? byFullName : catalog.items.filter((i) => named(i, names));
  return found.length && found.every((i) => isCopy(i, found[0])) ? found[0] : null;
}

/** The inventory items the AI picked (copies once); a name not in the inventory is dropped. */
export function resolvePicks(picks: AiLine["items"], catalog: Catalog): PickerItem[] {
  const out: PickerItem[] = [];
  for (const p of picks) {
    const item = resolvePick(p, catalog);
    if (item && !out.some((o) => isCopy(o, item))) out.push(item);
  }
  return out;
}

/** The same item under its other lengths / notes. */
const siblingsOf = (item: PickerItem, catalog: Catalog) => catalog.items.filter((i) => !isCopy(i, item) && normalizeName(i.description) === normalizeName(item.description));

type Verdict = { status: ImportRow["status"]; issues: ImportIssue[]; matches: ImportMatch[]; why?: string };

const scored = (items: PickerItem[], score: number) => items.map((item) => ({ item, score }));
const unique = (items: PickerItem[]) => items.filter((item, i) => items.findIndex((o) => isCopy(o, item)) === i);

/** The AI's first item is the one asked for: checked by the rules and against the standard matcher. */
function sureVerdict(line: AiLine, item: PickerItem, others: PickerItem[], standardItem: PickerItem | undefined): Verdict {
  const why = conflict(line, item);
  const rest = scored(others, SCORE.close);
  // The standard matcher is sure of another item: both are offered, the more likely first.
  if (standardItem && !isCopy(standardItem, item)) {
    const both = [{ item: standardItem, score: SCORE.exact }, { item, score: SCORE.exact }];
    return { status: "check", issues: ["similar"], matches: [...(why ? both : both.reverse()), ...rest], ...(why ? { why: `Check: ${why}.` } : {}) };
  }
  if (why) return { status: "check", issues: ["size"], matches: [{ item, score: SCORE.close }, ...rest], why: `Check: ${why}.` };
  return { status: "matched", issues: [], matches: [{ item, score: SCORE.exact }, ...rest] };
}

/**
 * The verdict for one line. It is a sure match only when the AI's first item is in the inventory
 * (number and name agree), the AI names no difference, and the rules and the standard matcher agree.
 */
function verdictOf(line: AiLine, catalog: Catalog, standard: ImportRow | undefined): Verdict {
  const first = line.items[0] ? resolvePick(line.items[0], catalog) : null;
  const picks = resolvePicks(line.items, catalog);
  const standardItem = standard?.status === "matched" ? standard.matches[0]?.item : undefined;
  const differences = line.differences.map((d) => d.trim()).filter(Boolean);

  if (!picks.length) {
    // The AI found nothing but the standard matcher is sure: offered, to be checked.
    if (standardItem) return { status: "check", issues: ["fuzzy"], matches: standard!.matches };
    return { status: "none", issues: ["missing"], matches: [] };
  }
  if (line.several_fit) {
    // A choice the AI couldn't make: the items that fit, and the same item in its other lengths.
    const choices = unique([...picks, ...(first ? siblingsOf(first, catalog) : [])]).filter((item) => !conflict(line, item));
    if (choices.length > 1) return { status: "check", issues: ["similar"], matches: [...scored(choices, SCORE.exact), ...scored(picks.filter((p) => !choices.includes(p)), SCORE.close)] };
  }
  if (first && !differences.length) return sureVerdict(line, first, picks.filter((p) => !isCopy(p, first)), standardItem);
  return { status: "check", issues: ["size"], matches: scored(picks, SCORE.close), ...(differences.length ? { why: `Differs: ${differences.join(", ")}.` } : {}) };
}

/** The AI's picks first, then the standard matcher's suggestions (ranked lower, so they never tie). */
function withSuggestions(matches: ImportMatch[], standard: ImportRow | undefined): ImportMatch[] {
  const floor = matches.length ? Math.min(...matches.map((m) => m.score)) - 0.05 : 1;
  const extra = (standard?.matches ?? []).filter((s) => !matches.some((m) => isCopy(m.item, s.item))).map((s) => ({ item: s.item, score: Math.min(s.score, floor) }));
  return [...matches, ...extra].slice(0, MAX_MATCHES);
}

/** The AI's lines as import rows, each pick checked against the inventory: the same rows the standard reader gives. */
export function toImportRows(lines: AiLine[], catalog: Catalog): ImportRow[] {
  // The standard matcher reads the same item texts, for its suggestions and as a second opinion.
  const standard = matchCandidates(
    lines.map((l) => ({ text: text(l.source, 200) || "-", name: text(l.source, 200) || "-", note: text(l.length, 40) || undefined, qty: 1, tableRow: true })),
    catalog.items,
  );
  const second = standard.length === lines.length ? standard : [];

  return lines.map((line, i) => {
    const qty = line.qty != null && Number.isFinite(line.qty) && line.qty > 0 ? line.qty : null;
    const v = verdictOf(line, catalog, second[i]);
    const issues: ImportIssue[] = [...v.issues];
    if (qty == null) issues.push("qty-missing");
    else if (!line.qty_sure || qty > MAX_SURE_QTY) issues.push("qty-unclear");
    const length = text(line.length, 40);
    const note = text(line.note, 100);
    const why = v.why ?? text(line.reason, 200);
    return {
      text: text(line.source, 200) || "Item",
      qty,
      matches: withSuggestions(v.matches, second[i]),
      status: v.status,
      issues,
      ...(length ? { length } : {}),
      ...(note ? { note } : {}),
      ...(why ? { why } : {}),
    };
  });
}
