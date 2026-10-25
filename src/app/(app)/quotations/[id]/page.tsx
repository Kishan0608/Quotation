import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuotationBuilder } from "@/components/quotation/quotation-builder";
import { requireUser } from "@/lib/auth/dal";
import { loadBuilderContext } from "@/lib/data/builder";
import { getQuotation } from "@/lib/data/quotations";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotationPage({ params }: PageProps<"/quotations/[id]">) {
  const user = await requireUser();
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) notFound();

  const supabase = await createClient();
  const [quotation, ctx] = await Promise.all([getQuotation(supabase, id.data), loadBuilderContext(supabase)]);
  if (!quotation) notFound();

  // Mirrors the RLS policy: admins edit everything, editors edit their own.
  const canModify = user.role === "admin" || (user.role === "editor" && quotation.createdBy === user.id);

  return (
    <QuotationBuilder
      key={quotation.id}
      id={quotation.id}
      quoteNo={quotation.quoteNo}
      preparedBy={quotation.preparedBy}
      header={quotation.header}
      lines={quotation.lines}
      company={ctx.company}
      readOnly={!canModify}
      canDelete={canModify}
      allowDraftRestore={false}
      userName={user.fullName ?? user.email}
    />
  );
}
