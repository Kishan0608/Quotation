import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { pageOrLast } from "@/lib/data/paging";
import { listQuotations, parseQuotationFilters } from "@/lib/data/quotations";
import { createClient } from "@/lib/supabase/server";
import { QuotationsList } from "./quotations-list";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  await requireUser();
  const supabase = await createClient();
  const { filters, list } = await pageOrLast(parseQuotationFilters(await searchParams), (f) => listQuotations(supabase, f));
  const { rows, total, error } = list;

  return (
    <>
      <LiveRefresh tables={["quotations", "customers"]} />
      <PageHeader
        title="Quotations"
        actions={
          <ButtonLink href="/quotations/new">
            <FilePlus2 /> New quotation
          </ButtonLink>
        }
      />
      <QuotationsList
        rows={rows}
        total={total}
        filters={filters}
        loadError={error ? dbErrorMessage(error, "Could not load quotations.") : null}
      />
    </>
  );
}
