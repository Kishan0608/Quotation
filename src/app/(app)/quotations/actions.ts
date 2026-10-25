"use server";

import { revalidatePath } from "next/cache";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { saveQuotationSchema } from "@/lib/quotation/schema";
import { firstError, uuidSchema } from "@/lib/validation";

export async function saveQuotation(input: unknown): Promise<ActionResult<{ id: string; quoteNo: string }>> {
  const auth = await authorize("editor");
  if (!auth.ok) return auth;
  const parsed = saveQuotationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { id, header, lines } = parsed.data;
  const { data, error } = await auth.supabase.rpc("save_quotation", {
    p_id: id,
    p_header: header,
    p_items: lines,
  });
  if (error || !data) return { ok: false, error: dbErrorMessage(error, "Could not save the quotation.") };

  revalidatePath("/quotations");
  revalidatePath("/dashboard");
  revalidatePath(`/quotations/${data.id}`);
  return { ok: true, data: { id: data.id, quoteNo: data.quote_no }, message: `Quotation ${data.quote_no} saved.` };
}

export async function deleteQuotation(id: unknown): Promise<ActionResult> {
  const auth = await authorize("editor");
  if (!auth.ok) return auth;
  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: "Invalid quotation." };

  const { data, error } = await auth.supabase.from("quotations").delete().eq("id", parsedId.data).select("quote_no").maybeSingle();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data) return { ok: false, error: "You can only delete quotations you created." };
  revalidatePath("/quotations");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: `Quotation ${data.quote_no} deleted.` };
}
