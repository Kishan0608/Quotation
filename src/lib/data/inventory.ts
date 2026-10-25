import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INVENTORY_SORTS, type InventoryFilters } from "@/lib/inventory/filters";
import type { Database, InventoryItemRow } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** Wraps a value in PostgREST double quotes so commas, brackets and quotes in user input stay literal. */
const quoteValue = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Every search word must appear (AND) in the item no., the item name or the note (OR), ignoring case. */
export function applyTextSearch<Q extends { or: (filters: string) => Q }>(query: Q, text: string) {
  let q = query;
  for (const term of text.split(/\s+/).filter(Boolean).slice(0, 6)) {
    const pattern = quoteValue(`%${escapeLike(term.slice(0, 50))}%`);
    q = q.or(`item_code.ilike.${pattern},description.ilike.${pattern},note.ilike.${pattern}`);
  }
  return q;
}

export async function listInventory(supabase: Client, f: InventoryFilters) {
  const from = (f.page - 1) * f.pageSize;
  const { data, count, error } = await applyTextSearch(supabase.from("inventory_items").select("*", { count: "exact" }), f.q)
    .order(INVENTORY_SORTS[f.sort], { ascending: f.dir === "asc", nullsFirst: false })
    .order("created_at")
    .order("id")
    .range(from, from + f.pageSize - 1);
  return { rows: (data ?? []) as InventoryItemRow[], total: count ?? 0, error };
}

/** All rows matching the search (for exports), fetched in pages of 1000. */
export async function listAllInventory(supabase: Client, q: string, max = 20_000) {
  const rows: InventoryItemRow[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await applyTextSearch(supabase.from("inventory_items").select("*"), q)
      .order("created_at")
      .order("id")
      .range(from, from + 999);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as InventoryItemRow[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}
