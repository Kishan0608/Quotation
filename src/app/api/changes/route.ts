import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";

const TABLES = { inventory: "inventory_items", customers: "customers", quotations: "quotations" } as const;
type TableKey = keyof typeof TABLES;

/**
 * A short stamp per table (newest change + row count): when it differs from the last one, a page
 * showing that table reloads its data. Deleted rows change the count.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const asked = (request.nextUrl.searchParams.get("tables") ?? "").split(",").filter((t): t is TableKey => t in TABLES);
  const stamps: Partial<Record<TableKey, string>> = {};
  await Promise.all(
    asked.map(async (key) => {
      const { data, count, error } = await auth.supabase.from(TABLES[key]).select("updated_at", { count: "exact" }).order("updated_at", { ascending: false }).limit(1);
      if (!error) stamps[key] = `${(data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? ""}|${count ?? 0}`;
    }),
  );
  return NextResponse.json({ stamps }, { headers: { "Cache-Control": "private, no-store" } });
}
