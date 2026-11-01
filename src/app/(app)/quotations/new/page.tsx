import type { Metadata } from "next";
import { newKey } from "@/components/quotation/line-utils";
import { QuotationBuilder } from "@/components/quotation/quotation-builder";
import { requireUser } from "@/lib/auth/dal";
import { defaultHeader, loadBuilderContext } from "@/lib/data/builder";
import { getQuotation } from "@/lib/data/quotations";
import { todayISO } from "@/lib/format";
import type { QuoteLine } from "@/lib/quotation/types";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: PageProps<"/quotations/new">) {
  const user = await requireUser();

  const supabase = await createClient();
  const ctx = await loadBuilderContext(supabase);
  let header = defaultHeader(ctx.settings);
  let lines: QuoteLine[] = [];

  // ?from=<id> duplicates an existing quotation as a fresh draft.
  const from = uuidSchema.safeParse((await searchParams).from);
  if (from.success) {
    const source = await getQuotation(supabase, from.data);
    if (source) {
      const today = todayISO();
      header = { ...source.header, status: "draft", quote_date: today, valid_until: "" };
      lines = source.lines.map((l) => ({ ...l, key: newKey() }));
    }
  }

  return (
    <QuotationBuilder
      id={null}
      quoteNo={null}
      preparedBy={null}
      header={header}
      lines={lines}
      company={ctx.company}
      readOnly={false}
      canDelete={false}
      allowDraftRestore={!from.success}
      userName={user.fullName ?? user.email}
    />
  );
}
