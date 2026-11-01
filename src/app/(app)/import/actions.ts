"use server";

import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { aiColumnChoices } from "@/lib/import/ai-columns";
import { TOP_COLS, TOP_ROWS, type ColumnChoice } from "@/lib/import/sheet-columns";

const topsSchema = z
  .array(z.object({ sheet: z.string().max(100), rows: z.array(z.array(z.string().max(60)).max(TOP_COLS)).max(TOP_ROWS) }))
  .max(10);

/**
 * The AI's reading of which column holds which field, for an Excel import (customers or
 * inventory). `null` data = the AI is not set up or failed; the headers' rules are used then.
 */
export async function suggestColumns(kind: unknown, tops: unknown): Promise<ActionResult<ColumnChoice<string>[] | null>> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const k = z.enum(["customers", "inventory"]).safeParse(kind);
  const t = topsSchema.safeParse(tops);
  if (!k.success || !t.success) return { ok: false, error: "Invalid sheet." };
  return { ok: true, data: await aiColumnChoices(k.data, t.data) };
}
