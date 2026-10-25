import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/** Handles links from Supabase emails (password reset, invite, email change). */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code && code.length < 200) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (ok) {
    const [path, query] = next.split("?");
    target.pathname = path;
    if (query) target.search = `?${query}`;
  } else {
    target.pathname = "/login";
    target.searchParams.set("error", "link");
  }
  return NextResponse.redirect(target);
}
