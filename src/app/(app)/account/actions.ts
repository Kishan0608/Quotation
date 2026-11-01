"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, type ActionResult } from "@/lib/auth/dal";
import { dbErrorMessage } from "@/lib/data/errors";
import { fieldErrors, optText } from "@/lib/validation";

export async function updateProfileName(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = z.object({ full_name: optText(120) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Name must be 120 characters or fewer." };
  const { error } = await auth.supabase.from("profiles").update({ full_name: parsed.data.full_name }).eq("id", auth.user.id);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Name updated." };
}

const passwordSchema = z
  .object({
    current_password: z.string().max(200).optional(),
    new_password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(72, "Use 72 characters or fewer")
      .regex(/[A-Za-z]/, "Include at least one letter")
      .regex(/\d/, "Include at least one number"),
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, { message: "Passwords do not match", path: ["confirm_password"] });

export async function changePassword(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  // A session that came from a password-reset link in the last 15 minutes may
  // set a new password directly; otherwise the current password is required.
  const { data } = await auth.supabase.auth.getClaims();
  const amr = (data?.claims?.amr ?? []) as { method: string; timestamp: number }[];
  const now = Date.now() / 1000;
  const fromRecovery = amr.some((a) => (a.method === "recovery" || a.method === "otp") && now - a.timestamp < 15 * 60);

  if (!fromRecovery) {
    if (!parsed.data.current_password) return { ok: false, error: "Enter your current password.", fieldErrors: { current_password: "Required" } };
    const { error } = await auth.supabase.auth.signInWithPassword({ email: auth.user.email, password: parsed.data.current_password });
    if (error) return { ok: false, error: "Your current password is incorrect.", fieldErrors: { current_password: "Incorrect password" } };
  }

  const { error } = await auth.supabase.auth.updateUser({ password: parsed.data.new_password });
  if (error) {
    const msg =
      error.code === "same_password"
        ? "The new password must be different from the current one."
        : error.code === "weak_password"
          ? "That password is too weak. Try a longer one."
          : "Could not update the password. Please try again.";
    return { ok: false, error: msg };
  }
  return { ok: true, data: undefined, message: "Password updated." };
}
