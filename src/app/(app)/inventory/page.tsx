import type { Metadata } from "next";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { dbErrorMessage } from "@/lib/data/errors";
import { listInventory } from "@/lib/data/inventory";
import { pageOrLast } from "@/lib/data/paging";
import { parseInventoryFilters } from "@/lib/inventory/filters";
import { createClient } from "@/lib/supabase/server";
import { InventoryView } from "./inventory-view";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const supabase = await createClient();
  const [{ filters, list }, company] = await Promise.all([
    pageOrLast(parseInventoryFilters(await searchParams), (f) => listInventory(supabase, f)),
    supabase.from("company_settings").select("base_currency").maybeSingle(),
  ]);

  return (
    <>
      <PageHeader title="Inventory" />
      <LiveRefresh tables={["inventory"]} />
      <InventoryView
        rows={list.rows}
        total={list.total}
        loadError={list.error ? dbErrorMessage(list.error, "Could not load inventory.") : null}
        filters={filters}
        baseCurrency={company.data?.base_currency ?? "CNY"}
      />
    </>
  );
}
