"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { FxRate } from "@/app/api/fx/route";
import { NumInput } from "@/components/ui/num-input";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { currencyLabel } from "@/lib/quotation/calc";

/** Rounded the way rates are usually quoted (4 decimals). */
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Fetches today's rate from the server (two free sources, see /api/fx). */
export async function fetchLiveRate(from: string, to: string): Promise<FxRate> {
  // The timestamp makes every click a new request, so no browser or proxy cache can answer it.
  const res = await fetch(`/api/fx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&t=${Date.now()}`, { cache: "no-store" });
  const json = (await res.json()) as FxRate | { error: string };
  if (!res.ok || "error" in json) throw new Error("error" in json ? json.error : "Could not get a live rate.");
  return { ...json, rate: round4(json.rate) };
}

type Props = {
  from: string;
  to: string;
  rate: number;
  readOnly?: boolean;
  onChange: (rate: number) => void;
  className?: string;
};

/** "1 RMB = [ 14.1479 ] INR  ⟳ Live rate" — editable, with a button that loads today's rate. */
export function ExchangeRateInput({ from, to, rate, readOnly, onChange, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const fx = await fetchLiveRate(from, to);
      onChange(fx.rate);
      setInfo(`Live rate ${fx.rate} · ${fmtDateTime(fx.asOf)} · ${fx.source}`);
      toast.success(`1 ${currencyLabel(from)} = ${fx.rate} ${currencyLabel(to)} · ${fx.source}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">1 {currencyLabel(from)} =</span>
        {readOnly ? (
          <span className="num font-medium">{rate}</span>
        ) : (
          <div className="w-28">
            <NumInput aria-label={`Exchange rate ${from} to ${to}`} value={rate} onValueChange={(v) => v && v > 0 && onChange(round4(v))} min={0.000001} className="num h-8 text-right" />
          </div>
        )}
        <span className="text-slate-500">{currencyLabel(to)}</span>
        {!readOnly ? (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60"
            title="Load today's exchange rate"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Live rate
          </button>
        ) : null}
      </div>
      {info ? <p className="mt-1 text-[11px] text-slate-500">{info}</p> : null}
    </div>
  );
}
