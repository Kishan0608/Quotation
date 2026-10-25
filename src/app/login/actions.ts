"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; message?: string; email?: string };

const signInSchema = z.object({
  email: z.email().max(160),
  password: z.string().min(1).max(200),
  next: z.string().max(512).optional(),
});

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
    next: String(formData.get("next") ?? "") || undefined,
  });
  if (!parsed.success) return { error: "Enter a valid email address and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    // One generic message so the form does not reveal which accounts exist.
    const message =
      error.status === 429
        ? "Too many sign-in attempts. Please wait a minute and try again."
        : error.code === "email_not_confirmed"
          ? "Please confirm your email address before signing in."
          : "Invalid email or password.";
    return { error: message, email: parsed.data.email };
  }

  redirect(safeNext(parsed.data.next));
}

async function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = z.email().max(160).safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent("/account?reset=1")}`,
  });
  if (error?.status === 429) return { error: "Too many requests. Please wait a minute and try again." };

  // Same response whether or not the account exists.
  return { message: "If an account exists for that email, a password reset link is on its way." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
