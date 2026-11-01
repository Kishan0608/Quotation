"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { parseNpsValue } from "@/lib/pipe/sizes";
import { SCHEDULES } from "@/lib/pipe/schedules";
import type { PipeSizeRow } from "@/lib/supabase/database.types";
import { optInt, optNum, reqNum } from "@/lib/validation";

const wall = optNum(0.01, 199);

const sizeSchema = z
  .object({
    nps: z.preprocess((v) => String(v ?? "").replace(/"/g, "").trim(), z.string().regex(/^\d{1,2}( \d\/\d)?$|^\d\/\d$/, 'Use a format like 1/2, 1 1/2 or 12')),
    dn: optInt(1, 9999),
    od_mm: reqNum(0.1, 9999),
    ...Object.fromEntries(SCHEDULES.map((s) => [s.key, wall])),
  })
  .transform((v) => ({ ...v, nps_value: parseNpsValue(v.nps) ?? 0 }));

function done() {
  revalidatePath("/sizes");
  revalidatePath("/inventory");
  revalidatePath("/quotations", "layout");
}

export async function savePipeSize(id: unknown, input: unknown): Promise<ActionResult<PipeSizeRow>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = sizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid size." };
  if (!parsed.data.nps_value) return { ok: false, error: "Could not read the NPS value." };

  const payload = parsed.data as unknown as Omit<PipeSizeRow, "id" | "created_at" | "updated_at">;
  const sizeId = z.coerce.number().int().positive().safeParse(id);
  const query = sizeId.success
    ? auth.supabase.from("pipe_sizes").update(payload).eq("id", sizeId.data).select("*").maybeSingle()
    : auth.supabase.from("pipe_sizes").insert(payload).select("*").maybeSingle();
  const { data, error } = await query;
  if (error) return { ok: false, error: error.code === "23505" ? "That NPS or DN already exists in the chart." : dbErrorMessage(error) };
  if (!data) return { ok: false, error: "Size not found." };
  done();
  return { ok: true, data, message: `Size ${data.nps}" saved.` };
}

export async function deletePipeSize(id: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const sizeId = z.coerce.number().int().positive().safeParse(id);
  if (!sizeId.success) return { ok: false, error: "Invalid size." };
  const { error } = await auth.supabase.from("pipe_sizes").delete().eq("id", sizeId.data);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  done();
  return { ok: true, data: undefined, message: "Size removed from the chart." };
}
