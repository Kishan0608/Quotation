import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getSessionUser } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { dbErrorMessage } from "@/lib/data/errors";
import { listInventory } from "@/lib/data/inventory";
import { parseInventoryFilters } from "@/lib/inventory/filters";
import { createClient } from "@/lib/supabase/server";
import { InventoryView } from "./inventory-view";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const filters = parseInventoryFilters(await searchParams);
  const supabase = await createClient();
  const [user, list, company] = await Promise.all([
    getSessionUser(),
    listInventory(supabase, filters),
    supabase.from("company_settings").select("base_currency").maybeSingle(),
  ]);
  const canEdit = user ? hasRole(user.role, "editor") : false;

  return (
    <>
      <PageHeader title="Inventory" />
      <InventoryView
        rows={list.rows}
        total={list.total}
        loadError={list.error ? dbErrorMessage(list.error, "Could not load inventory.") : null}
        filters={filters}
        canEdit={canEdit}
        baseCurrency={company.data?.base_currency ?? "CNY"}
      />
    </>
  );
}
