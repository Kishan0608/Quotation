import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";
import type { CustomerPick } from "@/lib/customers/schema";
import { applyCustomerSearch } from "@/lib/data/customers";

const FIELDS = "id, name, contact_person, phone, email, address";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** Saved customers for the quotation's Customer box: names starting with the text first. */
export async function GET(request: NextRequest) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 20, 1), 50);
  const { data, error } = await applyCustomerSearch(auth.supabase.from("customers").select(FIELDS), q).order("name").limit(200);
  if (error) {
    console.error("customer search failed:", error.message, error.code ?? "");
    return NextResponse.json({ error: "Search failed.", code: error.code ?? null }, { status: 500, headers: NO_STORE });
  }
  const lower = q.toLowerCase();
  const items = ((data ?? []) as CustomerPick[])
    .map((c, i) => ({ c, i, starts: c.name.toLowerCase().startsWith(lower) ? 0 : 1 }))
    .sort((a, b) => a.starts - b.starts || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
  return NextResponse.json({ items }, { headers: NO_STORE });
}
