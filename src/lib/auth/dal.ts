import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
};

type SessionState = { user: SessionUser | null; signedIn: boolean; databaseReady: boolean };

const isMissingTable = (e: { code?: string } | null) => e?.code === "PGRST205" || e?.code === "42P01";

/**
 * Verifies the session JWT (signature + expiry) and loads the profile.
 * Memoised per request with React `cache`.
 */
const loadSession = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return { user: null, signedIn: false, databaseReady: true };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_active")
    .eq("id", userId)
    .maybeSingle();

  const databaseReady = !isMissingTable(profileError);
  if (!profile || !profile.is_active) return { user: null, signedIn: true, databaseReady };
  return {
    user: { id: profile.id, email: profile.email, fullName: profile.full_name },
    signedIn: true,
    databaseReady,
  };
});

/** The signed-in, active user, or null for signed-out, unknown or deactivated users. */
async function getSessionUser(): Promise<SessionUser | null> {
  return (await loadSession()).user;
}

/** For pages: signed-in + active, otherwise off to the login / no-access page. */
export async function requireUser(): Promise<SessionUser> {
  const { user, signedIn, databaseReady } = await loadSession();
  if (user) return user;
  if (!signedIn) redirect("/login");
  // Signed in but no active profile -> explain instead of looping on /login.
  redirect(databaseReady ? "/no-access" : "/no-access?reason=setup");
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** For Server Actions and Route Handlers: re-verifies the caller (signed in, active) every time. */
export async function authorize() {
  const user = await getSessionUser();
  if (!user) return { ok: false as const, error: "Your session has expired. Please sign in again." };
  const supabase = await createClient();
  return { ok: true as const, user, supabase };
}
