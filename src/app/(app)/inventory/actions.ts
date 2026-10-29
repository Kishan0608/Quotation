"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { type ExistingItem, planImport } from "@/lib/inventory/merge";
import { inlineUpdateSchema, inventoryItemSchema, MAX_IMPORT_ROWS } from "@/lib/inventory/schema";
import type { InventoryItemInsert, InventoryItemRow } from "@/lib/supabase/database.types";
import { fieldErrors, uuidSchema } from "@/lib/validation";

function done() {
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

export async function createInventoryItem(input: unknown): Promise<ActionResult<InventoryItemRow>> {
  const auth = await authorize("editor");
  if (!auth.ok) return auth;
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { data, error } = await auth.supabase.from("inventory_items").insert(parsed.data).select("*").single();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  done();
  return { ok: true, data, message: "Item added to inventory." };
}

export async function updateInventoryItem(id: unknown, input: unknown): Promise<ActionResult<InventoryItemRow>> {
  const auth = await authorize("editor");
  if (!auth.ok) return auth;
  const itemId = uuidSchema.safeParse(id);
  if (!itemId.success) return { ok: false, error: "Invalid item." };
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  // Item numbers are not shown or edited any more; the one stored stays as it is.
  const fields: Partial<typeof parsed.data> = { ...parsed.data };
  delete fields.item_code;
  const { data, error } = await auth.supabase.from("inventory_items").update(fields).eq("id", itemId.data).select("*").maybeSingle();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data) return { ok: false, error: "The item was not found or you cannot edit it." };
  done();
  return { ok: true, data, message: "Item updated." };
}

export async function updateInventoryField(id: unknown, field: unknown, value: unknown): Promise<ActionResult<InventoryItemRow>> {
  const auth = await authorize("editor");
  if (!auth.ok) return auth;
  const itemId = uuidSchema.safeParse(id);
  const parsed = inlineUpdateSchema.safeParse({ field, value });
  if (!itemId.success || !parsed.success) return { ok: false, error: parsed.error?.issues[0]?.message ?? "Invalid value." };

  const { data, error } = await auth.supabase
    .from("inventory_items")
    .update({ [parsed.data.field]: parsed.data.value } as Partial<InventoryItemInsert>)
    .eq("id", itemId.data)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data) return { ok: false, error: "The item was not found or you cannot edit it." };
  done();
  return { ok: true, data };
}

export async function deleteInventoryItems(ids: unknown): Promise<ActionResult<{ deleted: number }>> {
  const auth = await authorize("editor");
  if (!auth.ok) return auth;
  const parsed = z.array(uuidSchema).min(1).max(500).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Select between 1 and 500 items." };

  const { data, error } = await auth.supabase.from("inventory_items").delete().in("id", parsed.data).select("id");
  if (error) return { ok: false, error: dbErrorMessage(error) };
  done();
  const deleted = data?.length ?? 0;
  return { ok: true, data: { deleted }, message: `${deleted} item${deleted === 1 ? "" : "s"} deleted.` };
}

const importSchema = z.object({
  rows: z.array(inventoryItemSchema).min(1).max(MAX_IMPORT_ROWS),
});

type ImportSummary = { inserted: number; updated: number; unchanged: number };

/** New items are added; items already in inventory only get their price updated. */
export async function importInventoryItems(input: unknown): Promise<ActionResult<ImportSummary>> {
  const auth = await authorize("editor");
  if (!auth.ok) return auth;
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Import rejected: ${parsed.error.issues[0]?.message ?? "invalid data"}` };

  const existing: ExistingItem[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await auth.supabase
      .from("inventory_items")
      .select("id, item_code, description, note, unit_price")
      .order("created_at")
      .order("id")
      .range(from, from + 999);
    if (error) return { ok: false, error: dbErrorMessage(error) };
    existing.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const plan = planImport(parsed.data.rows, existing);

  for (const { price, ids } of plan.priceUpdates) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await auth.supabase.from("inventory_items").update({ unit_price: price }).in("id", ids.slice(i, i + 200));
      if (error) return { ok: false, error: dbErrorMessage(error) };
    }
  }

  // Rows inserted together would share one timestamp; give each its own
  // (1 ms apart, set here on the server) so the list keeps the Excel order.
  const start = Date.now();
  let inserted = 0;
  for (let i = 0; i < plan.inserts.length; i += 500) {
    const batch = plan.inserts.slice(i, i + 500).map((row, j) => ({ ...row, created_at: new Date(start + i + j).toISOString() }));
    const { error } = await auth.supabase.from("inventory_items").insert(batch);
    if (error) {
      done();
      return { ok: false, error: `${dbErrorMessage(error)} (prices were updated and ${inserted} new items added before the error.)` };
    }
    inserted += batch.length;
  }
  done();

  const parts = [`Added ${inserted} new item${inserted === 1 ? "" : "s"}`];
  if (plan.updated) parts.push(`updated the price of ${plan.updated} item${plan.updated === 1 ? "" : "s"}`);
  if (plan.unchanged) parts.push(`${plan.unchanged} already up to date`);
  return { ok: true, data: { inserted, updated: plan.updated, unchanged: plan.unchanged }, message: `${parts.join(", ")}.` };
}
