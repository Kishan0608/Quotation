import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";

export type FxRate = { from: string; to: string; rate: number; asOf: string; source: string };

const CODE = /^[A-Z]{3}$/;

// "Live rate" must never be served from a cache (Next.js would return the old value first
// and refresh in the background), so every click asks the source again.
export const dynamic = "force-dynamic";
const NO_CACHE = { cache: "no-store" } as const;

/** Live market quote (updates during the day, same feed type as Google's converter). */
async function fromYahoo(from: string, to: string): Promise<FxRate | null> {
  // Yahoo has two identical hosts; try the second before falling back to a daily rate.
  let res: Response | null = null;
  for (const host of ["query1", "query2"]) {
    try {
      res = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${from}${to}=X?interval=1m&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        ...NO_CACHE,
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) break;
    } catch {
      res = null;
    }
  }
  if (!res?.ok) return null;
  const json = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number; currency?: string } }[] } };
  const meta = json.chart?.result?.[0]?.meta;
  const rate = meta?.regularMarketPrice;
  if (typeof rate !== "number" || !(rate > 0) || (meta?.currency && meta.currency !== to)) return null;
  return { from, to, rate, asOf: new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(), source: "Yahoo Finance (live)" };
}

async function fromOpenErApi(from: string, to: string): Promise<FxRate | null> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, { ...NO_CACHE, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = (await res.json()) as { result?: string; time_last_update_utc?: string; rates?: Record<string, number> };
  const rate = json.rates?.[to];
  if (json.result !== "success" || typeof rate !== "number" || !(rate > 0)) return null;
  return { from, to, rate, asOf: json.time_last_update_utc ? new Date(json.time_last_update_utc).toISOString() : new Date().toISOString(), source: "open.er-api.com" };
}

async function fromFrankfurter(from: string, to: string): Promise<FxRate | null> {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`, { ...NO_CACHE, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const rate = json.rates?.[to];
  if (typeof rate !== "number" || !(rate > 0)) return null;
  return { from, to, rate, asOf: json.date ? `${json.date}T00:00:00.000Z` : new Date().toISOString(), source: "Frankfurter (ECB)" };
}

/** Latest exchange rate, e.g. /api/fx?from=CNY&to=INR. Live quote first, two daily sources as backup. */
export async function GET(request: NextRequest) {
  const auth = await authorize("viewer");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const from = (request.nextUrl.searchParams.get("from") ?? "CNY").toUpperCase();
  const to = (request.nextUrl.searchParams.get("to") ?? "INR").toUpperCase();
  if (!CODE.test(from) || !CODE.test(to)) return NextResponse.json({ error: "Use 3-letter currency codes." }, { status: 400 });
  if (from === to) return NextResponse.json({ from, to, rate: 1, asOf: new Date().toISOString(), source: "same currency" } satisfies FxRate);

  for (const source of [fromYahoo, fromOpenErApi, fromFrankfurter]) {
    try {
      const fx = await source(from, to);
      if (fx) return NextResponse.json(fx, { headers: { "Cache-Control": "no-store" } });
    } catch {
      // try the next source
    }
  }
  return NextResponse.json({ error: "Could not get a live rate right now. Enter the rate by hand." }, { status: 502 });
}
