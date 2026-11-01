"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { readPriceText, MAX_TEXT_CHARS } from "@/lib/inventory/ai-text";
import { cleanActualWeight, cleanNote, cleanSupplierText } from "@/lib/inventory/clean-text";
import { existingFor, type ExistingItem, planImport } from "@/lib/inventory/merge";
import { inlineUpdateSchema, inventoryItemSchema, MAX_IMPORT_ROWS, type InventoryInput } from "@/lib/inventory/schema";
import type { InventoryItemInsert, InventoryItemRow } from "@/lib/supabase/database.types";
import { fieldErrors, uuidSchema } from "@/lib/validation";

function done() {
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
}

export async function createInventoryItem(input: unknown): Promise<ActionResult<InventoryItemRow>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { data, error } = await auth.supabase.from("inventory_items").insert(parsed.data).select("*").single();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  done();
  return { ok: true, data, message: "Item added to inventory." };
}

export async function updateInventoryItem(id: unknown, input: unknown): Promise<ActionResult<InventoryItemRow>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const itemId = uuidSchema.safeParse(id);
  if (!itemId.success) return { ok: false, error: "Invalid item." };
  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { data, error } = await auth.supabase.from("inventory_items").update(parsed.data).eq("id", itemId.data).select("*").maybeSingle();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data) return { ok: false, error: "The item was not found or you cannot edit it." };
  done();
  return { ok: true, data, message: "Item updated." };
}

export async function updateInventoryField(id: unknown, field: unknown, value: unknown): Promise<ActionResult<InventoryItemRow>> {
  const auth = await authorize();
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
  const auth = await authorize();
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

async function loadExisting(supabase: Extract<Awaited<ReturnType<typeof authorize>>, { ok: true }>["supabase"]) {
  const existing: ExistingItem[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabase.from("inventory_items").select("id, description, note, unit_price").order("created_at").order("id").range(from, from + 999);
    if (error) return { existing, error };
    existing.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { existing, error: null };
}

export type TextImportRow = {
  /** Its place in the message (1 = first item). */
  row: number;
  /** The item as the message wrote it. */
  source: string;
  data: InventoryInput;
  /** The inventory price it replaces; undefined = a new item. */
  was?: number | null;
  /** What the AI found unclear. */
  problem?: string;
};

/**
 * A supplier's price message (chat text, a list) read by the AI into inventory lines, each marked
 * as a price update of an item already in inventory or as a new item. Nothing is saved here.
 */
export async function readInventoryText(input: unknown): Promise<ActionResult<{ rows: TextImportRow[]; skipped: { row: number; message: string }[] }>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const text = z.string().trim().min(1, "Paste the message first.").max(MAX_TEXT_CHARS, "The message is too long: paste it in parts.").safeParse(input);
  if (!text.success) return { ok: false, error: text.error.issues[0]?.message ?? "Invalid text." };

  const { existing, error } = await loadExisting(auth.supabase);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  let items;
  try {
    items = await readPriceText(text.data, existing);
  } catch (e) {
    console.error("inventory text: AI reader failed:", (e instanceof Error ? e.message : String(e)).slice(0, 200));
    return { ok: false, error: "The AI reader could not read the message right now. Try again in a moment." };
  }
  if (!items) return { ok: false, error: "The AI reader is not set up (GEMINI_API_KEY), so text can't be read. Use an Excel file." };

  const rows: TextImportRow[] = [];
  const skipped: { row: number; message: string }[] = [];
  items.forEach((item, i) => {
    const parsed = inventoryItemSchema.safeParse({
      description: cleanSupplierText(item.name),
      weight_kg: item.weight_kg,
      unit_price: item.price,
      stock_qty: item.qty ?? 0,
      actual_weight: cleanActualWeight(item.actual_weight),
      note: cleanNote(item.note),
    });
    if (!parsed.success) skipped.push({ row: i + 1, message: `${item.source.slice(0, 80)}: ${parsed.error.issues[0]?.message ?? "invalid"}` });
    else rows.push({ row: i + 1, source: item.source.slice(0, 200), data: parsed.data, ...(item.problem ? { problem: item.problem.slice(0, 200) } : {}) });
  });
  const matches = existingFor(rows.map((r) => r.data), existing);
  rows.forEach((r, i) => {
    if (matches[i].length) r.was = matches[i][0].unit_price;
  });
  return { ok: true, data: { rows, skipped } };
}

/** New items are added; items already in inventory only get their price updated. */
export async function importInventoryItems(input: unknown): Promise<ActionResult<ImportSummary>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Import rejected: ${parsed.error.issues[0]?.message ?? "invalid data"}` };

  const { existing, error: loadError } = await loadExisting(auth.supabase);
  if (loadError) return { ok: false, error: dbErrorMessage(loadError) };

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
