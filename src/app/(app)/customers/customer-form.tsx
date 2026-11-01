"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { CustomerRow } from "@/lib/supabase/database.types";
import { createCustomer, updateCustomer } from "./actions";

export type CustomerFormMode = { kind: "create" } | { kind: "edit"; customer: CustomerRow };

type FormState = { name: string; contact_person: string; phone: string; email: string; address: string; note: string };

const initialState = (mode: CustomerFormMode): FormState => {
  const c = mode.kind === "edit" ? mode.customer : null;
  return {
    name: c?.name ?? "",
    contact_person: c?.contact_person ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    address: c?.address ?? "",
    note: c?.note ?? "",
  };
};

/** Add / edit a customer: the details a quotation's Customer box is filled with. */
export function CustomerForm({ mode, onClose, onSaved }: { mode: CustomerFormMode; onClose: () => void; onSaved: (c: CustomerRow) => void }) {
  const [form, setForm] = useState<FormState>(() => initialState(mode));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setSaving(true);
    setErrors({});
    const res = mode.kind === "edit" ? await updateCustomer(mode.customer.id, form) : await createCustomer(form);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Saved.");
    onSaved(res.data);
    onClose();
  };

  return (
    <Modal
      open
      variant="drawer"
      onClose={onClose}
      locked={saving}
      title={mode.kind === "edit" ? "Edit customer" : "Add customer"}
      description={mode.kind === "edit" ? mode.customer.name : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {mode.kind === "edit" ? "Save changes" : "Add customer"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Customer / company" htmlFor="c-name" required error={errors.name}>
          <Input id="c-name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={160} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person" htmlFor="c-contact" error={errors.contact_person}>
            <Input id="c-contact" value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} maxLength={120} />
          </Field>
          <Field label="Phone" htmlFor="c-phone" error={errors.phone}>
            <Input id="c-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={60} />
          </Field>
        </div>
        <Field label="Email" htmlFor="c-email" error={errors.email}>
          <Input id="c-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={160} />
        </Field>
        <Field label="Address" htmlFor="c-address" error={errors.address}>
          <Textarea id="c-address" rows={3} value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={500} />
        </Field>
        <Field label="Note" htmlFor="c-note" error={errors.note}>
          <Textarea id="c-note" rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} maxLength={500} placeholder="GST no., terms, anything to remember" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
