import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";
import type { PickerItem } from "@/lib/inventory/types";

const FIELDS = "id, description, weight_kg, unit_price, stock_qty, note, actual_weight, updated_at";
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Inventory items added or changed after `after` (the database's own updated_at, so the server
 * and database clocks never disagree). Without `after`: only the cursor to start from.
 * The quotation page asks every few seconds and updates its lines.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const after = request.nextUrl.searchParams.get("after");
  if (!after || Number.isNaN(Date.parse(after))) {
    const { data, error } = await auth.supabase.from("inventory_items").select("updated_at").order("updated_at", { ascending: false }).limit(1);
    if (error) return NextResponse.json({ error: "Could not read the inventory." }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ cursor: data?.[0]?.updated_at ?? new Date(0).toISOString(), items: [] }, { headers: NO_STORE });
  }
  const { data, error } = await auth.supabase.from("inventory_items").select(FIELDS).gt("updated_at", after).order("updated_at").limit(500);
  if (error) return NextResponse.json({ error: "Could not read the inventory." }, { status: 500, headers: NO_STORE });
  const rows = (data ?? []) as (PickerItem & { updated_at: string })[];
  return NextResponse.json({ cursor: rows.at(-1)?.updated_at ?? after, items: rows }, { headers: NO_STORE });
}
