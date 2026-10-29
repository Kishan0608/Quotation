import type { InventoryInput } from "./schema";

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[\s()（）]/g, "");

/**
 * The length / note that tells items of the same name apart ("440MM", "STANDARD", "CONCENTRIC",
 * "Q235"). Empty or a stray letter ("S") means the sheet didn't give one: null.
 */
function lengthOf(note: string | null | undefined) {
  const n = norm(note);
  return n.length > 2 ? n : null;
}

/**
 * Two rows are the same item when the Items name and the length / note match, ignoring case,
 * spaces and brackets ("114XSCH40 OIL PIPE" = "114XSCH40(OIL PIPE)"). The Item no. doesn't count:
 * the supplier sheets give the same item different numbers (K2 / K25) or none at all. Another
 * length is another item (165X4.75MM 440MM vs Standard), and so is a concentric vs an eccentric
 * reducer.
 */
export function itemKey(description: string, note?: string | null) {
  return `${norm(description)}|${lengthOf(note) ?? ""}`;
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
 * The inventory item(s) a sheet row is: same name and length. When the row has no length, its
 * Item no. decides, or the name alone when every item of that name has the same length. When
 * the inventory has no length for the item, the name decides.
 */
function sameItems(row: InventoryInput, byName: Map<string, ExistingItem[]>): ExistingItem[] {
  const named = byName.get(norm(row.description)) ?? [];
  if (!named.length) return [];
  const length = lengthOf(row.note);
  if (length) {
    const exact = named.filter((e) => lengthOf(e.note) === length);
    return exact.length ? exact : named.filter((e) => lengthOf(e.note) == null);
  }
  const code = norm(row.item_code);
  const byCode = code ? named.filter((e) => norm(e.item_code) === code) : [];
  if (byCode.length) return byCode;
  return new Set(named.map((e) => lengthOf(e.note))).size === 1 ? named : [];
}

/**
 * An item that is already in inventory only gets its price updated (every row of
 * that item); nothing else changes. New items are added. When an item appears
 * more than once in the file, the last price wins.
 */
export function planImport(rows: InventoryInput[], existing: ExistingItem[]): ImportPlan {
  const byName = new Map<string, ExistingItem[]>();
  for (const e of existing) byName.set(norm(e.description), [...(byName.get(norm(e.description)) ?? []), e]);

  const groups = new Map<string, ExistingItem[]>();
  const lastPrice = new Map<string, number>();
  const newItems: InventoryInput[] = [];
  /** The new items so far, by name (id = their place in newItems). */
  const newByName = new Map<string, ExistingItem[]>();
  for (const row of rows) {
    const same = sameItems(row, byName);
    if (same.length) {
      const key = same
        .map((e) => e.id)
        .sort()
        .join(",");
      groups.set(key, same);
      if (row.unit_price != null) lastPrice.set(key, row.unit_price);
      continue;
    }
    // A new item: the same item again later in the file only changes its price.
    const twin = sameItems(row, newByName)[0];
    if (twin) {
      const i = Number(twin.id);
      if (row.unit_price != null) newItems[i] = { ...newItems[i], unit_price: row.unit_price };
    } else {
      newItems.push(row);
      const name = norm(row.description);
      const entry = { id: String(newItems.length - 1), item_code: row.item_code ?? null, description: row.description, note: row.note ?? null, unit_price: null };
      newByName.set(name, [...(newByName.get(name) ?? []), entry]);
    }
  }

  const idsByPrice = new Map<number, string[]>();
  let updated = 0;
  for (const [key, price] of lastPrice) {
    const stale = groups.get(key)!.filter((e) => e.unit_price == null || Number(e.unit_price) !== price);
    if (!stale.length) continue;
    updated++;
    idsByPrice.set(price, [...(idsByPrice.get(price) ?? []), ...stale.map((e) => e.id)]);
  }

  return {
    inserts: newItems,
    priceUpdates: [...idsByPrice].map(([price, ids]) => ({ price, ids })),
    updated,
    // Already at that price, or the file has no price for it.
    unchanged: groups.size - updated,
  };
}
