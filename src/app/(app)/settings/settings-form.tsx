"use client";

import { Building2, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { CompanySettingsRow } from "@/lib/supabase/database.types";
import { updateCompanySettings } from "./actions";
import { SignatureCard } from "./signature-card";

// The signature is saved on its own (Signature box), not with this form.
type FormValues = Record<keyof Omit<CompanySettingsRow, "id" | "updated_at" | "signature_image">, string>;

const toForm = (s: CompanySettingsRow): FormValues =>
  Object.fromEntries(Object.entries(s).filter(([k]) => k !== "id" && k !== "updated_at" && k !== "signature_image").map(([k, v]) => [k, v == null ? "" : String(v)])) as FormValues;

export function SettingsForm({ settings }: { settings: CompanySettingsRow }) {
  const [form, setForm] = useState<FormValues>(() => toForm(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
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
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button type="submit" loading={saving}>
            <Save /> Save settings
          </Button>
        </div>
      </Card>

      <SignatureCard initial={settings.signature_image ?? null} />

    </form>
  );
}
