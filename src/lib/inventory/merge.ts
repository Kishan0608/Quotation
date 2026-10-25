import type { InventoryInput } from "./schema";

/**
 * Two rows are the same item when Item no. and Items match, ignoring case,
 * spaces and brackets: "114XSCH40 OIL PIPE" = "114XSCH40(OIL PIPE)".
 * A concentric and an eccentric reducer of the same size are different items.
 */
export function itemKey(code: string | null | undefined, description: string, note?: string | null) {
  const norm = (s: string) => s.toUpperCase().replace(/[\s()（）]/g, "");
  const variant = /^(CONCENTRIC|ECCENTRIC)$/i.test(note?.trim() ?? "") ? `|${note!.trim().toUpperCase()}` : "";
  return `${norm(code ?? "")}|${norm(description)}${variant}`;
}

export type ExistingItem = { id: string; item_code: string | null; description: string; note: string | null; unit_price: number | null };

export type ImportPlan = {
  /** New items, one row each (a later row of the same item only changes its price). */
  inserts: InventoryInput[];
  /** Price changes for items already in inventory, grouped by new price. */
  priceUpdates: { price: number; ids: string[] }[];
  /** Items whose price changed / that were already at that price. */
  updated: number;
  unchanged: number;
};

/**
 * An item that is already in inventory only gets its price updated (every row of
 * that item); nothing else changes. New items are added. When an item appears
 * more than once in the file, the last price wins.
 */
export function planImport(rows: InventoryInput[], existing: ExistingItem[]): ImportPlan {
  const existingByKey = new Map<string, ExistingItem[]>();
  for (const e of existing) {
    const key = itemKey(e.item_code, e.description, e.note);
    existingByKey.set(key, [...(existingByKey.get(key) ?? []), e]);
  }

  const newByKey = new Map<string, InventoryInput>();
  const seen = new Set<string>();
  const lastPrice = new Map<string, number>();
  for (const row of rows) {
    const key = itemKey(row.item_code, row.description, row.note);
    if (existingByKey.has(key)) {
      seen.add(key);
      if (row.unit_price != null) lastPrice.set(key, row.unit_price);
    } else if (newByKey.has(key)) {
      if (row.unit_price != null) newByKey.set(key, { ...newByKey.get(key)!, unit_price: row.unit_price });
    } else {
      newByKey.set(key, row);
    }
  }

  const idsByPrice = new Map<number, string[]>();
  let updated = 0;
  for (const [key, price] of lastPrice) {
    const stale = existingByKey.get(key)!.filter((e) => e.unit_price == null || Number(e.unit_price) !== price);
    if (!stale.length) continue;
    updated++;
    idsByPrice.set(price, [...(idsByPrice.get(price) ?? []), ...stale.map((e) => e.id)]);
  }

  return {
    inserts: [...newByKey.values()],
    priceUpdates: [...idsByPrice].map(([price, ids]) => ({ price, ids })),
    updated,
    // Already at that price, or the file has no price for it.
    unchanged: seen.size - updated,
  };
}
