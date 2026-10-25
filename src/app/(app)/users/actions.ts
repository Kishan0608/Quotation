"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { uuidSchema } from "@/lib/validation";

const updateSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]).optional(),
  is_active: z.boolean().optional(),
});

export async function updateUserAccess(id: unknown, input: unknown): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const userId = uuidSchema.safeParse(id);
  const parsed = updateSchema.safeParse(input);
  if (!userId.success || !parsed.success || Object.keys(parsed.data).length === 0) return { ok: false, error: "Invalid request." };
  if (userId.data === auth.user.id) return { ok: false, error: "You cannot change your own role or status. Ask another admin." };

  const { data, error } = await auth.supabase.from("profiles").update(parsed.data).eq("id", userId.data).select("id").maybeSingle();
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data) return { ok: false, error: "User not found." };
  revalidatePath("/users");
  return { ok: true, data: undefined, message: "Access updated." };
}
