"use client";

import { RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fetchLiveRate } from "@/components/quotation/exchange-rate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NumInput } from "@/components/ui/num-input";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";
import { containerCost, type ContainerInputs } from "@/lib/calculator/container-cost";
import { fmtNumber } from "@/lib/format";
import { useLocalStorage, writeLocalStorage } from "@/lib/use-local-storage";

/** The figures typed here, kept on this computer. */
const STORE_KEY = "qp.calculator.container";
const DEFAULTS: ContainerInputs = { containerValue: 0, tax: 0, inland: 0, freightUsd: 0, usdToRmb: 0, freightTimes: 2, rmbToInr: 0, custom: 0, profit: 0 };

function readStored(raw: string | null): ContainerInputs {
  try {
    const saved = raw ? (JSON.parse(raw) as Partial<ContainerInputs>) : {};
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in DEFAULTS && typeof v === "number" && Number.isFinite(v))) };
  } catch {
    return DEFAULTS;
  }
}

const money = (v: number | null) => fmtNumber(v, 0, 2);
const RATE_ERROR = "Could not load today's rates. Type them in by hand.";

/** Today's USD -> RMB and RMB -> INR rates, put into the saved figures; returns the line shown under the card. */
async function loadLiveRates() {
  const [usd, inr] = await Promise.all([fetchLiveRate("USD", "CNY"), fetchLiveRate("CNY", "INR")]);
  const current = readStored(localStorage.getItem(STORE_KEY));
  writeLocalStorage(STORE_KEY, JSON.stringify({ ...current, usdToRmb: usd.rate, rmbToInr: inr.rate }));
  return `Live rates: 1 USD = ${usd.rate} RMB, 1 RMB = ${inr.rate} INR (${inr.source})`;
}

/**
 * Container cost, laid out like the user's sheet: label | rates | amount | unit, every amount
 * (typed or calculated) on the same right edge.
 */
export function ContainerCalculator() {
  const values = readStored(useLocalStorage(STORE_KEY));
  const set = (patch: Partial<ContainerInputs>) => writeLocalStorage(STORE_KEY, JSON.stringify({ ...values, ...patch }));
  const r = containerCost(values);

  // Today's rates: loaded when the page opens and with the button; both stay editable.
  const [loading, setLoading] = useState(false);
  const [rateInfo, setRateInfo] = useState<string | null>(null);
  const loadRates = async () => {
    setLoading(true);
    try {
      setRateInfo(await loadLiveRates());
    } catch {
      toast.error(RATE_ERROR);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadLiveRates().then(setRateInfo, () => toast.error(RATE_ERROR));
  }, []);

  const typed = (key: keyof ContainerInputs, label: string, unit: string) => (
    <Row label={label} unit={unit}>
      <Box value={values[key]} onChange={(v) => set({ [key]: v })} label={label} className="w-full" format={money} />
    </Row>
  );

  return (
    <>
      <PageHeader
        title="Container calculator"
        actions={
          <>
            <Button variant="outline" onClick={() => set({ containerValue: 0, tax: 0, inland: 0, freightUsd: 0, custom: 0, profit: 0 })} title="Clear the amounts (rates stay)">
              <RotateCcw /> Clear
            </Button>
            <Button variant="outline" onClick={loadRates} disabled={loading} title="Load today's USD → RMB and RMB → INR rates">
              <RefreshCw className={cn(loading && "animate-spin")} /> Live rates
            </Button>
          </>
        }
      />
      <Card className="max-w-3xl overflow-hidden">
        <div className="divide-y divide-slate-100">
          {typed("containerValue", "Container value", "RMB")}
          {typed("tax", "Tax", "RMB")}
          {typed("inland", "Inland", "RMB")}
          <Row
            label="Freight"
            unit="RMB"
            detail={
              <>
                <Box value={values.freightUsd} onChange={(v) => set({ freightUsd: v })} label="Freight in USD" className="w-24" format={money} />
                <span>USD ×</span>
                <Box value={values.usdToRmb} onChange={(v) => set({ usdToRmb: v })} label="USD to RMB rate" className="w-24" />
                <span>×</span>
                <Box value={values.freightTimes} onChange={(v) => set({ freightTimes: v })} label="Freight times" className="w-14" />
              </>
            }
          >
            <Value>{money(r.freight)}</Value>
          </Row>
          <Row label="Total" unit="RMB" tone="total">
            <Value>{money(r.totalRmb)}</Value>
          </Row>
          <Row
            label="RMB to INR"
            unit="INR"
            detail={
              <>
                <span>Total ×</span>
                <Box value={values.rmbToInr} onChange={(v) => set({ rmbToInr: v })} label="RMB to INR rate" className="w-24" />
              </>
            }
          >
            <Value>{money(r.totalInr)}</Value>
          </Row>
          {typed("custom", "Custom", "INR")}
          {typed("profit", "Profit", "INR")}
          <Row label="Total" unit="INR" tone="total">
            <Value>{money(r.grandTotal)}</Value>
          </Row>
          <Row label="Final" tone="final" detail={<span>Total ÷ container value</span>}>
            <Value>{r.final == null ? "—" : fmtNumber(r.final, 2, 2)}</Value>
          </Row>
        </div>
      </Card>
      {rateInfo ? <p className="mt-2 text-xs text-slate-500">{rateInfo}</p> : null}
    </>
  );
}

/** One line: label | rates and their boxes | the amount | its unit. */
function Row({ label, detail, unit, tone, children }: { label: string; detail?: ReactNode; unit?: string; tone?: "total" | "final"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(7rem,1fr)_auto_10rem_2.5rem] items-center gap-x-3 px-5 py-2.5",
        tone === "total" && "bg-slate-50 font-semibold text-slate-900",
        tone === "final" && "bg-brand-50 py-3.5 font-semibold text-brand-900 [&_.amount]:text-xl [&_.amount]:font-bold",
      )}
    >
      <span className={cn("text-sm", tone ? "font-semibold" : "text-slate-700")}>{label}</span>
      <div className="flex items-center justify-end gap-1.5 text-sm whitespace-nowrap text-slate-500">{detail}</div>
      {children}
      <span className="text-xs font-normal text-slate-500">{unit}</span>
    </div>
  );
}

/** A calculated amount, its digits lined up with the typed amounts above and below. */
function Value({ children }: { children: ReactNode }) {
  return <span className="amount num pr-[13px] text-right text-sm">{children}</span>;
}

/** A number box (empty for 0). */
function Box({ value, onChange, label, className, format }: { value: number; onChange: (v: number) => void; label: string; className: string; format?: (v: number) => string }) {
  return <NumInput aria-label={label} value={value || null} allowEmpty min={0} format={format} onValueChange={(v) => onChange(v ?? 0)} className={cn("h-9 text-right", className)} />;
}
