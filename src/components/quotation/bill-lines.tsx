"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { NumInput } from "@/components/ui/num-input";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtQty, fmtWeight } from "@/lib/format";
import { adjustmentTitle, currencyLabel } from "@/lib/quotation/calc";
import { amountInWords } from "@/lib/quotation/currency";
import { MAX_ADJUSTMENTS } from "@/lib/quotation/schema";
import type { Adjustment, AdjustmentKind, QuoteTotals } from "@/lib/quotation/types";
import { ExchangeRateInput } from "./exchange-rate";
import { newKey } from "./line-utils";

const KINDS: { kind: AdjustmentKind; label: string; name: string; mode: Adjustment["mode"] }[] = [
  { kind: "discount", label: "Discount", name: "Discount", mode: "percent" },
  { kind: "charge", label: "Charge", name: "Freight", mode: "amount" },
  { kind: "tax", label: "Tax", name: "GST", mode: "percent" },
];

type Draft = { key: string | null; kind: AdjustmentKind; label: string; mode: Adjustment["mode"]; value: number | null };

type Props = {
  adjustments: Adjustment[];
  totals: QuoteTotals;
  currency: string;
  baseCurrency: string;
  readOnly: boolean;
  onChange: (next: Adjustment[]) => void;
  onRateChange: (rate: number) => void;
};

/**
 * Lines are in RMB: Final total (RMB) -> x exchange rate -> amount in the quotation
 * currency -> any number of discounts / charges / taxes -> grand total.
 */
export function BillLines({ adjustments, totals, currency, baseCurrency, readOnly, onChange, onRateChange }: Props) {
  const base = currencyLabel(baseCurrency);
  const converts = currency !== baseCurrency;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setError(null);
    setDraft({ key: null, kind: "discount", label: "", mode: "percent", value: null });
  };
  const openEdit = (a: Adjustment) => {
    setError(null);
    setDraft({ key: a.key, kind: a.kind, label: a.label, mode: a.mode, value: a.value });
  };

  const save = () => {
    if (!draft) return;
    if (draft.value == null || draft.value <= 0) return setError("Enter a value.");
    if (draft.mode === "percent" && draft.value > 100) return setError("Percentage cannot be more than 100.");
    const label = draft.label.trim() || KINDS.find((k) => k.kind === draft.kind)!.name;
    const line: Adjustment = { key: draft.key ?? newKey(), kind: draft.kind, label: label.slice(0, 40), mode: draft.mode, value: draft.value };
    onChange(draft.key ? adjustments.map((a) => (a.key === draft.key ? line : a)) : [...adjustments, line]);
    setDraft(null);
  };

  const row = (label: string, value: string, strong = false) => (
    <div key={label} className="flex justify-between px-3 py-2">
      <dt className={strong ? "font-medium text-slate-700" : "text-slate-500"}>{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );

  return (
    <>
      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
        {row("Total quantity", fmtQty(totals.totalQty))}
        {row("Total weight", `${fmtWeight(totals.totalWeight)} kg`)}
        {totals.totalLoading ? row(`Total amount (${base})`, fmtMoney(totals.grossAmount)) : null}
        {totals.totalLoading ? row(`Loading charges (${base})`, `+ ${fmtMoney(totals.totalLoading)}`) : null}
        {converts ? (
          <>
            {row(`Final total (${base})`, fmtMoney(totals.baseSubtotal), true)}
            <div className="px-3 py-2">
              <p className="mb-1 text-xs text-slate-500">Exchange rate</p>
              <ExchangeRateInput from={baseCurrency} to={currency} rate={totals.exchangeRate} readOnly={readOnly} onChange={onRateChange} />
            </div>
            {row(`Amount (${currencyLabel(currency)})`, fmtMoney(totals.subtotal), true)}
          </>
        ) : (
          row(`Subtotal (${base})`, fmtMoney(totals.subtotal), true)
        )}

        {totals.adjustments.map((a) => (
          <div key={a.key} className="group flex items-center gap-2 px-3 py-1.5">
            <dt className="min-w-0 flex-1 truncate text-slate-600">
              <span
                className={cn(
                  "mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  a.kind === "discount" ? "bg-emerald-50 text-emerald-700" : a.kind === "tax" ? "bg-violet-50 text-violet-700" : "bg-sky-50 text-sky-700",
                )}
              >
                {a.kind}
              </span>
              {adjustmentTitle(a)}
            </dt>
            <dd className={cn("num font-medium", a.kind === "discount" && "text-emerald-700")}>
              {a.kind === "discount" ? "− " : ""}
              {fmtMoney(a.amount)}
            </dd>
            {!readOnly ? (
              <div className="flex">
                <Button variant="ghost" size="icon-sm" onClick={() => openEdit(a)} aria-label={`Edit ${a.label}`}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:bg-red-50 hover:text-red-600"
                  onClick={() => onChange(adjustments.filter((x) => x.key !== a.key))}
                  aria-label={`Delete ${a.label}`}
                >
                  <Trash2 />
                </Button>
              </div>
            ) : null}
          </div>
        ))}

        {!readOnly ? (
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={openNew}
              disabled={adjustments.length >= MAX_ADJUSTMENTS}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
            >
              <Plus className="size-4" /> Add discount, charge or tax
            </button>
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-b-lg bg-brand-900 px-3 py-3 text-white">
          <dt className="font-semibold">Grand total</dt>
          <dd className="num text-lg font-semibold">
            {currencyLabel(currency)} {fmtMoney(totals.grandTotal)}
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-slate-500 italic">{amountInWords(totals.grandTotal, currency)}</p>

      {draft ? (
        <Modal
          open
          size="sm"
          title={draft.key ? "Edit bill line" : "Add to bill"}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={save}>{draft.key ? "Save" : "Add"}</Button>
            </>
          }
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-700">Type</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Type">
                {KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === k.kind}
                    onClick={() => setDraft({ ...draft, kind: k.kind, mode: draft.key ? draft.mode : k.mode })}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      draft.kind === k.kind ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-500/15" : "border-slate-200 hover:border-slate-300",
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Name" htmlFor="bill-name">
              <Input
                id="bill-name"
                autoFocus
                value={draft.label}
                maxLength={40}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={KINDS.find((k) => k.kind === draft.kind)?.name}
              />
            </Field>
            <div className="grid grid-cols-[auto_1fr] items-end gap-3">
              <div className="flex rounded-lg border border-slate-300 p-0.5" role="radiogroup" aria-label="Value type">
                {(["percent", "amount"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={draft.mode === m}
                    onClick={() => setDraft({ ...draft, mode: m })}
                    className={cn("h-8 rounded-md px-3 text-sm font-medium", draft.mode === m ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}
                  >
                    {m === "percent" ? "%" : currency}
                  </button>
                ))}
              </div>
              <Field label={draft.mode === "percent" ? "Percentage" : "Amount"} htmlFor="bill-value" error={error ?? undefined}>
                <NumInput
                  id="bill-value"
                  value={draft.value}
                  allowEmpty
                  min={0}
                  onValueChange={(v) => setDraft({ ...draft, value: v })}
                  suffix={draft.mode === "percent" ? "%" : undefined}
                />
              </Field>
            </div>
            <button type="submit" hidden />
          </form>
        </Modal>
      ) : null}
    </>
  );
}
