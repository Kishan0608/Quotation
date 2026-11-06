"use client";

import { ArrowLeft, ClipboardList, Copy, FileUp, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteQuotation, saveQuotation } from "@/app/(app)/quotations/actions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { fmtDateTime, parseNumber, round2 } from "@/lib/format";
import type { CustomerPick } from "@/lib/customers/schema";
import type { PickerItem } from "@/lib/inventory/types";
import { cn } from "@/lib/cn";
import { autoUnitPrice, commissionOfMultiplier, computeTotals, currencyLabel, isBlankLine, MAX_COMMISSION, MIN_COMMISSION, multiplierOf, repriceLines, typedTotals } from "@/lib/quotation/calc";
import { chinaLine } from "@/lib/quotation/china-document";
import { sortLines } from "@/lib/quotation/line-order";
import { applyInventoryChanges } from "@/lib/quotation/live-inventory";
import { HIDEABLE_COLUMNS, STANDARD_COLUMNS, type ColumnLayoutPatch, type CompanyInfo, type QuoteDocument, type QuoteHeader, type QuoteLine, type StandardColumn } from "@/lib/quotation/types";
import { useLocalStorage, writeLocalStorage } from "@/lib/use-local-storage";
import { ExportMenu } from "./export-menu";
import { ImportDialog, type ImportedLine } from "./import-dialog";
import { BillLines } from "./bill-lines";
import { CustomerPicker } from "./customer-picker";
import { fetchLiveRate } from "./exchange-rate";
import { blankLine, lineFromItem } from "./line-utils";
import { LineSearchBar } from "./line-search-bar";
import { SheetGrid } from "./sheet-grid";
import { useInventoryChanges } from "./use-inventory-changes";

const DRAFT_KEY = "qp.draft.new";
/** How the commission box is typed on this computer: "multiply" (x 1.25), else a percentage. */
const COMMISSION_MODE_KEY = "qp.commission.mode";
// Lines are priced in RMB, so only these change line prices (the exchange rate applies to the total).
const PRICING_KEYS: (keyof QuoteHeader)[] = ["margin_pct", "pricing_basis", "rate_per_kg"];

const sheetNameOf = (name: string) => name.trim().replace(/[:\\/?*[\]]/g, "").slice(0, 31);

/** The customer's sheet is named after the contact person, or the company when there is none. */
const customerSheetName = (h: Pick<QuoteHeader, "contact_person" | "customer_name">) => sheetNameOf(h.contact_person || "") || sheetNameOf(h.customer_name);

/**
 * New customer details, and the customer's sheet renamed to match - while that sheet still has
 * the default name or the name it got from the previous details (a name typed on the tab stays).
 */
function withCustomerSheet(h: QuoteHeader, patch: Partial<Pick<QuoteHeader, "customer_name" | "contact_person">>): QuoteHeader {
  const next = { ...h, ...patch };
  const [first, ...rest] = h.sheet_names;
  const follows = !first || first === "Quotation" || first === customerSheetName(h) || first === sheetNameOf(h.customer_name);
  const name = customerSheetName(next) || "Quotation";
  if (!follows || rest.some((n) => n.toLowerCase() === name.toLowerCase()) || name.toLowerCase() === "china") return next;
  return { ...next, sheet_names: [name, ...rest] };
}

