import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";
import { applyPrefixSearch, applyTextSearch } from "@/lib/data/inventory";
import { sizeQuery } from "@/lib/import/match";
import type { PickerItem } from "@/lib/inventory/types";

const FIELDS = "id, description, weight_kg, unit_price, stock_qty, note, actual_weight";

/**
 * Inventory lookup for the quotation item picker, one page at a time (`limit` + `offset`).
 * The text box accepts several searches separated by commas ("D4, D6, 2\" tee").
 */
export async function GET(request: NextRequest) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const p = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(p.get("limit")) || 40, 1), 100);
  const offset = Math.min(Math.max(Math.floor(Number(p.get("offset")) || 0), 0), 100_000);
  const groups = (p.get("q") ?? "")
    .slice(0, 300)
    .split(/[,;\n]+/)
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 10);

  const search = (text: string, withCount: boolean) =>
    applyTextSearch(auth.supabase.from("inventory_items").select(FIELDS, withCount ? { count: "exact" } : undefined), text)
      .order("created_at")
      .order("id");
  // A size typed the customer's way ("1" B/2.5 MM", "1.1/2" SL/40") also looks for the
  // inventory's own name (33X2.5MM, 11/2"XSCH40), first.
  const bySize = (text: string) => {
    const q = sizeQuery(text);
    if (!q) return null;
    return applyTextSearch(applyPrefixSearch(auth.supabase.from("inventory_items").select(FIELDS), q.prefixes), q.words)
      .order("created_at")
      .order("id")
      .limit(200);
  };
  const searches = groups.flatMap((g) => [bySize(g), search(g, false).limit(200)]).filter((s) => s != null);

  if (searches.length <= 1) {
    const { data, count, error } = await search(groups[0] ?? "", true).range(offset, offset + limit - 1);
    if (error) {
      console.error("inventory search failed:", error.message, error.code ?? "");
      return NextResponse.json({ error: "Search failed." }, { status: 500 });
    }
    return NextResponse.json({ items: (data ?? []) as PickerItem[], total: count ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
  }

  // Several searches (comma-separated, or a size the customer's way): run each one (up to 200
  // matches), keep the typed order, drop duplicates, then return the requested page.
  const results = await Promise.all(searches);
  const failed = results.find((r) => r.error)?.error;
  if (failed) {
    console.error("inventory search failed:", failed.message, failed.code ?? "");
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
  const seen = new Set<string>();
  const merged: PickerItem[] = [];
  for (const r of results) {
    for (const item of (r.data ?? []) as PickerItem[]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }
  return NextResponse.json({ items: merged.slice(offset, offset + limit), total: merged.length }, { headers: { "Cache-Control": "private, no-store" } });
}
