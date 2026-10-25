"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { currencyCode, fieldErrors, optText, reqNum, reqText } from "@/lib/validation";

const settingsSchema = z.object({
  company_name: reqText(120, "Company name"),
  tagline: optText(160),
  address: optText(500),
  phone: optText(60),
  email: z.preprocess((v) => (v == null || String(v).trim() === "" ? null : String(v).trim()), z.email("Enter a valid email").max(120).nullable()),
  website: optText(120),
  tax_id: optText(60),
  base_currency: currencyCode,
  default_currency: currencyCode,
  default_exchange_rate: reqNum(0.000001, 1_000_000),
  default_margin_pct: reqNum(-100, 1000, 0),
  default_tax_label: z.preprocess((v) => String(v ?? "").trim() || "Tax", z.string().max(30)),
  default_tax_pct: reqNum(0, 100, 0),
  default_validity_days: z.preprocess((v) => Number(v), z.number().int().min(1).max(365)),
  quote_prefix: z.preprocess((v) => String(v ?? "").trim().toUpperCase(), z.string().regex(/^[A-Z0-9-]{1,10}$/, "Letters, numbers and dashes only (max 10)")),
  default_terms: optText(4000),
  bank_details: optText(2000),
  footer_note: optText(300),
});

export async function updateCompanySettings(input: unknown): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { data, error } = await auth.supabase.from("company_settings").update(parsed.data).eq("id", true).select("id").maybeSingle();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data) return { ok: false, error: "Settings row not found. Re-run the database migration." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Company settings saved." };
}
