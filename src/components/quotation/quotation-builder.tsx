"use client";

import { ArrowLeft, Check, ClipboardList, Copy, PackagePlus, Save, Sheet, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteQuotation, saveQuotation } from "@/app/(app)/quotations/actions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { PickerItem } from "@/lib/inventory/types";
import { computeTotals, isBlankLine, repriceLines } from "@/lib/quotation/calc";
import { STANDARD_COLUMNS, type ColumnLayoutPatch, type CompanyInfo, type QuoteDocument, type QuoteHeader, type QuoteLine, type StandardColumn } from "@/lib/quotation/types";
import { useLocalStorage, writeLocalStorage } from "@/lib/use-local-storage";
import { ExportMenu } from "./export-menu";
import { BillLines } from "./bill-lines";
import { ItemPicker } from "./item-picker";
import { blankLine, lineFromItem } from "./line-utils";
import { SheetGrid } from "./sheet-grid";

const DRAFT_KEY = "qp.draft.new";
// Lines are priced in RMB, so only these change line prices (the exchange rate applies to the total).
const PRICING_KEYS: (keyof QuoteHeader)[] = ["margin_pct", "pricing_basis", "rate_per_kg"];

export type BuilderProps = {
  id: string | null;
  quoteNo: string | null;
  preparedBy: string | null;
  header: QuoteHeader;
  lines: QuoteLine[];
  company: CompanyInfo;
  readOnly: boolean;
  canDelete: boolean;
  allowDraftRestore: boolean;
  userName: string;
};

type Draft = { header: QuoteHeader; lines: QuoteLine[]; savedAt: string };

