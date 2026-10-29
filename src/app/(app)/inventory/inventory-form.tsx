"use client";

import { Calculator, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { fmtMoney, fmtWeight, parseNumber, round2 } from "@/lib/format";
import type { InventoryItemRow } from "@/lib/supabase/database.types";
import { createInventoryItem, updateInventoryItem } from "./actions";

export type InventoryFormMode = { kind: "create" } | { kind: "edit"; item: InventoryItemRow } | { kind: "duplicate"; item: InventoryItemRow };

type FormState = {
  description: string;
  weight_kg: string;
  unit_price: string;
  stock_qty: string;
  actual_weight: string;
  note: string;
};

const str = (v: number | string | null | undefined) => (v == null ? "" : String(v));

function initialState(mode: InventoryFormMode): FormState {
  if (mode.kind === "create") {
    return { description: "", weight_kg: "", unit_price: "", stock_qty: "0", actual_weight: "", note: "" };
  }
  const i = mode.item;
  return {
    description: i.description,
    weight_kg: str(i.weight_kg),
    unit_price: str(i.unit_price),
    stock_qty: str(i.stock_qty),
    actual_weight: str(i.actual_weight),
    note: str(i.note),
  };
}

type Props = {
  mode: InventoryFormMode;
  baseCurrency: string;
  onClose: () => void;
  onSaved: (item: InventoryItemRow, kind: InventoryFormMode["kind"]) => void;
};

/** Add / edit an inventory item: the same fields as the supplier Excel. */
export function InventoryForm({ mode, baseCurrency, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(mode));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [ratePerKg, setRatePerKg] = useState("");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const weight = parseNumber(form.weight_kg);
  const price = parseNumber(form.unit_price);
  const qty = parseNumber(form.stock_qty) ?? 0;
  const rate = parseNumber(ratePerKg);

  const submit = async (addAnother: boolean) => {
    setSaving(true);
    setErrors({});
    const res = mode.kind === "edit" ? await updateInventoryItem(mode.item.id, form) : await createInventoryItem(form);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Saved.");
    onSaved(res.data, mode.kind);
    if (addAnother) setForm(initialState({ kind: "create" }));
    else onClose();
  };

  const title = mode.kind === "edit" ? "Edit item" : mode.kind === "duplicate" ? "Duplicate item" : "Add item";

  return (
    <Modal
      open
      variant="drawer"
      onClose={onClose}
      locked={saving}
      title={title}
      description={mode.kind === "edit" ? mode.item.description : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {mode.kind !== "edit" ? (
            <Button variant="outline" onClick={() => submit(true)} disabled={saving}>
              Save &amp; add another
            </Button>
          ) : null}
          <Button onClick={() => submit(false)} loading={saving}>
            {mode.kind === "edit" ? "Save changes" : "Add item"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <Field label="Items" htmlFor="f-desc" required error={errors.description}>
          <Input id="f-desc" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={200} placeholder='e.g. 2"XSCH40 TEE' autoFocus />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Weight per piece (kg)" htmlFor="f-wt-kg" error={errors.weight_kg}>
            <Input id="f-wt-kg" inputMode="decimal" value={form.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} className="num" placeholder="0.000" />
          </Field>
          <Field label={`Price per piece (${baseCurrency})`} htmlFor="f-price" error={errors.unit_price}>
            <Input id="f-price" inputMode="decimal" value={form.unit_price} onChange={(e) => set("unit_price", e.target.value)} className="num" placeholder="0.00" />
          </Field>
          <Field label="Quantity" htmlFor="f-qty" error={errors.stock_qty}>
            <Input id="f-qty" inputMode="decimal" value={form.stock_qty} onChange={(e) => set("stock_qty", e.target.value)} className="num" />
          </Field>
          <Field label="Actual weight" htmlFor="f-actual" error={errors.actual_weight}>
            <Input id="f-actual" value={form.actual_weight} onChange={(e) => set("actual_weight", e.target.value)} maxLength={100} placeholder="e.g. 5.5-5.6MM" />
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-3">
          <Calculator className="mb-2 size-4 text-slate-400" />
          <Field label={`Rate per kg (${baseCurrency})`} htmlFor="f-rate" className="min-w-40 flex-1">
            <Input id="f-rate" inputMode="decimal" value={ratePerKg} onChange={(e) => setRatePerKg(e.target.value)} className="num" placeholder="e.g. 5.20" />
          </Field>
          <Button variant="outline" disabled={weight == null || rate == null} onClick={() => set("unit_price", String(round2((weight ?? 0) * (rate ?? 0))))}>
            <Sparkles /> Set price {weight != null && rate != null ? `= ${fmtMoney((weight ?? 0) * (rate ?? 0))}` : ""}
          </Button>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Total kg</dt>
            <dd className="num font-semibold">{fmtWeight((weight ?? 0) * qty)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Amount</dt>
            <dd className="num font-semibold">
              {baseCurrency} {fmtMoney((price ?? 0) * qty)}
            </dd>
          </div>
        </dl>

        <Field label="Note / Length" htmlFor="f-note" error={errors.note}>
          <Textarea id="f-note" value={form.note} onChange={(e) => set("note", e.target.value)} maxLength={300} rows={2} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
