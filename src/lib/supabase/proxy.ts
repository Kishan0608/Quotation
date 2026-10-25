import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

const PUBLIC_PATHS = ["/login", "/auth/confirm"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used for widths in the grid; no remote CSS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when served over HTTPS, so the app still works on a plain-HTTP office LAN.
    ...(process.env.SITE_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * Runs on every page request: sets a per-request CSP nonce, refreshes the
 * Supabase session cookie and keeps signed-out visitors on the login page.
 * Pages and Server Actions still verify the user themselves (defence in depth).
 */
export async function updateSession(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const forwardHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  let userId: string | null = null;
  try {
    const { url, key } = getSupabaseEnv();
    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: forwardHeaders() } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    userId = (data?.claims?.sub as string | undefined) ?? null;
  } catch (error) {
    console.error("[proxy] session check failed:", error instanceof Error ? error.message : error);
  }

  const withCookies = (target: NextResponse) => {
    response.cookies.getAll().forEach((c) => target.cookies.set(c));
    target.headers.set("Content-Security-Policy", csp);
    target.headers.set("Cache-Control", "private, no-store");
    return target;
  };

  if (!userId && !isPublicPath(pathname)) {
    if (isApi) {
      return withCookies(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return withCookies(NextResponse.redirect(loginUrl));
  }

  if (userId && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/dashboard";
    home.search = "";
    return withCookies(NextResponse.redirect(home));
  }

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
