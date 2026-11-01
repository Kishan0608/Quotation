import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerFilters } from "@/lib/customers/filters";
import type { CustomerRow, Database } from "@/lib/supabase/database.types";
import { escapeLike, quoteValue } from "./like";

type Client = SupabaseClient<Database>;

/** Every search word must appear (AND) in the name, contact, phone, email or address (OR), ignoring case. */
export function applyCustomerSearch<Q extends { or: (filters: string) => Q }>(query: Q, text: string) {
  let q = query;
  for (const term of text.split(/\s+/).filter(Boolean).slice(0, 6)) {
    const p = quoteValue(`%${escapeLike(term.slice(0, 50))}%`);
    q = q.or(`name.ilike.${p},contact_person.ilike.${p},phone.ilike.${p},email.ilike.${p},address.ilike.${p}`);
  }
  return q;
}

export async function listCustomers(supabase: Client, f: CustomerFilters) {
  const from = (f.page - 1) * f.pageSize;
  const { data, count, error } = await applyCustomerSearch(supabase.from("customers").select("*", { count: "exact" }), f.q)
    .order("name")
    .order("id")
    .range(from, from + f.pageSize - 1);
  return { rows: (data ?? []) as CustomerRow[], total: count ?? 0, error };
}

/** All customers matching the search (for exports and imports), in pages of 1000. */
export async function listAllCustomers(supabase: Client, q = "", max = 20_000) {
  const rows: CustomerRow[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await applyCustomerSearch(supabase.from("customers").select("*"), q)
      .order("name")
      .order("id")
      .range(from, from + 999);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as CustomerRow[]));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}
