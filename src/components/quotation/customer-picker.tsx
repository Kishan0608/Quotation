"use client";

import { Loader2, Plus, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createCustomer } from "@/app/(app)/customers/actions";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { customerKey, type CustomerPick } from "@/lib/customers/schema";

/** The quotation's own customer details, saved as a new customer from here. */
export type CustomerDetails = { name: string; contact_person: string; phone: string; email: string; address: string };

type Props = {
  id: string;
  value: string;
  details: CustomerDetails;
  disabled?: boolean;
  onChange: (name: string) => void;
  /** A saved customer was picked: all its details go into the quotation. */
  onPick: (customer: CustomerPick) => void;
};

/**
 * The Customer / company box: typing searches the saved customers (name, contact, phone, email,
 * address), and picking one fills in every detail. A name that isn't saved yet can be saved
 * from the list, with the details typed on the quotation.
 */
export function CustomerPicker({ id, value, details, disabled, onChange, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ q: string; items: CustomerPick[]; missing: boolean; failed: boolean }>({ q: "", items: [], missing: false, failed: false });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = value.trim();

  useEffect(() => {
    if (!open || !q) return;
    let stale = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/customers/search?${new URLSearchParams({ q, limit: "20" })}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { items?: CustomerPick[]; code?: string | null };
        // No customers table yet (the database file hasn't been run): the box works as plain text.
        if (!stale) setFound({ q, items: res.ok ? (json.items ?? []) : [], missing: json.code === "PGRST205" || json.code === "42P01", failed: !res.ok });
      } catch {
        // offline: keep the last results
      } finally {
        if (!stale) setLoading(false);
      }
    }, 150);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, open]);

  // Closes on a click outside.
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const items = q && found.q ? found.items : [];
  const exact = items.some((c) => customerKey(c.name) === customerKey(q));
  // Only offered when the search really ran: a failed search proves nothing about the name.
  const canSave = Boolean(q) && !exact && !found.missing && !found.failed && found.q === q && !loading;
  const options = items.length + (canSave ? 1 : 0);
  const show = open && Boolean(q) && (items.length > 0 || canSave || loading);

  const pick = (c: CustomerPick) => {
    onPick(c);
    setOpen(false);
    setActive(-1);
  };

  const saveNew = async () => {
    setSaving(true);
    const res = await createCustomer({ ...details, name: q });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${res.data.name} saved to your customers.`);
    setOpen(false);
    setFound({ q, items: [res.data, ...items], missing: false, failed: false });
  };

  return (
    <div ref={box} className="relative">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        maxLength={160}
        placeholder="Type to search your customers"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            if (active < items.length) pick(items[active]);
            else saveNew();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {show ? (
        <div role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-pop">
          <div className="scroll-thin max-h-72 overflow-y-auto overscroll-contain">
            {items.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === active}
                ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
                className={cn("flex w-full items-start gap-2.5 px-3 py-2 text-left", i === active ? "bg-brand-50" : "hover:bg-slate-50")}
              >
                <UserRound className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{c.name}</span>
                  <span className="block truncate text-xs text-slate-500">{[c.contact_person, c.phone, c.email, c.address].filter(Boolean).join(" · ") || "No other details"}</span>
                </span>
              </button>
            ))}
            {loading && !items.length ? (
              <p className="flex items-center gap-2 px-3 py-2 text-slate-500">
                <Loader2 className="size-3.5 animate-spin" /> Searching…
              </p>
            ) : null}
          </div>
          {canSave ? (
            <button
              type="button"
              role="option"
              aria-selected={active === items.length}
              disabled={saving}
              onMouseEnter={() => setActive(items.length)}
              onClick={saveNew}
              className={cn("flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left font-medium text-brand-700", active === items.length ? "bg-brand-50" : "hover:bg-brand-50")}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Save “{q}” as a new customer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
