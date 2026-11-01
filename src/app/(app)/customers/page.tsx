import type { Metadata } from "next";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { parseCustomerFilters } from "@/lib/customers/filters";
import { listCustomers } from "@/lib/data/customers";
import { dbErrorMessage } from "@/lib/data/errors";
import { createClient } from "@/lib/supabase/server";
import { CustomersView } from "./customers-view";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const filters = parseCustomerFilters(await searchParams);
  const list = await listCustomers(await createClient(), filters);

  return (
    <>
      <PageHeader title="Customers" />
      <LiveRefresh tables={["customers"]} />
      <CustomersView rows={list.rows} total={list.total} filters={filters} loadError={list.error ? dbErrorMessage(list.error, "Could not load customers.") : null} />
    </>
  );
}
