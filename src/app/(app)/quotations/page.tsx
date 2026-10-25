import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { dbErrorMessage } from "@/lib/data/errors";
import { listQuotations, parseQuotationFilters } from "@/lib/data/quotations";
import { createClient } from "@/lib/supabase/server";
import { QuotationsList } from "./quotations-list";

export const metadata: Metadata = { title: "Quotations" };

export default async function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  const user = await requireUser();
  const filters = parseQuotationFilters(await searchParams);
  const supabase = await createClient();
  const { rows, total, error } = await listQuotations(supabase, filters);
  const canCreate = hasRole(user.role, "editor");

  return (
    <>
      <PageHeader
        title="Quotations"
        actions={
          canCreate ? (
            <ButtonLink href="/quotations/new">
              <FilePlus2 /> New quotation
            </ButtonLink>
          ) : null
        }
      />
      <QuotationsList
        rows={rows}
        total={total}
        filters={filters}
        loadError={error ? dbErrorMessage(error, "Could not load quotations.") : null}
        userId={user.id}
        role={user.role}
      />
    </>
  );
}