type BuilderProps = {
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isNew = id == null;
  // Lines of a deleted sheet (e.g. brought back by Undo) are ignored.
  const filledLines = useMemo(() => lines.filter((l) => !isBlankLine(l) && l.sheet < header.sheet_names.length), [lines, header.sheet_names.length]);
  const totals = useMemo(() => computeTotals(filledLines, header), [filledLines, header]);

  // ---- Sheets (Excel-style tabs): every line belongs to one sheet ------------------------
  const [activeSheet, setActiveSheet] = useState(0);
  /**
   * The "China" tab: the first sheet's lines at the China (inventory) price. It is the same lines
   * as the customer's sheet, so adding, editing or deleting in either tab changes both; only the
   * price differs (customer price = China price x (1 + commission)).
   */
  const [chinaView, setChinaView] = useState(true);
  const sheetIndex = chinaView ? 0 : Math.min(activeSheet, header.sheet_names.length - 1);
  const sheetLines = useMemo(() => lines.filter((l) => l.sheet === sheetIndex), [lines, sheetIndex]);
  const sheetTotals = useMemo(() => computeTotals(sheetLines.filter((l) => !isBlankLine(l)), header), [sheetLines, header]);
  const chinaLines = useMemo(() => (chinaView ? sheetLines.map(chinaLine) : []), [chinaView, sheetLines]);
  const chinaTotals = useMemo(() => computeTotals(chinaLines.filter((l) => !isBlankLine(l)), header), [chinaLines, header]);

  // ---- Line history (undo / redo) -------------------------------------------------
  /** `steps`: in-between states Undo goes back through first (an import before its sorting). */
  const commitLines = useCallback(
    (next: QuoteLine[], steps: QuoteLine[][] = []) => {
      setHistory((h) => ({ past: [...h.past, lines, ...steps].slice(-50), future: [] }));
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

  // ---- Live inventory ----------------------------------------------------------------
  // Inventory changes made while this quotation is open (an import, a price edit, another PC)
  // reach its lines without a refresh; a saved quotation is never re-priced just by opening it.
  const live = useRef({ lines, header });
  useEffect(() => {
    live.current = { lines, header };
  });
  const [inventoryVersion, setInventoryVersion] = useState(0);
  useInventoryChanges(!readOnly, (items) => {
    // The search above the sheet loads the inventory again.
    setInventoryVersion((v) => v + 1);
    const r = applyInventoryChanges(live.current.lines, items, live.current.header);
    if (!r.updated && !r.linked) return;
    live.current.lines = r.lines;
    setLines(r.lines);
    setDirty(true);
    const parts = [r.updated ? `${r.updated} line${r.updated === 1 ? "" : "s"} re-priced` : "", r.linked ? `${r.linked} new line${r.linked === 1 ? "" : "s"} now found in inventory` : ""].filter(Boolean);
    toast.success(`Inventory changed: ${parts.join(", ")}.`);
  });

  // ---- Header -----------------------------------------------------------------------
  const setField = <K extends keyof QuoteHeader>(key: K, value: QuoteHeader[K]) => {
    const next = key === "customer_name" || key === "contact_person" ? withCustomerSheet(header, { [key]: value as string }) : { ...header, [key]: value };
    if (key === "currency" && value === company.base_currency) next.exchange_rate = 1;
    setHeader(next);
    setDirty(true);
    if (PRICING_KEYS.includes(key)) {
      // Pricing rules changed: re-price every line that wasn't priced by hand.
      const repriced = repriceLines(lines, next);
      if (repriced.some((l, i) => l !== lines[i])) commitLines(repriced);
    }
  };

  /**
   * RMB -> INR or RMB -> USD. The rate is the new currency's: one already used for it here comes
   * back, otherwise today's live rate is loaded (the old currency's rate is never kept for it).
   */
  const ratesUsed = useRef<Record<string, number>>({});
  const [rateLoading, setRateLoading] = useState(false);
  const changeCurrency = async (code: string) => {
    const base = company.base_currency;
    ratesUsed.current[header.currency] = header.exchange_rate;
    const known = code === base ? 1 : ratesUsed.current[code];
    setHeader((h) => ({ ...h, currency: code, exchange_rate: known ?? h.exchange_rate }));
    setDirty(true);
    if (known != null) return;
    setRateLoading(true);
    try {
      const fx = await fetchLiveRate(base, code);
      ratesUsed.current[code] = fx.rate;
      setHeader((h) => (h.currency === code ? { ...h, exchange_rate: fx.rate } : h));
      toast.success(`1 ${currencyLabel(base)} = ${fx.rate} ${code} · ${fx.source}`);
    } catch {
      toast.error(`Could not load today's ${currencyLabel(base)} → ${code} rate. Enter it by hand in the Exchange rate box.`);
    } finally {
      setRateLoading(false);
    }
  };

  /** A saved customer picked in the Customer box: all its details go into the quotation. */
  const pickCustomer = (c: CustomerPick) => {
    setHeader((h) => ({
      ...withCustomerSheet(h, { customer_name: c.name, contact_person: c.contact_person ?? "" }),
      customer_phone: c.phone ?? "",
      customer_email: c.email ?? "",
      customer_address: c.address ?? "",
    }));
    setDirty(true);
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

  /** All lines with sheet `target`'s replaced by `next`, keeping the other sheets (and sheet order). */
  const withSheetLines = (next: QuoteLine[], target = sheetIndex) => {
    const merged: QuoteLine[] = [];
    for (let s = 0; s < header.sheet_names.length; s++) {
      if (s === target) merged.push(...next.map((l) => (l.sheet === s ? l : { ...l, sheet: s })));
      else merged.push(...lines.filter((l) => l.sheet === s));
    }
    return merged;
  };
  /** Replaces the lines of sheet `target` (default: the active one). */
  const commitSheetLines = (next: QuoteLine[], target = sheetIndex) => commitLines(withSheetLines(next, target));

  /**
   * An edit on the China tab: its price is the China price (base_price); the customer price
   * follows it (unless it was typed by hand), and everything else is the same line.
   */
  const commitChinaLines = (next: QuoteLine[]) => {
    const before = new Map(sheetLines.map((l) => [l.key, l]));
    commitSheetLines(
      next.map((n) => {
        const orig = before.get(n.key);
        // Filled from inventory just now (a suggestion picked here): the line already has the
        // inventory price and its customer price; keep both.
        if (n.inventory_item_id && n.inventory_item_id !== orig?.inventory_item_id) return n;
        const line: QuoteLine = {
          ...n,
          base_price: n.unit_price,
          unit_price: orig?.unit_price ?? null,
          price_overridden: orig?.price_overridden ?? false,
          overrides: orig?.overrides ?? {},
        };
        const priceChanged = !orig || orig.base_price !== line.base_price || orig.unit_weight_kg !== line.unit_weight_kg;
        if (priceChanged && !line.price_overridden) line.unit_price = autoUnitPrice(line, header) ?? line.unit_price;
        return line;
      }),
      0,
    );
  };

  // ---- Commission (the box above the sheet): Enter re-prices every customer price ----------
  // Typed as a percentage (China price + 25%) or a multiplier (China price x 1.25): the same
  // commission either way (header.margin_pct); the box remembers the way it was last used.
  const multiply = useLocalStorage(COMMISSION_MODE_KEY) === "multiply";
  const commissionText = (commission: number) => (!commission ? "" : String(multiply ? multiplierOf(commission) : commission));
  const commissionShown = `${multiply}:${header.margin_pct}`;
  const [commissionDraft, setCommissionDraft] = useState(() => commissionText(header.margin_pct));
  const [commissionSeen, setCommissionSeen] = useState(commissionShown);
  if (commissionSeen !== commissionShown) {
    setCommissionSeen(commissionShown);
    setCommissionDraft(commissionText(header.margin_pct));
  }
  const applyCommission = () => {
    const typed = commissionDraft.trim() === "" ? (multiply ? 1 : 0) : parseNumber(commissionDraft);
    const value = typed == null ? null : multiply ? commissionOfMultiplier(typed) : round2(typed);
    // Any number goes; only a price below zero (under -100%, a negative multiplier) can't be.
    if (value == null || value < MIN_COMMISSION || value > MAX_COMMISSION) {
      toast.error(value == null ? "Enter a number." : value < MIN_COMMISSION ? (multiply ? "The multiplier can't be below 0." : "The commission can't be below -100%.") : "That number is too large.");
      setCommissionDraft(commissionText(header.margin_pct));
      return;
    }
    if (value === header.margin_pct) return;
    setField("margin_pct", value);
    if (!value) toast.success("Commission removed: customer prices = China prices.");
    else if (multiply) toast.success(`Customer prices updated: China price × ${multiplierOf(value)}.`);
    else toast.success(`Commission ${value}%: customer prices updated (China price ${value < 0 ? "−" : "+"} ${Math.abs(value)}%).`);
  };

  // A line picked in the search list: selected on the sheet and flashed for a moment.
  const [jump, setJump] = useState<{ row: number } | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const goToRow = (row: number, key: string) => {
    setJump({ row });
    setFlashKey(key);
  };

  /**
   * Inventory items picked in the search: added after the last filled row of this sheet (an item
   * already on it is skipped), at today's price; the quantity is typed on the sheet.
   */
  const addFromInventory = (items: PickerItem[]) => {
    const onSheet = new Set(sheetLines.map((l) => l.inventory_item_id).filter(Boolean));
    const fresh = items.filter((i) => !onSheet.has(i.id));
    if (!fresh.length) {
      toast.info("Already on the sheet.");
      return;
    }
    const rows = sheetLines.slice();
    const first = rows.reduce((last, r, i) => (isBlankLine(r) ? last : i), -1) + 1;
    fresh.forEach((item, n) => {
      const line: QuoteLine = { ...lineFromItem(item, 1, header, sheetIndex), qty: null };
      const at = first + n;
      if (at < rows.length && isBlankLine(rows[at])) rows[at] = { ...line, fmt: rows[at].fmt };
      else rows.splice(at, 0, line);
    });
    commitSheetLines(rows);
    goToRow(first, rows[first].key);
    const skipped = items.length - fresh.length;
    toast.success(`${fresh.length} item${fresh.length === 1 ? "" : "s"} added${skipped ? ` (${skipped} already on the sheet)` : ""}. Type the quantities on the sheet.`);
  };
  useEffect(() => {
    if (!flashKey) return;
    const t = setTimeout(() => setFlashKey(null), 1600);
    return () => clearTimeout(t);
  }, [flashKey]);

  /** The tabs: China first, then the quotation's sheets (the first one named after the customer). */
  const tabNames = ["China", ...header.sheet_names];
  const selectTab = (i: number) => {
    setChinaView(i === 0);
    if (i > 0) setActiveSheet(i - 1);
  };

  const addSheet = () => {
    setChinaView(false);
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

  /**
   * Lines from an imported list, after the last filled row, then the whole sheet put in the
   * standard order (line-order.ts; Ctrl+Z once gives the file's order back). An inventory item
   * already on this sheet gets the quantity added; a line not in the inventory comes in as a new
   * line with the file's text. Lines still to be checked carry the reason (red row).
   */
  const [importOpen, setImportOpen] = useState(false);
  const addItems = (list: ImportedLine[]) => {
    const rows = sheetLines.slice();
    let added = 0;
    let updated = 0;
    for (const l of list) {
      const { item, qty, check } = l;
      const same = item ? rows.findIndex((r) => r.inventory_item_id === item.id) : -1;
      if (same >= 0) {
        rows[same] = { ...rows[same], qty: (rows[same].qty ?? 0) + (qty ?? 0), check: check ?? rows[same].check };
        updated++;
        continue;
      }
      // The inventory item's line, with the fields as they were set in the import window.
      const base = item ? lineFromItem(item, qty ?? 1, header, sheetIndex) : { ...blankLine(sheetIndex), description: l.text.slice(0, 300) };
      const price = l.price != null ? round2(l.price) : base.unit_price;
      const line: QuoteLine = {
        ...base,
        qty,
        unit_weight_kg: l.weight,
        actual_weight: l.actual.slice(0, 100),
        unit_price: price,
        price_overridden: item ? price != null && price !== base.unit_price : price != null,
        // Note / Length: the length and the customer's note, one field.
        remarks: l.length.slice(0, 300),
        check,
      };
      const at = rows.reduce((last, r, i) => (isBlankLine(r) ? last : i), -1) + 1;
      if (at < rows.length && isBlankLine(rows[at])) rows[at] = { ...line, fmt: rows[at].fmt };
      else rows.splice(at, 0, line);
      added++;
    }
    const ordered = sortLines(rows);
    if (ordered === rows) commitSheetLines(rows);
    else commitLines(withSheetLines(ordered), [withSheetLines(rows)]);
    const flagged = list.filter((l) => l.check).length;
    toast.success(
      `Imported ${added} line${added === 1 ? "" : "s"}${updated ? `, ${updated} already on the sheet (quantity added)` : ""}.` +
        (ordered === rows ? "" : " Sorted in standard order (Ctrl+Z undoes the sorting).") +
        (flagged ? ` ${flagged} red line${flagged === 1 ? "" : "s"} to check on the sheet.` : ""),
    );
    document.getElementById("step-sheet")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    // Each line's row on its sheet (empty rows included), so it opens again in the same place.
    const rowOnSheet = new Map<string, number>();
    const perSheet = new Map<number, number>();
    for (const l of lines) {
      const n = perSheet.get(l.sheet) ?? 0;
      rowOnSheet.set(l.key, n);
      perSheet.set(l.sheet, n + 1);
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
        // Row on its sheet (empty rows above it included), so it opens again in the same place.
        row: rowOnSheet.get(l.key) ?? 0,
        // Only values of columns that still exist (a deleted column's values are dropped).
        extra: Object.fromEntries(Object.entries(l.extra ?? {}).filter(([k, v]) => v.trim() && header.extra_columns.some((c) => c.key === k))),
        // Formatting of columns that still exist.
        fmt: Object.fromEntries(
          Object.entries(l.fmt ?? {}).filter(([k]) => (k.startsWith("x:") ? header.extra_columns.some((c) => `x:${c.key}` === k) : STANDARD_COLUMNS.includes(k as StandardColumn))),
        ),
        actual_weight: l.actual_weight,
        // Total KG / Total Amount typed over the calculation.
        overrides: typedTotals(l.overrides),
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
  }, [readOnly, saving, header, filledLines, lines, id, isNew, router]);

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

  const buildDocument = (): QuoteDocument | null => {
    if (!filledLines.length) {
      toast.error("Add at least one item before exporting.");
      return null;
    }
    if (!header.customer_name.trim()) toast.warning("Tip: add the customer name in step 1 so it appears on the document.");
    // Not saved yet: no quotation number (the PDF/Excel leave the "Quotation No" row out).
    return { quoteNo: quoteNo ?? "", preparedBy: props.preparedBy ?? userName, header, lines: filledLines, totals, company };
  };


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
              {readOnly ? <Badge tone="amber">Read only</Badge> : null}
            </div>
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
          {!readOnly ? (
            <Button variant="outline" onClick={() => setImportOpen(true)} title="Import items from an Excel, CSV, PDF or photo">
              <FileUp /> Import
            </Button>
          ) : null}
          <ExportMenu
            buildDocument={buildDocument}
            fileBase={{ quoteNo: quoteNo ?? "Quotation", customer: header.customer_name, date: header.quote_date }}
            customerSheet={header.sheet_names[0] || "Quotation"}
          />
          {!readOnly ? (
            <Button onClick={save} loading={saving} title="Save (Ctrl+S)">
              <Save /> Save
            </Button>
          ) : null}
        </div>
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
                // Only columns that still exist (e.g. a draft from before Loading Charges was removed).
                extra_columns: (draft.header.extra_columns ?? []).map(({ after, ...c }) => (after && STANDARD_COLUMNS.includes(after) ? { ...c, after } : c)),
                hidden_columns: (draft.header.hidden_columns ?? []).filter((h) => (HIDEABLE_COLUMNS as readonly string[]).includes(h)),
                column_titles: Object.fromEntries(Object.entries(draft.header.column_titles ?? {}).filter(([k]) => STANDARD_COLUMNS.includes(k as StandardColumn))),
              });
              setLines(draft.lines.map((l) => ({ ...l, sheet: l.sheet ?? 0, actual_weight: l.actual_weight ?? "", extra: l.extra ?? {}, fmt: l.fmt ?? {}, overrides: typedTotals(l.overrides) })));
              setDirty(true);
              toast.success("Draft restored.");
            }}
          >
            Restore draft
          </Button>
        </div>
      ) : null}

      <fieldset disabled={readOnly} className="grid gap-6">
        {/* Customer: one short box */}
        <Card id="step-customer" className="scroll-mt-40">
          <CardBody className="grid gap-x-3 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-12">
            <Field label="Customer / company" htmlFor="q-customer" required className="sm:col-span-2 lg:col-span-5">
              <CustomerPicker
                id="q-customer"
                value={header.customer_name}
                disabled={readOnly}
                details={{ name: header.customer_name, contact_person: header.contact_person, phone: header.customer_phone, email: header.customer_email, address: header.customer_address }}
                onChange={(name) => setField("customer_name", name)}
                onPick={pickCustomer}
              />
            </Field>
            <Field label="Address" htmlFor="q-address" className="sm:col-span-2 lg:col-span-7">
              <Input id="q-address" value={header.customer_address} onChange={(e) => setField("customer_address", e.target.value)} maxLength={500} />
            </Field>
            <Field label="Contact person" htmlFor="q-contact" className="lg:col-span-3">
              <Input id="q-contact" value={header.contact_person} onChange={(e) => setField("contact_person", e.target.value)} maxLength={120} />
            </Field>
            <Field label="Phone" htmlFor="q-phone" className="lg:col-span-3">
              <Input id="q-phone" type="tel" value={header.customer_phone} onChange={(e) => setField("customer_phone", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Email" htmlFor="q-email" className="lg:col-span-3">
              <Input id="q-email" type="email" value={header.customer_email} onChange={(e) => setField("customer_email", e.target.value)} maxLength={160} />
            </Field>
            <Field label="Reference" htmlFor="q-ref" className="lg:col-span-3">
              <Input id="q-ref" value={header.reference} onChange={(e) => setField("reference", e.target.value)} maxLength={120} />
            </Field>
          </CardBody>
        </Card>
      </fieldset>

      {/* The sheet: items are added by typing in the Items cell (inventory suggestions) or by Import */}
      <section id="step-sheet" className="mt-4 scroll-mt-40">
        {/* Commission (left): the customer's prices are the China prices plus this commission.
            Search and range (right): lists the matching lines; clicking one selects it on the sheet. */}
        <LineSearchBar
          lines={sheetLines}
          header={header}
          inventoryVersion={inventoryVersion}
          readOnly={readOnly}
          onPick={goToRow}
          onAdd={addFromInventory}
          left={
            !readOnly ? (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="q-commission" className="font-medium text-slate-700">
                  Commission
                </label>
                <input
                  id="q-commission"
                  inputMode="decimal"
                  value={commissionDraft}
                  placeholder={multiply ? "1" : "0"}
                  onChange={(e) => setCommissionDraft(e.target.value)}
                  onBlur={applyCommission}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyCommission();
                    }
                  }}
                  className="num h-8 w-24 rounded-md border border-slate-300 bg-white px-2.5 text-right outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
                <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="radiogroup" aria-label="Commission as">
                  {(["percent", "multiply"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={(m === "multiply") === multiply}
                      title={m === "percent" ? "Percentage: China price + %" : "Multiply: China price × number"}
                      // Switching keeps the commission (shown the other way); a number not yet entered is dropped.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => writeLocalStorage(COMMISSION_MODE_KEY, m === "multiply" ? "multiply" : null)}
                      className={cn("h-6.5 w-8 rounded-md font-medium", (m === "multiply") === multiply ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}
                    >
                      {m === "percent" ? "%" : "×"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          }
        />
        <SheetGrid
          jumpTo={jump}
          highlightKey={flashKey}
          key={chinaView ? "china" : sheetIndex}
          baseCurrency={company.base_currency}
          lines={chinaView ? chinaLines : sheetLines}
          onChange={chinaView ? commitChinaLines : commitSheetLines}
          header={header}
          totals={chinaView ? chinaTotals : sheetTotals}
          sheetNames={tabNames}
          activeSheet={chinaView ? 0 : sheetIndex + 1}
          onSelectSheet={selectTab}
          onAddSheet={addSheet}
          onRenameSheet={(i, name) => (i === 0 ? toast.info("The China sheet keeps its name.") : renameSheet(i - 1, name))}
          onDeleteSheet={(i) => (i === 0 ? toast.info("The China sheet can't be deleted.") : deleteSheet(i - 1))}
          lockTotals={chinaView}
          onColumnsChange={patchColumns}
          readOnly={readOnly}
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
              onCurrencyChange={changeCurrency}
              rateLoading={rateLoading}
            />
          </CardBody>
        </Card>
      </fieldset>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onAdd={addItems} priceOf={(item) => lineFromItem(item, 1, header, sheetIndex).unit_price} />
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