export function QuotationBuilder(props: BuilderProps) {
  const { company, readOnly, canDelete, allowDraftRestore, userName } = props;
  const router = useRouter();
  const [id, setId] = useState(props.id);
  const [quoteNo, setQuoteNo] = useState(props.quoteNo);
  const [header, setHeader] = useState<QuoteHeader>(props.header);
  const [lines, setLines] = useState<QuoteLine[]>(props.lines);
  const [history, setHistory] = useState<{ past: QuoteLine[][]; future: QuoteLine[][] }>({ past: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  /** Row the user selected on the sheet (null = not chosen yet); added items go there. */
  const targetRow = useRef<number | null>(null);
  const onCursorRow = useCallback((r: number) => {
    targetRow.current = r;
  }, []);
  /** Asks the sheet to select a row (the item just added), so the next one goes below it. */
  const [jump, setJump] = useState<{ row: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isNew = id == null;
  // Lines of a deleted sheet (e.g. brought back by Undo) are ignored.
  const filledLines = useMemo(() => lines.filter((l) => !isBlankLine(l) && l.sheet < header.sheet_names.length), [lines, header.sheet_names.length]);
  const totals = useMemo(() => computeTotals(filledLines, header), [filledLines, header]);

  // ---- Sheets (Excel-style tabs): every line belongs to one sheet ------------------------
  const [activeSheet, setActiveSheetState] = useState(0);
  // Another sheet: its own selected row starts unset.
  const setActiveSheet = (i: number) => {
    targetRow.current = null;
    setActiveSheetState(i);
  };
  const sheetIndex = Math.min(activeSheet, header.sheet_names.length - 1);
  const sheetLines = useMemo(() => lines.filter((l) => l.sheet === sheetIndex), [lines, sheetIndex]);
  const sheetTotals = useMemo(() => computeTotals(sheetLines.filter((l) => !isBlankLine(l)), header), [sheetLines, header]);
  const inQuote = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (l.inventory_item_id) m.set(l.inventory_item_id, (m.get(l.inventory_item_id) ?? 0) + (l.qty ?? 0));
    return m;
  }, [lines]);

  // ---- Line history (undo / redo) -------------------------------------------------
  const commitLines = useCallback(
    (next: QuoteLine[]) => {
      setHistory((h) => ({ past: [...h.past.slice(-49), lines], future: [] }));
      setLines(next);
      setDirty(true);
    },
    [lines],
  );
  const undo = () => {
    if (!history.past.length) return;
    const prev = history.past[history.past.length - 1];
    setHistory({ past: history.past.slice(0, -1), future: [lines, ...history.future] });
    setLines(prev);
    setDirty(true);
  };
  const redo = () => {
    if (!history.future.length) return;
    const [next, ...rest] = history.future;
    setHistory({ past: [...history.past, lines], future: rest });
    setLines(next);
    setDirty(true);
  };

  // ---- Header -----------------------------------------------------------------------
  const setField = <K extends keyof QuoteHeader>(key: K, value: QuoteHeader[K]) => {
    const next = { ...header, [key]: value };
    if (key === "currency" && value === company.base_currency) next.exchange_rate = 1;
    setHeader(next);
    setDirty(true);
    if (PRICING_KEYS.includes(key)) {
      // Pricing rules changed: re-price every line that wasn't priced by hand.
      const repriced = repriceLines(lines, next);
      if (repriced.some((l, i) => l !== lines[i])) commitLines(repriced);
    }
  };

  /** Column changes from the sheet (extra columns, deleted columns); values of removed extra columns are dropped. */
  const patchColumns = (patch: ColumnLayoutPatch) => {
    setHeader((h) => ({ ...h, ...patch }));
    setDirty(true);
    if (patch.extra_columns) {
      const keep = new Set(patch.extra_columns.map((c) => c.key));
      setLines((ls) =>
        ls.map((l) => (Object.keys(l.extra).some((k) => !keep.has(k)) ? { ...l, extra: Object.fromEntries(Object.entries(l.extra).filter(([k]) => keep.has(k))) } : l)),
      );
    }
  };

  const flash = (key: string) => {
    setHighlightKey(key);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightKey(null), 1200);
  };

  /** Replaces the lines of the active sheet, keeping the other sheets (and sheet order). */
  const commitSheetLines = (next: QuoteLine[]) => {
    const merged: QuoteLine[] = [];
    for (let s = 0; s < header.sheet_names.length; s++) {
      if (s === sheetIndex) merged.push(...next.map((l) => (l.sheet === s ? l : { ...l, sheet: s })));
      else merged.push(...lines.filter((l) => l.sheet === s));
    }
    commitLines(merged);
  };

  const addSheet = () => {
    const taken = new Set(header.sheet_names.map((n) => n.toLowerCase()));
    let n = header.sheet_names.length + 1;
    while (taken.has(`sheet ${n}`)) n++;
    setField("sheet_names", [...header.sheet_names, `Sheet ${n}`]);
    setActiveSheet(header.sheet_names.length);
  };

  const renameSheet = (i: number, raw: string) => {
    const name = raw.trim().replace(/[:\\/?*[\]]/g, "").slice(0, 31);
    if (!name || name === header.sheet_names[i]) return;
    if (header.sheet_names.some((n, j) => j !== i && n.toLowerCase() === name.toLowerCase())) {
      toast.error(`A sheet called "${name}" already exists.`);
      return;
    }
    setField("sheet_names", header.sheet_names.map((n, j) => (j === i ? name : n)));
  };

  const [sheetToDelete, setSheetToDelete] = useState<number | null>(null);
  const deleteSheet = (i: number) => {
    if (header.sheet_names.length <= 1) return;
    if (lines.some((l) => l.sheet === i && !isBlankLine(l))) setSheetToDelete(i);
    else removeSheet(i);
  };
  const removeSheet = (i: number) => {
    commitLines(lines.filter((l) => l.sheet !== i).map((l) => (l.sheet > i ? { ...l, sheet: l.sheet - 1 } : l)));
    setField("sheet_names", header.sheet_names.filter((_, j) => j !== i));
    setActiveSheet(Math.max(0, Math.min(sheetIndex, header.sheet_names.length - 2)));
    setSheetToDelete(null);
  };

  const addItem = (item: PickerItem, qty: number) => {
    const existing = lines.find((l) => l.inventory_item_id === item.id && l.sheet === sheetIndex);
    if (existing) {
      commitLines(lines.map((l) => (l.key === existing.key ? { ...l, qty: (l.qty ?? 0) + qty } : l)));
      flash(existing.key);
      setJump({ row: sheetLines.findIndex((l) => l.key === existing.key) });
      toast.success(`Quantity updated: ${item.description}`, { duration: 1800 });
      return;
    }
    // Like typing in Excel: the item goes into the selected row when it is empty, otherwise
    // right below it. Without a selected row it goes after the last filled row.
    const line = lineFromItem(item, qty, header, sheetIndex);
    const rows = sheetLines.slice();
    const lastFilled = rows.reduce((last, l, i) => (isBlankLine(l) ? last : i), -1);
    const selected = targetRow.current;
    let at = selected == null ? lastFilled + 1 : selected < rows.length && !isBlankLine(rows[selected]) ? selected + 1 : selected;
    at = Math.max(0, at);
    while (rows.length < at) rows.push(blankLine(sheetIndex));
    if (at < rows.length && isBlankLine(rows[at])) rows[at] = { ...line, fmt: rows[at].fmt }; // keep the empty row's formatting
    else rows.splice(at, 0, line);
    commitSheetLines(rows);
    setJump({ row: at });
    flash(line.key);
    toast.success(`Added ${item.description}`, { duration: 1800 });
  };

  // ---- Save / delete ------------------------------------------------------------
  const save = useCallback(async () => {
    if (readOnly || saving) return;
    if (!header.customer_name.trim()) {
      toast.error("Enter the customer name (step 1).");
      document.getElementById("step-customer")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!filledLines.length) {
      toast.error("Add at least one item (step 3).");
      return;
    }
    const missing = filledLines.findIndex((l) => !l.description.trim());
    if (missing >= 0) {
      toast.error(`Line ${missing + 1} needs a description.`);
      return;
    }
    setSaving(true);
    const res = await saveQuotation({
      id,
      header: { ...header, valid_until: header.valid_until || null },
      lines: filledLines.map((l) => ({
        inventory_item_id: l.inventory_item_id,
        item_code: l.item_code,
        description: l.description,
        unit: l.unit,
        qty: l.qty ?? 0,
        unit_weight_kg: l.unit_weight_kg,
        base_price: l.base_price,
        unit_price: l.unit_price ?? 0,
        price_overridden: l.price_overridden,
        remarks: l.remarks,
        sheet: l.sheet,
        // Only values of columns that still exist (a deleted column's values are dropped).
        extra: Object.fromEntries(Object.entries(l.extra ?? {}).filter(([k, v]) => v.trim() && header.extra_columns.some((c) => c.key === k))),
        // Formatting of columns that still exist.
        fmt: Object.fromEntries(
          Object.entries(l.fmt ?? {}).filter(([k]) => (k.startsWith("x:") ? header.extra_columns.some((c) => `x:${c.key}` === k) : STANDARD_COLUMNS.includes(k as StandardColumn))),
        ),
        actual_weight: l.actual_weight,
        loading_charges: l.loading_charges ?? 0,
      })),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setDirty(false);
    setQuoteNo(res.data.quoteNo);
    if (isNew) {
      writeLocalStorage(DRAFT_KEY, null);
      setId(res.data.id);
      router.replace(`/quotations/${res.data.id}`);
    }
  }, [readOnly, saving, header, filledLines, id, isNew, router]);

  const runDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const res = await deleteQuotation(id);
    setDeleting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setDirty(false);
    router.push("/quotations");
  };

  // Ctrl+S saves; warn before leaving with unsaved changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  useEffect(() => {
    if (!dirty || readOnly) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, readOnly]);

  // Unsaved new quotations are kept in this browser so nothing is lost on a refresh.
  // The restore banner is only offered before the user starts a new one.
  const draftRaw = useLocalStorage(DRAFT_KEY);
  const draft = useMemo<Draft | null>(() => {
    if (!allowDraftRestore || dirty || !draftRaw) return null;
    try {
      const parsed = JSON.parse(draftRaw) as Draft;
      return parsed?.header && Array.isArray(parsed.lines) && (parsed.lines.length || parsed.header.customer_name) ? parsed : null;
    } catch {
      return null;
    }
  }, [allowDraftRestore, dirty, draftRaw]);

  useEffect(() => {
    if (!isNew || !dirty || readOnly) return;
    const t = setTimeout(() => {
      writeLocalStorage(DRAFT_KEY, JSON.stringify({ header, lines, savedAt: new Date().toISOString() } satisfies Draft));
    }, 800);
    return () => clearTimeout(t);
  }, [header, lines, dirty, isNew, readOnly]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  const buildDocument = (): QuoteDocument | null => {
    if (!filledLines.length) {
      toast.error("Add at least one item before exporting.");
      return null;
    }
    if (!header.customer_name.trim()) toast.warning("Tip: add the customer name in step 1 so it appears on the document.");
    // Not saved yet: no quotation number (the PDF/Excel leave the "Quotation No" row out).
    return { quoteNo: quoteNo ?? "", preparedBy: props.preparedBy ?? userName, header, lines: filledLines, totals, company };
  };

  const steps = [
    { id: "step-customer", label: "Customer", icon: UserRound, done: Boolean(header.customer_name.trim()) },
    { id: "step-items", label: "Add items", icon: PackagePlus, done: filledLines.length > 0, count: filledLines.length },
    { id: "step-sheet", label: "Sheet", icon: Sheet, done: filledLines.length > 0 && !dirty && !isNew },
  ];

  return (
    <div className="pb-16">
      {/* Action bar */}
      <div className="z-40 -mx-4 mb-6 border-b border-slate-200 bg-slate-50/90 px-4 pt-1 pb-3 backdrop-blur sm:-mx-6 sm:px-6 lg:sticky lg:top-0 lg:-mx-8 lg:px-8 lg:pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/quotations" variant="ghost" size="icon" aria-label="Back to quotations">
            <ArrowLeft />
          </ButtonLink>
          <div className="mr-auto min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{quoteNo ?? "New quotation"}</h1>
              {dirty && !readOnly ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                  <span className="size-1.5 rounded-full bg-amber-500" /> Unsaved changes
                </span>
              ) : null}
              {readOnly ? <Badge tone="amber">Read only</Badge> : null}
            </div>
            <p className="truncate text-xs text-slate-500">
              {header.customer_name || "No customer"} · {header.currency} {fmtMoney(totals.grandTotal)}
            </p>
          </div>
          {id ? (
            <ButtonLink href={`/quotations/new?from=${id}`} variant="outline" title="Duplicate as a new quotation">
              <Copy /> <span className="hidden md:inline">Duplicate</span>
            </ButtonLink>
          ) : null}
          {id && canDelete ? (
            <Button variant="outline" onClick={() => setConfirmDelete(true)} className="hover:border-red-300 hover:text-red-700" aria-label="Delete quotation">
              <Trash2 />
            </Button>
          ) : null}
          <ExportMenu buildDocument={buildDocument} fileBase={{ quoteNo: quoteNo ?? "Quotation", customer: header.customer_name }} />
          {!readOnly ? (
            <Button onClick={save} loading={saving} title="Save (Ctrl+S)">
              <Save /> Save
            </Button>
          ) : null}
        </div>

        <nav aria-label="Steps" className="scroll-thin mt-3 flex gap-2 overflow-x-auto">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                s.done ? "border-excel-100 bg-excel-50 text-excel-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              <span className={cn("grid size-5 place-items-center rounded-full text-[10px] font-bold", s.done ? "bg-excel-700 text-white" : "bg-slate-200 text-slate-600")}>
                {s.done ? <Check className="size-3" /> : i + 1}
              </span>
              {s.label}
              {s.count ? <span className="rounded-full bg-white px-1.5 text-[10px] text-slate-600 ring-1 ring-slate-200">{s.count}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      {draft ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <ClipboardList className="size-4" />
          <span className="mr-auto">
            Unsaved draft from {fmtDateTime(draft.savedAt)}{draft.header.customer_name ? ` (${draft.header.customer_name})` : ""}.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => writeLocalStorage(DRAFT_KEY, null)}
          >
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => {
              // Drafts saved before sheets existed have no sheet information.
              setHeader({
                ...draft.header,
                sheet_names: draft.header.sheet_names?.length ? draft.header.sheet_names : ["Quotation"],
                extra_columns: draft.header.extra_columns ?? [],
                hidden_columns: draft.header.hidden_columns ?? [],
                column_titles: draft.header.column_titles ?? {},
              });
              setLines(draft.lines.map((l) => ({ ...l, sheet: l.sheet ?? 0, actual_weight: l.actual_weight ?? "", loading_charges: l.loading_charges ?? null, extra: l.extra ?? {}, fmt: l.fmt ?? {} })));
              setDirty(true);
              toast.success("Draft restored.");
            }}
          >
            Restore draft
          </Button>
        </div>
      ) : null}

      <fieldset disabled={readOnly} className="grid gap-6">
        {/* Step 1 — customer */}
        <Card id="step-customer" className="scroll-mt-40">
          <CardHeader step={1} title="Customer" />
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Customer / company" htmlFor="q-customer" required className="sm:col-span-2">
              <Input id="q-customer" value={header.customer_name} onChange={(e) => setField("customer_name", e.target.value)} maxLength={160} placeholder="Customer name" />
            </Field>
            <Field label="Contact person" htmlFor="q-contact">
              <Input id="q-contact" value={header.contact_person} onChange={(e) => setField("contact_person", e.target.value)} maxLength={120} />
            </Field>
            <Field label="Reference" htmlFor="q-ref">
              <Input id="q-ref" value={header.reference} onChange={(e) => setField("reference", e.target.value)} maxLength={120} />
            </Field>
            <Field label="Email" htmlFor="q-email">
              <Input id="q-email" type="email" value={header.customer_email} onChange={(e) => setField("customer_email", e.target.value)} maxLength={160} />
            </Field>
            <Field label="Phone" htmlFor="q-phone">
              <Input id="q-phone" type="tel" value={header.customer_phone} onChange={(e) => setField("customer_phone", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Address" htmlFor="q-address" className="sm:col-span-2 lg:col-span-4">
              <Textarea id="q-address" rows={2} value={header.customer_address} onChange={(e) => setField("customer_address", e.target.value)} maxLength={500} />
            </Field>
            <Field label="Quotation date" htmlFor="q-date">
              <Input id="q-date" type="date" value={header.quote_date} onChange={(e) => e.target.value && setField("quote_date", e.target.value)} />
            </Field>
            <Field label="Valid until" htmlFor="q-valid" error={header.valid_until && header.valid_until < header.quote_date ? "Must be after the quotation date" : undefined}>
              <Input id="q-valid" type="date" min={header.quote_date} value={header.valid_until} onChange={(e) => setField("valid_until", e.target.value)} />
            </Field>
          </CardBody>
        </Card>

        {/* Step 3 — add items */}
        <Card id="step-items" className="scroll-mt-40">
          <CardHeader step={2} title="Add items" />
          <CardBody>
            <ItemPicker inQuote={inQuote} onAdd={addItem} disabled={readOnly} />
          </CardBody>
        </Card>
      </fieldset>

      {/* Step 4 — sheet */}
      <section id="step-sheet" className="mt-6 scroll-mt-40">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">3</span>
            <h2 className="mt-1 text-sm font-semibold">Quotation sheet</h2>
          </div>
        </div>
        <SheetGrid
          key={sheetIndex}
          baseCurrency={company.base_currency}
          lines={sheetLines}
          onChange={commitSheetLines}
          header={header}
          totals={sheetTotals}
          sheetNames={header.sheet_names}
          activeSheet={sheetIndex}
          onSelectSheet={setActiveSheet}
          onAddSheet={addSheet}
          onRenameSheet={renameSheet}
          onDeleteSheet={deleteSheet}
          onColumnsChange={patchColumns}
          readOnly={readOnly}
          highlightKey={highlightKey}
          jumpTo={jump}
          onCursorRow={onCursorRow}
          onUndo={undo}
          onRedo={redo}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
        />
      </section>

      <fieldset disabled={readOnly} className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader title="Notes & terms" />
          <CardBody className="space-y-4">
            <Field label="Notes" htmlFor="q-notes">
              <Textarea id="q-notes" rows={3} value={header.notes} onChange={(e) => setField("notes", e.target.value)} maxLength={2000} />
            </Field>
            <Field label="Terms & conditions" htmlFor="q-terms">
              <Textarea id="q-terms" rows={6} value={header.terms} onChange={(e) => setField("terms", e.target.value)} maxLength={4000} />
            </Field>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Totals" />
          <CardBody className="space-y-3">
            <BillLines
              adjustments={header.adjustments}
              totals={totals}
              currency={header.currency}
              baseCurrency={company.base_currency}
              readOnly={readOnly}
              onChange={(next) => setField("adjustments", next)}
              onRateChange={(rate) => setField("exchange_rate", rate)}
            />
          </CardBody>
        </Card>
      </fieldset>

      <ConfirmDialog
        open={sheetToDelete != null}
        title={`Delete sheet "${sheetToDelete != null ? header.sheet_names[sheetToDelete] : ""}"?`}
        message="Its items are removed from this quotation."
        confirmLabel="Delete sheet"
        onConfirm={() => sheetToDelete != null && removeSheet(sheetToDelete)}
        onClose={() => setSheetToDelete(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${quoteNo ?? "this quotation"}?`}
        message="This cannot be undone."
        confirmLabel="Delete quotation"
        loading={deleting}
        onConfirm={runDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
