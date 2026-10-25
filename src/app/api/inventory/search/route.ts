import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";
import { applyTextSearch } from "@/lib/data/inventory";
import type { PickerItem } from "@/lib/inventory/types";

const FIELDS = "id, item_code, description, weight_kg, unit_price, stock_qty, note, actual_weight";

/**
 * Inventory lookup for the quotation item picker, one page at a time (`limit` + `offset`).
 * The text box accepts several searches separated by commas ("D4, D6, 2\" tee").
 */
export async function GET(request: NextRequest) {
  const auth = await authorize("viewer");
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

  if (groups.length <= 1) {
    const { data, count, error } = await search(groups[0] ?? "", true).range(offset, offset + limit - 1);
    if (error) return NextResponse.json({ error: "Search failed." }, { status: 500 });
    return NextResponse.json({ items: (data ?? []) as PickerItem[], total: count ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
  }

  // Several comma-separated searches: run each one (up to 200 matches), keep the typed order,
  // drop duplicates, then return the requested page.
  const results = await Promise.all(groups.map((g) => search(g, false).limit(200)));
  if (results.some((r) => r.error)) return NextResponse.json({ error: "Search failed." }, { status: 500 });
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
