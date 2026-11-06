import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/dal";
import type { PickerItem } from "@/lib/inventory/types";

const FIELDS = "id, description, weight_kg, unit_price, stock_qty, note, actual_weight";

// Prices change during the day: never served from a cache.
export const dynamic = "force-dynamic";

/** The whole inventory (a few hundred items) for the search above the quotation sheet, which filters and sorts it in the browser. */
export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { data, error } = await auth.supabase.from("inventory_items").select(FIELDS).order("created_at").order("id").limit(10_000);
  if (error) {
    console.error("inventory list failed:", error.message, error.code ?? "");
    return NextResponse.json({ error: "Could not load the inventory." }, { status: 500 });
  }
  return NextResponse.json({ items: (data ?? []) as PickerItem[] }, { headers: { "Cache-Control": "private, no-store" } });
}
