"use client";

import { Building2, Landmark, Receipt, RefreshCw, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { fetchLiveRate } from "@/components/quotation/exchange-rate";
import { CURRENCIES } from "@/lib/quotation/currency";
import type { CompanySettingsRow } from "@/lib/supabase/database.types";
import { updateCompanySettings } from "./actions";

type FormValues = Record<keyof Omit<CompanySettingsRow, "id" | "updated_at">, string>;

const toForm = (s: CompanySettingsRow): FormValues =>
  Object.fromEntries(Object.entries(s).filter(([k]) => k !== "id" && k !== "updated_at").map(([k, v]) => [k, v == null ? "" : String(v)])) as FormValues;

export function SettingsForm({ settings }: { settings: CompanySettingsRow }) {
  const [form, setForm] = useState<FormValues>(() => toForm(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [loadingRate, setLoadingRate] = useState(false);
  const loadLiveRate = async () => {
    setLoadingRate(true);
    try {
      const fx = await fetchLiveRate(form.base_currency, form.default_currency);
      setForm((f) => ({ ...f, default_exchange_rate: String(fx.rate) }));
      toast.success(`1 ${form.base_currency} = ${fx.rate} ${form.default_currency} (${fx.source})`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingRate(false);
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const res = await updateCompanySettings(form);
    setSaving(false);
    if (res.ok) toast.success(res.message);
    else {
      setErrors(res.fieldErrors ?? {});
      toast.error(res.error);
    }
  };

  const currencyOptions = CURRENCIES.map((c) => (
    <option key={c.code} value={c.code}>
      {c.code} — {c.name}
    </option>
  ));

  return (
    <form onSubmit={submit} className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader icon={<Building2 />} title="Company" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="s-name" required error={errors.company_name} className="sm:col-span-2">
            <Input id="s-name" value={form.company_name} onChange={set("company_name")} maxLength={120} />
          </Field>
          <Field label="Tagline" htmlFor="s-tag" error={errors.tagline} className="sm:col-span-2">
            <Input id="s-tag" value={form.tagline} onChange={set("tagline")} maxLength={160} placeholder="e.g. Butt-weld pipe fittings · Elbows · Tees · Reducers" />
          </Field>
          <Field label="Address" htmlFor="s-addr" error={errors.address} className="sm:col-span-2">
            <Textarea id="s-addr" rows={2} value={form.address} onChange={set("address")} maxLength={500} />
          </Field>
          <Field label="Phone" htmlFor="s-phone" error={errors.phone}>
            <Input id="s-phone" value={form.phone} onChange={set("phone")} maxLength={60} />
          </Field>
          <Field label="Email" htmlFor="s-email" error={errors.email}>
            <Input id="s-email" type="email" value={form.email} onChange={set("email")} maxLength={120} />
          </Field>
          <Field label="Website" htmlFor="s-web" error={errors.website}>
            <Input id="s-web" value={form.website} onChange={set("website")} maxLength={120} />
          </Field>
          <Field label="Tax / GST / VAT number" htmlFor="s-tax" error={errors.tax_id}>
            <Input id="s-tax" value={form.tax_id} onChange={set("tax_id")} maxLength={60} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<Receipt />} title="Pricing & quotation" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Inventory price currency" htmlFor="s-base" error={errors.base_currency}>
            <Select id="s-base" value={form.base_currency} onChange={set("base_currency")}>
              {currencyOptions}
            </Select>
          </Field>
          <Field label="Quotation currency" htmlFor="s-cur" error={errors.default_currency}>
            <Select id="s-cur" value={form.default_currency} onChange={set("default_currency")}>
              {currencyOptions}
            </Select>
          </Field>
          <Field label={`Exchange rate (1 ${form.base_currency} = ? ${form.default_currency})`} htmlFor="s-fx" error={errors.default_exchange_rate}>
            <div className="flex gap-2">
              <Input id="s-fx" inputMode="decimal" value={form.default_exchange_rate} onChange={set("default_exchange_rate")} className="num" />
              <Button type="button" variant="outline" onClick={loadLiveRate} loading={loadingRate} disabled={form.base_currency === form.default_currency} title="Load today's exchange rate">
                {!loadingRate ? <RefreshCw /> : null} Live rate
              </Button>
            </div>
          </Field>
          <Field label="Margin (%)" htmlFor="s-margin" error={errors.default_margin_pct}>
            <Input id="s-margin" inputMode="decimal" value={form.default_margin_pct} onChange={set("default_margin_pct")} className="num" />
          </Field>
          <Field label="Tax name" htmlFor="s-taxl" error={errors.default_tax_label}>
            <Input id="s-taxl" value={form.default_tax_label} onChange={set("default_tax_label")} maxLength={30} placeholder="GST / VAT" />
          </Field>
          <Field label="Tax rate (%)" htmlFor="s-taxp" error={errors.default_tax_pct}>
            <Input id="s-taxp" inputMode="decimal" value={form.default_tax_pct} onChange={set("default_tax_pct")} className="num" />
          </Field>
          <Field label="Validity (days)" htmlFor="s-valid" error={errors.default_validity_days}>
            <Input id="s-valid" inputMode="numeric" value={form.default_validity_days} onChange={set("default_validity_days")} className="num" />
          </Field>
          <Field label="Quotation number prefix" htmlFor="s-prefix" error={errors.quote_prefix} hint={`${form.quote_prefix || "QT"}-${new Date().getFullYear()}-0001`}>
            <Input id="s-prefix" value={form.quote_prefix} onChange={set("quote_prefix")} maxLength={10} className="uppercase" />
          </Field>
        </CardBody>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader icon={<Landmark />} title="Terms, bank details & footer" />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          <Field label="Default terms & conditions" htmlFor="s-terms" error={errors.default_terms}>
            <Textarea id="s-terms" rows={7} value={form.default_terms} onChange={set("default_terms")} maxLength={4000} />
          </Field>
          <div className="space-y-4">
            <Field label="Bank details" htmlFor="s-bank" error={errors.bank_details}>
              <Textarea id="s-bank" rows={4} value={form.bank_details} onChange={set("bank_details")} maxLength={2000} placeholder="Bank, account no., SWIFT / IFSC" />
            </Field>
            <Field label="Footer note" htmlFor="s-footer" error={errors.footer_note}>
              <Input id="s-footer" value={form.footer_note} onChange={set("footer_note")} maxLength={300} placeholder="e.g. Thank you for your business" />
            </Field>
          </div>
        </CardBody>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button type="submit" loading={saving}>
            <Save /> Save settings
          </Button>
        </div>
      </Card>
    </form>
  );
}
