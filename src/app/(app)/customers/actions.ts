"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { customerKey, customerSchema, MAX_CUSTOMER_IMPORT_ROWS, type CustomerInput } from "@/lib/customers/schema";
import { dbErrorMessage } from "@/lib/data/errors";
import { listAllCustomers } from "@/lib/data/customers";
import type { CustomerRow } from "@/lib/supabase/database.types";
import { fieldErrors, uuidSchema } from "@/lib/validation";

const done = () => revalidatePath("/customers");

const duplicateName = (error: { code?: string } | null) => error?.code === "23505";
const DUPLICATE = "A customer with this name is already saved.";

export async function createCustomer(input: unknown): Promise<ActionResult<CustomerRow>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { data, error } = await auth.supabase.from("customers").insert(parsed.data).select("*").single();
  if (error) return { ok: false, error: duplicateName(error) ? DUPLICATE : dbErrorMessage(error), ...(duplicateName(error) ? { fieldErrors: { name: DUPLICATE } } : {}) };
  done();
  return { ok: true, data, message: "Customer saved." };
}

export async function updateCustomer(id: unknown, input: unknown): Promise<ActionResult<CustomerRow>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const customerId = uuidSchema.safeParse(id);
  if (!customerId.success) return { ok: false, error: "Invalid customer." };
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { data, error } = await auth.supabase.from("customers").update(parsed.data).eq("id", customerId.data).select("*").maybeSingle();
  if (error) return { ok: false, error: duplicateName(error) ? DUPLICATE : dbErrorMessage(error), ...(duplicateName(error) ? { fieldErrors: { name: DUPLICATE } } : {}) };
  if (!data) return { ok: false, error: "The customer was not found." };
  done();
  return { ok: true, data, message: "Customer updated." };
}

export async function deleteCustomers(ids: unknown): Promise<ActionResult<{ deleted: number }>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = z.array(uuidSchema).min(1).max(500).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Select between 1 and 500 customers." };

  const { data, error } = await auth.supabase.from("customers").delete().in("id", parsed.data).select("id");
  if (error) return { ok: false, error: dbErrorMessage(error) };
  done();
  const deleted = data?.length ?? 0;
  return { ok: true, data: { deleted }, message: `${deleted} customer${deleted === 1 ? "" : "s"} deleted.` };
}

/**
 * New customers are added; a customer already saved (same name, ignoring case and spaces) gets
 * the details the file gives - an empty cell in the file keeps what is saved.
 */
export async function importCustomers(input: unknown): Promise<ActionResult<{ inserted: number; updated: number; unchanged: number }>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = z.object({ rows: z.array(customerSchema).min(1).max(MAX_CUSTOMER_IMPORT_ROWS) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: `Import rejected: ${parsed.error.issues[0]?.message ?? "invalid data"}` };

  const existing = await listAllCustomers(auth.supabase);
  if (existing.error) return { ok: false, error: dbErrorMessage(existing.error) };
  const byKey = new Map(existing.rows.map((c) => [customerKey(c.name), c]));

  const inserts: CustomerInput[] = [];
  const updates: { id: string; fields: Partial<CustomerInput> }[] = [];
  let unchanged = 0;
  for (const row of parsed.data.rows) {
    const saved = byKey.get(customerKey(row.name));
    if (!saved) {
      inserts.push(row);
      byKey.set(customerKey(row.name), { ...row, id: "", created_at: "", updated_at: "" });
      continue;
    }
    const fields = Object.fromEntries(
      (Object.keys(row) as (keyof CustomerInput)[]).filter((k) => k !== "name" && row[k] != null && row[k] !== saved[k]).map((k) => [k, row[k]]),
    ) as Partial<CustomerInput>;
    if (Object.keys(fields).length && saved.id) updates.push({ id: saved.id, fields });
    else unchanged++;
  }

  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await auth.supabase.from("customers").insert(inserts.slice(i, i + 500));
    if (error) {
      done();
      return { ok: false, error: `${dbErrorMessage(error)} (${i} new customers were added before the error.)` };
    }
  }
  for (const { id, fields } of updates) {
    const { error } = await auth.supabase.from("customers").update(fields).eq("id", id);
    if (error) {
      done();
      return { ok: false, error: dbErrorMessage(error) };
    }
  }
  done();

  const parts = [`Added ${inserts.length} new customer${inserts.length === 1 ? "" : "s"}`];
  if (updates.length) parts.push(`updated ${updates.length}`);
  if (unchanged) parts.push(`${unchanged} already up to date`);
  return { ok: true, data: { inserted: inserts.length, updated: updates.length, unchanged }, message: `${parts.join(", ")}.` };
}
