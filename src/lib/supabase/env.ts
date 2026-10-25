// Server-side only: the app never talks to Supabase from the browser, so the
// URL and key are read without the NEXT_PUBLIC_ prefix and never bundled into
// client JavaScript. NEXT_PUBLIC_* names are accepted as a fallback.
export function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return { url, key };
}
