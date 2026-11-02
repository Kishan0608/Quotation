import type { Metadata } from "next";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { parseCustomerFilters } from "@/lib/customers/filters";
import { listCustomers } from "@/lib/data/customers";
import { dbErrorMessage } from "@/lib/data/errors";
import { pageOrLast } from "@/lib/data/paging";
import { createClient } from "@/lib/supabase/server";
import { CustomersView } from "./customers-view";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const supabase = await createClient();
  const { filters, list } = await pageOrLast(parseCustomerFilters(await searchParams), (f) => listCustomers(supabase, f));

  return (
    <>
      <PageHeader title="Customers" />
      <LiveRefresh tables={["customers"]} />
      <CustomersView rows={list.rows} total={list.total} filters={filters} loadError={list.error ? dbErrorMessage(list.error, "Could not load customers.") : null} />
    </>
  );
}
