import { norm } from "../inventory/merge";
import type { PickerItem } from "../inventory/types";
import { autoUnitPrice } from "./calc";
import type { QuoteHeader, QuoteLine } from "./types";

const num = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));

/**
 * Inventory items that changed while a quotation is open, applied to its lines:
 *  - a line of that item takes its new China price, weight and actual weight (the customer price
 *    follows, unless it was typed by hand);
 *  - a line typed as a new item (not in inventory) whose name is now in the inventory is linked
 *    to it and priced - with one item of that name, or the one whose length the line names.
 * Lines nothing changed for are returned as they were (same objects).
 */
export function applyInventoryChanges(
  lines: QuoteLine[],
  items: PickerItem[],
  pricing: Pick<QuoteHeader, "pricing_basis" | "rate_per_kg" | "margin_pct">,
): { lines: QuoteLine[]; updated: number; linked: number } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const byName = new Map<string, PickerItem[]>();
  for (const i of items) byName.set(norm(i.description), [...(byName.get(norm(i.description)) ?? []), i]);
  let updated = 0;
  let linked = 0;

  const priced = (line: QuoteLine) => (line.price_overridden ? line : { ...line, unit_price: autoUnitPrice(line, pricing) ?? line.unit_price });

  const next = lines.map((line) => {
    if (line.inventory_item_id) {
      const item = byId.get(line.inventory_item_id);
      if (!item) return line;
      const fresh = { base_price: num(item.unit_price), unit_weight_kg: num(item.weight_kg), actual_weight: item.actual_weight ?? line.actual_weight };
      if (fresh.base_price === line.base_price && fresh.unit_weight_kg === line.unit_weight_kg && fresh.actual_weight === line.actual_weight) return line;
      updated++;
      return priced({ ...line, ...fresh });
    }
    if (!line.description.trim()) return line;
    const named = byName.get(norm(line.description)) ?? [];
    const remarks = norm(line.remarks);
    const item = named.length === 1 ? named[0] : named.find((i) => i.note && remarks.includes(norm(i.note)));
    if (!item) return line;
    linked++;
    return priced({
      ...line,
      inventory_item_id: item.id,
      base_price: num(item.unit_price),
      unit_weight_kg: num(item.weight_kg),
      actual_weight: line.actual_weight || item.actual_weight || "",
      remarks: line.remarks || item.note || "",
      check: undefined,
    });
  });
  return { lines: updated || linked ? next : lines, updated, linked };
}
