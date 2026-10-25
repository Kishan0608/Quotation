/** Only allow same-site relative paths, to prevent open redirects (e.g. "//evil.com", "/\\evil.com"). */
export function safeNext(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(value) || value.length > 512) return fallback;
  if (value.startsWith("/login") || value.startsWith("/auth/")) return fallback;
  return value;
}
