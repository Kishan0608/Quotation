"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileText, FileUp, Loader2, MessageSquareText, Plus, ScanText, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { useInventoryChanges } from "./use-inventory-changes";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtQty, parseNumber, round2, todayISO } from "@/lib/format";
import type { ImportRow } from "@/lib/import/match";
import { norm } from "@/lib/inventory/merge";
import type { PickerItem } from "@/lib/inventory/types";

const ACCEPT = ".xlsx,.csv,.txt,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff";
const MAX_BYTES = 10 * 1024 * 1024;
/** Files read in one go (each is read on its own, one after another). */
const MAX_FILES = 10;

/** A line for the sheet, with every field the sheet shows (item null = a new line, not in inventory). */
export type ImportedLine = {
  item: PickerItem | null;
  /** The item name for a new line. */
  text: string;
  qty: number | null;
  weight: number | null;
  actual: string;
  price: number | null;
  /** The sheet's Note / Length: the length (from the inventory, or given in the list) and the customer's note ("B CLASS", "galvanised"). */
  length: string;
  check?: string;
};

type Result = { ocr: boolean; ai: boolean; rows: ImportRow[]; text: string; note: string | null };

/** What the user decided for one line; the fields are kept as typed. */
type RowState = {
  include: boolean;
  /** Inventory item id, or "new" = a new line with the file's text. */
  choice: string;
  /** An item picked through the search (not among the suggestions). */
  extra: PickerItem | null;
  /** The user confirmed the item / the quantity (no longer red for it). */
  itemOk: boolean;
  qtyOk: boolean;
  name: string;
  qty: string;
  weight: string;
  actual: string;
  price: string;
  /** Note / Length, one field. */
  length: string;
};

/** Note / Length: the length and the customer's note in one field ("190MM, B CLASS"), each once. */
const noteLength = (...parts: (string | null | undefined)[]) =>
  parts
    .map((p) => p?.trim() ?? "")
    .filter((p, i, all) => p && all.findIndex((o) => o.toUpperCase() === p.toUpperCase()) === i)
    .join(", ");

const itemLabel = (i: PickerItem) => [i.description, i.note ? `(${i.note})` : ""].filter(Boolean).join(" ");
/** The AI reader's reason, added to a red line's message. */
const aiWhy = (row: ImportRow) => (row.why ? ` ${row.why}` : "");

function itemProblem(row: ImportRow, item: PickerItem): string | null {
  const top = row.matches[0]?.score ?? 0;
  if (row.issues.includes("similar")) {
    const tied = row.matches.filter((m) => m.score >= top - 0.01).map((m) => m.item);
    const list = tied.map((i) => `${i.description}${i.note ? ` (${i.note})` : ""} · ${i.unit_price != null ? `RMB ${fmtMoney(i.unit_price)}` : "no price"}`).join(" or ");
    return `${tied.length} items in your inventory match “${row.text}”: ${list}. Pick the right one.`;
  }
  if (row.issues.includes("size")) return `Size differs: the file says “${row.text}”, the inventory has “${item.description}”.${aiWhy(row)}`;
  if (row.issues.includes("fuzzy")) return `Name differs: the file says “${row.text}”, the inventory has “${itemLabel(item)}”.${aiWhy(row)}`;
  return null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onAdd: (lines: ImportedLine[]) => void;
  /** The sheet price of an inventory item (pricing rules applied). */
  priceOf: (item: PickerItem) => number | null;
};

/**
 * Import a customer's list - a file (Excel, CSV, PDF, photo) or a pasted message. Each line is
 * matched to the inventory and shown with every sheet field, ready to adjust; lines that aren't a
 * sure match are red with the reason and a way to fix them right there.
 */
export function ImportDialog({ open, onClose, onAdd, priceOf }: Props) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [pasted, setPasted] = useState("");
  /** The files being read / that were read (one or several). */
  const [files, setFiles] = useState<File[]>([]);
  const file = files[0] ?? null;
  /** Which of several files is being read. */
  const [reading, setReading] = useState<{ i: number; n: number; name: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [states, setStates] = useState<RowState[]>([]);
  const [onlyRed, setOnlyRed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const busy = busySince != null;

  // The picture preview lives as long as its file.
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const t = setTimeout(() => setPreview(url), 0);
    return () => {
      clearTimeout(t);
      URL.revokeObjectURL(url);
      setPreview(null);
    };
  }, [file]);

  // Ticks while reading, for the progress text.
  useEffect(() => {
    if (busySince == null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busySince]);

  const reset = () => {
    setFiles([]);
    setResult(null);
    setStates([]);
    setOnlyRed(false);
  };
  const close = () => {
    if (busy) return;
    reset();
    setPasted("");
    onClose();
  };

  /** Fields that come from the inventory item (a length given in the list wins; the customer's note follows it). */
  const fill = (row: ImportRow, item: PickerItem | null): Pick<RowState, "weight" | "actual" | "price" | "length"> => {
    const price = item ? (priceOf(item) ?? item.unit_price) : null;
    return {
      weight: item?.weight_kg != null ? String(item.weight_kg) : "",
      actual: item?.actual_weight ?? "",
      price: price != null ? String(price) : "",
      length: noteLength(row.length?.trim() || item?.note, row.note),
    };
  };

  /** Reads one file or several, one after another; their lines come into one list, in order. */
  const upload = async (picked: File | File[]) => {
    const list = (Array.isArray(picked) ? picked : [picked]).slice(0, MAX_FILES);
    const tooBig = list.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) toast.error(`Larger than 10 MB, left out: ${tooBig.map((f) => f.name).join(", ")}`);
    const ok = list.filter((f) => f.size <= MAX_BYTES);
    if (!ok.length) return;
    if ((Array.isArray(picked) ? picked.length : 1) > MAX_FILES) toast.info(`Only the first ${MAX_FILES} files are read.`);
    reset();
    setFiles(ok);
    const started = Date.now();
    setNow(started);
    setBusySince(started);
    const read: Result = { ocr: false, ai: false, rows: [], text: "", note: null };
    const failed: string[] = [];
    try {
      for (const [i, f] of ok.entries()) {
        setReading({ i: i + 1, n: ok.length, name: f.name });
        try {
          const form = new FormData();
          form.append("file", f);
          const res = await fetch("/api/import/items", { method: "POST", body: form });
          const json = (await res.json().catch(() => ({}))) as Partial<Result> & { error?: string };
          if (!res.ok || !json.rows) throw new Error(json.error ?? "Could not read this file.");
          read.ocr ||= Boolean(json.ocr);
          read.ai ||= Boolean(json.ai);
          read.rows.push(...json.rows);
          read.text += `${ok.length > 1 ? `--- ${f.name} ---\n` : ""}${json.text ?? ""}\n`;
          if (json.note) read.note = [read.note, ok.length > 1 ? `${f.name}: ${json.note}` : json.note].filter(Boolean).join(" ");
        } catch (e) {
          failed.push(`${f.name}: ${(e as Error).message}`);
        }
      }
      if (failed.length) toast.error(failed.join(" · "));
      if (failed.length === ok.length) {
        setFiles([]);
        return;
      }
      setResult(read);
      setStates(
        read.rows.map((r) => {
          // Another size is another item: such a line comes in under its own name (as a new
          // line), with the closest items still offered in the item box.
          const item = r.issues.includes("size") || r.issues.includes("missing") ? null : (r.matches[0]?.item ?? null);
          return {
            include: true,
            choice: item?.id ?? "new",
            extra: null,
            itemOk: r.status === "matched",
            // No quantity in the document: 1 piece. A quantity that was hard to read stays red.
            qtyOk: !r.issues.includes("qty-unclear"),
            name: r.text,
            qty: String(r.qty ?? 1),
            ...fill(r, item),
          };
        }),
      );
      if (!read.rows.length) toast.info("No items were found.");
    } finally {
      setReading(null);
      setBusySince(null);
    }
  };

  const readPasted = () => {
    if (!pasted.trim()) return;
    void upload(new File([pasted], "Pasted text.txt", { type: "text/plain" }));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length) void upload(dropped);
  };
  /** A screenshot pasted with Ctrl+V is read like an uploaded picture. */
  const onPaste = (e: ClipboardEvent) => {
    if (mode !== "file" || busy || result) return;
    const pastedFiles = Array.from(e.clipboardData.files ?? []);
    if (pastedFiles.length) {
      e.preventDefault();
      void upload(pastedFiles.map((f, i) => new File([f], f.name || `Pasted picture ${i + 1}.png`, { type: f.type })));
    }
  };

  const setRow = (i: number, patch: Partial<RowState>) => setStates((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const itemOf = (row: ImportRow, s: RowState): PickerItem | null => (s.choice === "new" ? null : (row.matches.find((m) => m.item.id === s.choice)?.item ?? s.extra));

  // ---- Live inventory: a change made while this review is open (a price edited, an item added,
  // here or on another PC) reaches its rows. A weight, actual weight or price typed here stays.
  const review = useRef({ result, states });
  useEffect(() => {
    review.current = { result, states };
  });
  useInventoryChanges(open && result != null, (items) => {
    const { result: r, states: ss } = review.current;
    if (!r) return;
    const fresh = new Map(items.map((i) => [i.id, i]));
    const rows = r.rows.map((row) => (row.matches.some((m) => fresh.has(m.item.id)) ? { ...row, matches: row.matches.map((m) => ({ ...m, item: fresh.get(m.item.id) ?? m.item })) } : row));
    let updated = 0;
    let linked = 0;
    const next = ss.map((s, i) => {
      const row = r.rows[i];
      const was = itemOf(row, s);
      const now = was ? fresh.get(was.id) : undefined;
      if (was && now) {
        const before = fill(row, was);
        const after = fill(row, now);
        const patch: Partial<RowState> = s.extra?.id === now.id ? { extra: now } : {};
        for (const k of ["weight", "actual", "price"] as const) if (s[k] === before[k] && after[k] !== before[k]) patch[k] = after[k];
        if (patch.weight != null || patch.actual != null || patch.price != null) updated++;
        return Object.keys(patch).length ? { ...s, ...patch } : s;
      }
      // A new line whose name was just added to the inventory: linked to it.
      if (s.choice === "new") {
        const hit = items.find((it) => norm(it.description) === norm(s.name));
        if (hit) {
          linked++;
          return { ...s, choice: hit.id, extra: hit, itemOk: true, ...fill(row, hit) };
        }
      }
      return s;
    });
    review.current = { result: { ...r, rows }, states: next };
    setResult({ ...r, rows });
    setStates(next);
    if (updated || linked) {
      const parts = [updated ? `${updated} line${updated === 1 ? "" : "s"} re-priced` : "", linked ? `${linked} new line${linked === 1 ? "" : "s"} now found in inventory` : ""].filter(Boolean);
      toast.success(`Inventory changed: ${parts.join(", ")}.`);
    }
  });

  const view = useMemo(() => {
    if (!result) return null;
    return result.rows.map((row, i) => {
      const s = states[i];
      const item = itemOf(row, s);
      const qty = parseNumber(s.qty);
      const price = parseNumber(s.price);
      const closest = row.matches[0]?.item;
      const otherType = closest && row.length && closest.note && /CENTRIC/i.test(row.length) && /CENTRIC/i.test(closest.note) && row.length.toUpperCase() !== closest.note.toUpperCase();
      const notFound = !closest
        ? row.why
          ? `Not in your inventory: ${row.why} Enter its price, or pick an item.`
          : "Not in your inventory: enter its price, or pick an item."
        : otherType
          ? `Not in your inventory as ${row.length!.toUpperCase()}: you have ${closest.description} only as ${closest.note!.toUpperCase()}. Enter its price, or pick that item if it will do.`
          : row.issues.includes("size")
          ? `Not in your inventory as “${row.text}” (closest: ${itemLabel(closest)}${row.why ? "" : ", another size"}).${aiWhy(row)} Enter its price, or pick an item.`
          : `Not in your inventory.${aiWhy(row)} Enter its price, or pick an item (similar: ${itemLabel(closest)}).`;
      const problems = [
        item ? (s.itemOk ? null : itemProblem(row, item)) : price == null ? notFound : null,
        qty ? (s.qtyOk ? null : row.issues.includes("qty-unclear") ? "The quantity was hard to read: check it." : null) : "Enter the quantity.",
      ].filter((p): p is string => Boolean(p));
      const total = round2((qty ?? 0) * (price ?? 0));
      return { row, s, i, item, problems, red: s.include && problems.length > 0, total, qty: qty ?? 0 };
    });
  }, [result, states]);

  const counts = view
    ? { total: view.length, ready: view.filter((v) => v.s.include && !v.red).length, red: view.filter((v) => v.red).length, skipped: view.filter((v) => !v.s.include).length }
    : null;
  const toAdd = view?.filter((v) => v.s.include) ?? [];

  /** The lines not in the inventory, as an Excel for the supplier's prices (the filled-in file imports into Inventory). */
  const newOnes = toAdd.filter((v) => v.s.choice === "new");
  const downloadNew = async () => {
    try {
      const [{ buildNewItemsWorkbook, mergeNewItems }, { downloadBlob }] = await Promise.all([import("@/lib/quotation/export-new-items"), import("@/lib/quotation/export-columns")]);
      const items = mergeNewItems(newOnes.map(({ s }) => ({ description: s.name.trim() || "Item", qty: parseNumber(s.qty) ?? 0, length: s.length })));
      const source = files.length > 1 ? `${files.length} files` : (file?.name ?? "list").replace(/\.[^.]+$/, "");
      const buffer = await buildNewItemsWorkbook(items, `NEW ITEMS — ${source} — ${todayISO()}`);
      const safe = source.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "list";
      downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `New_items_${safe}_${todayISO()}.xlsx`);
      toast.success(`${items.length} new item${items.length === 1 ? "" : "s"} downloaded. Send it to the supplier; import the filled-in file in Inventory.`);
    } catch {
      toast.error("Could not make the Excel file.");
    }
  };
  const sumQty = toAdd.reduce((s, v) => s + v.qty, 0);
  const sumTotal = round2(toAdd.reduce((s, v) => s + v.total, 0));

  const add = () => {
    if (!toAdd.length) return;
    onAdd(
      toAdd.map(({ item, s, problems }) => ({
        item,
        text: s.name.trim() || "Item",
        qty: parseNumber(s.qty),
        weight: parseNumber(s.weight),
        actual: s.actual.trim(),
        price: parseNumber(s.price),
        length: s.length.trim(),
        check: problems.length ? problems.join(" ") : undefined,
      })),
    );
    reset();
    setPasted("");
    onClose();
  };

  const seconds = busySince ? Math.max(0, Math.round((now - busySince) / 1000)) : 0;
  const slow = Boolean(file && (file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".pdf")));
  const stage = !busy ? "" : seconds < 1 ? "Uploading…" : slow ? (seconds < 8 ? "Reading the text and matching it with your inventory…" : "Still reading: big photos and scans take a few more seconds…") : "Matching with your inventory…";

  const cell = "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <Modal
      open={open}
      onClose={close}
      locked={busy}
      size={result ? "full" : "xl"}
      title="Import items"
      footer={
        result ? (
          <>
            <p className="mr-auto text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{toAdd.length}</span> line{toAdd.length === 1 ? "" : "s"} · <span className="num font-semibold text-slate-800">{fmtQty(sumQty)}</span> pcs ·
              Final total <span className="num font-semibold text-slate-800">RMB {fmtMoney(sumTotal)}</span>
              {counts!.red ? <span className="ml-2 text-red-600">· red lines come onto the sheet in red, to finish checking there</span> : null}
            </p>
            {newOnes.length ? (
              <Button variant="outline" onClick={downloadNew} title="Excel of the lines not in your inventory, to get prices from the supplier">
                <Download /> Download new items
              </Button>
            ) : null}
            <Button variant="excel" onClick={add} disabled={!toAdd.length}>
              <Plus /> Add {toAdd.length} line{toAdd.length === 1 ? "" : "s"} to the sheet
            </Button>
          </>
        ) : null
      }
    >
      {!result ? (
        <div className="space-y-4" onPaste={onPaste}>
          {/* Upload a file, or paste the customer's message */}
          <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
            {(
              [
                ["file", "Upload a file", <FileUp key="f" className="size-4" />],
                ["text", "Paste text", <MessageSquareText key="t" className="size-4" />],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                disabled={busy}
                onClick={() => setMode(key)}
                className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors", mode === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {mode === "file" ? (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
                dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50",
                busy && "pointer-events-none",
              )}
            >
              {busy ? <Loader2 className="size-10 animate-spin text-brand-600" /> : <FileUp className="size-10 text-slate-400" />}
              <div>
                <p className="text-sm font-semibold text-slate-800">{busy ? (reading && reading.n > 1 ? `Reading file ${reading.i} of ${reading.n}: ${reading.name}` : `Reading ${file?.name ?? "the file"}`) : "Drop files here, click to choose, or paste a screenshot (Ctrl+V)"}</p>
                <p className="mt-1 text-xs text-slate-500">{busy ? `${stage} ${seconds ? `(${seconds}s)` : ""}` : "Excel, CSV, PDF or photos · one or several files · up to 10 MB each"}</p>
              </div>
              <input
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (chosen.length) void upload(chosen);
                }}
              />
              {!busy ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
                  <FileUp className="size-3.5" /> Choose files
                </span>
              ) : null}
            </label>
          ) : (
            <div className="space-y-2">
              <textarea
                aria-label="Customer's message"
                autoFocus
                value={pasted}
                disabled={busy}
                onChange={(e) => setPasted(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) readPasted();
                }}
                rows={11}
                placeholder={'Paste the customer\'s message, one item per line, e.g.\n114XSCH40 - 500 pcs\n2" SCH40 TEE 50 nos galvanised\n12" STD CAP qty 4 with marking'}
                className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">{busy ? `${stage} ${seconds ? `(${seconds}s)` : ""}` : "Words after an item (galvanised, B CLASS, urgent…) go to its Note / Length."}</p>
                <Button variant="excel" onClick={readPasted} disabled={!pasted.trim() || busy} loading={busy}>
                  <ScanText /> Read the list
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Source + summary */}
          <div className="flex flex-wrap items-center gap-3">
            {preview ? (
              <a href={preview} target="_blank" rel="noreferrer" title="Open the picture" className="block shrink-0 overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the upload */}
                <img src={preview} alt="Uploaded picture" className="h-12 w-16 object-cover" />
              </a>
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                {file?.type === "text/plain" ? <MessageSquareText className="size-5" /> : <FileText className="size-5" />}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800" title={files.map((f) => f.name).join("\n")}>
                {files.length > 1 ? `${files.length} files: ${files.map((f) => f.name).join(", ")}` : file?.name}
              </p>
              <p className="text-xs text-slate-500">
                {counts!.total} line{counts!.total === 1 ? "" : "s"} found{result.ai ? " · read with AI" : result.ocr ? " · read with OCR" : ""}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-excel-50 px-2.5 py-1 text-xs font-semibold text-excel-800">
                <CheckCircle2 className="size-3.5" /> {counts!.ready} ready
              </span>
              {counts!.red ? (
                <button
                  type="button"
                  onClick={() => setOnlyRed((v) => !v)}
                  className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", onlyRed ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100")}
                >
                  <AlertTriangle className="size-3.5" /> {counts!.red} to check{onlyRed ? " (showing)" : ""}
                </button>
              ) : null}
              {counts!.skipped ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{counts!.skipped} skipped</span> : null}
            </div>
          </div>
          {result.note ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{result.note}</p> : null}

          {view!.length ? (
            <div className="scroll-thin overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1280px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  <tr className="border-b border-slate-200">
                    <th className="w-9 px-3 py-2">
                      <span className="sr-only">Add</span>
                    </th>
                    <th className="px-2 py-2">In the list</th>
                    <th className="w-[19rem] px-2 py-2">Items</th>
                    <th className="w-20 px-1.5 py-2 text-right">WT in kgs</th>
                    <th className="w-28 px-1.5 py-2">Actual weight</th>
                    <th className="w-24 px-1.5 py-2 text-right">RMB/PCS</th>
                    <th className="w-20 px-1.5 py-2 text-right">QTY</th>
                    <th className="w-44 px-1.5 py-2">Note / Length</th>
                    <th className="w-28 px-3 py-2 text-right">Final total</th>
                  </tr>
                </thead>
                <tbody>
                  {view!
                    .filter((v) => !onlyRed || v.red)
                    .map(({ row, s, i, item, problems, red, total }) => {
                      const off = !s.include;
                      return (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-slate-100 align-top last:border-b-0",
                            red && "bg-red-50 shadow-[inset_4px_0_0] shadow-red-500",
                            off && "bg-slate-50 text-slate-400",
                          )}
                        >
                          <td className="px-3 py-2.5 text-center">
                            <input type="checkbox" aria-label={`Add ${row.text}`} checked={s.include} onChange={(e) => setRow(i, { include: e.target.checked })} className="mt-1.5 size-4 accent-excel-700" />
                          </td>
                          <td className="max-w-[15rem] px-2 py-2">
                            <div className="flex items-start gap-1.5 pt-1.5">
                              {off ? null : red ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-excel-700" />}
                              {/* Spec lists run words together with commas ("TEE,UNEQ,BW,CS..."): the name may wrap after each comma, and anywhere as a last resort, so it never spills under the item box. */}
                              <span className={cn("min-w-0 [overflow-wrap:anywhere]", off ? "line-through" : "font-medium text-slate-800")} title={row.text}>
                                {row.text.split(",").map((part, k) => (
                                  <Fragment key={k}>
                                    {k ? (
                                      <>
                                        ,<wbr />
                                      </>
                                    ) : null}
                                    {part}
                                  </Fragment>
                                ))}
                              </span>
                            </div>
                            {/* A concentric / eccentric reducer says so here, so two lines of the same size can be told apart. */}
                            {row.length && /CENTRIC/i.test(row.length) ? (
                              <span className="mt-1 ml-5 mr-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{row.length}</span>
                            ) : null}
                            {row.note ? <span className="mt-1 ml-5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{row.note}</span> : null}
                            {!off && problems.length ? (
                              <ul className="mt-1 space-y-0.5 pl-5 text-xs text-red-700">
                                {problems.map((p) => (
                                  <li key={p}>{p}</li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">
                            <ItemChooser
                              row={row}
                              current={item}
                              isNew={s.choice === "new"}
                              disabled={off}
                              red={red && !s.itemOk}
                              onPick={(choice, extra) => {
                                const picked = choice === "new" ? null : (row.matches.find((m) => m.item.id === choice)?.item ?? extra ?? null);
                                setRow(i, { choice, extra: extra ?? null, itemOk: choice !== "new", include: true, ...fill(row, picked) });
                              }}
                            />
                            {s.choice === "new" ? (
                              <input aria-label={`Item name for ${row.text}`} value={s.name} disabled={off} onChange={(e) => setRow(i, { name: e.target.value })} className={cn(cell, "mt-1.5")} placeholder="Item name" />
                            ) : null}
                          </td>
                          <td className="px-1.5 py-2">
                            <input aria-label="WT in kgs" inputMode="decimal" value={s.weight} disabled={off} onChange={(e) => setRow(i, { weight: e.target.value })} className={cn(cell, "num text-right")} />
                          </td>
                          <td className="px-1.5 py-2">
                            <input aria-label="Actual weight" value={s.actual} disabled={off} onChange={(e) => setRow(i, { actual: e.target.value })} className={cell} />
                          </td>
                          <td className="px-1.5 py-2">
                            <input
                              aria-label="RMB/PCS"
                              inputMode="decimal"
                              value={s.price}
                              disabled={off}
                              onChange={(e) => setRow(i, { price: e.target.value })}
                              className={cn(cell, "num text-right", !off && s.choice === "new" && parseNumber(s.price) == null && "border-red-400 ring-2 ring-red-100")}
                            />
                          </td>
                          <td className="px-1.5 py-2">
                            <input
                              aria-label={`Quantity for ${row.text}`}
                              inputMode="decimal"
                              value={s.qty}
                              placeholder="Qty"
                              disabled={off}
                              onChange={(e) => setRow(i, { qty: e.target.value, qtyOk: Boolean(parseNumber(e.target.value)) })}
                              className={cn(cell, "num text-right", !off && !(s.qtyOk && parseNumber(s.qty)) && "border-red-400 ring-2 ring-red-100")}
                            />
                          </td>
                          <td className="px-1.5 py-2">
                            <input aria-label="Note / Length" value={s.length} placeholder="—" disabled={off} onChange={(e) => setRow(i, { length: e.target.value })} className={cell} />
                          </td>
                          <td className={cn("num px-3 py-2 pt-3.5 text-right font-semibold", off ? "text-slate-400" : "text-slate-800")}>{fmtMoney(total)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">No items were found. Try a clearer photo, or paste the list as text.</p>
          )}

        </div>
      )}
    </Modal>
  );
}

/**
 * Picks the inventory item for a line: the suggestions, a search of the whole inventory, or
 * "add as a new line". The list floats over the window (it isn't cut off by the table).
 */
function ItemChooser({
  row,
  current,
  isNew,
  disabled,
  red,
  onPick,
}: {
  row: ImportRow;
  current: PickerItem | null;
  isNew: boolean;
  disabled: boolean;
  red: boolean;
  onPick: (choice: string, extra?: PickerItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickerItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const options: { item: PickerItem; score?: number }[] = q.trim() ? (results ?? []).map((item) => ({ item })) : row.matches.map((m) => ({ item: m.item, score: m.score }));

  // Search the whole inventory as the user types.
  useEffect(() => {
    if (!open || !q.trim()) return;
    // A newer keystroke makes this search stale: its answer is ignored (an aborted fetch would
    // reject, which the dev tools report as an unhandled error).
    let stale = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/inventory/search?${new URLSearchParams({ q: q.trim(), limit: "8" })}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { items?: PickerItem[] };
        if (!stale && res.ok) {
          setResults(json.items ?? []);
          setActive(0);
        }
      } catch {
        // offline: keep the last results
      } finally {
        if (!stale) setSearching(false);
      }
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, open]);

  // Close on a click outside, Esc, or when the window scrolls under it.
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = button.current!.getBoundingClientRect();
    const width = Math.max(r.width, 420);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    setPos(below < 340 && r.top > below ? { left, width, bottom: window.innerHeight - r.top + 4 } : { left, width, top: r.bottom + 4 });
    setHost((button.current!.closest("dialog") as HTMLElement | null) ?? document.body);
    setQ("");
    setResults(null);
    setActive(0);
    setOpen(true);
  };

  const pick = (item: PickerItem | null) => {
    setOpen(false);
    if (!item) onPick("new");
    else onPick(item.id, row.matches.some((m) => m.item.id === item.id) ? undefined : item);
    button.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active < options.length ? options[active].item : null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md border bg-white px-2.5 text-left text-xs transition-colors hover:border-slate-400 disabled:opacity-50",
          red ? "border-red-400 ring-2 ring-red-100" : "border-slate-300",
        )}
      >
        {isNew ? (
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-red-700">
            <Plus className="size-3.5 shrink-0" /> New line (not in inventory)
          </span>
        ) : current ? (
          // The item's name only: its note (length / reducer type) goes in the Note / Length column.
          <span className="truncate font-medium text-slate-800">{current.description}</span>
        ) : (
          <span className="text-slate-400">Choose an item…</span>
        )}
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-slate-400" />
      </button>
      {open && pos && host
        ? createPortal(
            <div
              ref={panel}
              role="listbox"
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
              className="fixed z-[70] animate-scale-in overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-pop"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                <Search className="size-4 shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Search the whole inventory…"
                  aria-label="Search the inventory"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
                {searching ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}
              </div>
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{q.trim() ? "Inventory" : "Best matches"}</p>
              <div className="scroll-thin max-h-64 overflow-y-auto pb-1">
                {options.length ? (
                  options.map((o, k) => (
                    <button
                      key={o.item.id}
                      type="button"
                      role="option"
                      aria-selected={current?.id === o.item.id}
                      onMouseEnter={() => setActive(k)}
                      onClick={() => pick(o.item)}
                      className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-xs", active === k ? "bg-brand-50" : "hover:bg-slate-50", current?.id === o.item.id && "font-semibold")}
                    >
                      <span className="min-w-0 flex-1 truncate text-slate-800">
                        {o.item.description}
                        {o.item.note ? <span className="ml-1.5 font-normal text-slate-500">{o.item.note}</span> : null}
                      </span>
                      <span className="num shrink-0 text-slate-500">{o.item.unit_price != null ? fmtMoney(o.item.unit_price) : "—"}</span>
                      {o.score != null ? (
                        <span className={cn("num w-10 shrink-0 text-right text-[10px] font-semibold", o.score >= 0.92 ? "text-excel-700" : "text-amber-600")}>{Math.round(o.score * 100)}%</span>
                      ) : null}
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-3 text-xs text-slate-500">{q.trim() ? (searching ? "Searching…" : "Nothing found in the inventory.") : "No similar items in the inventory."}</p>
                )}
              </div>
              <button
                type="button"
                onMouseEnter={() => setActive(options.length)}
                onClick={() => pick(null)}
                className={cn("flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-xs font-medium text-red-700", active === options.length ? "bg-red-50" : "hover:bg-red-50")}
              >
                <Plus className="size-3.5" /> Add as a new line (not in inventory)
              </button>
            </div>,
            host,
          )
        : null}
    </>
  );
}
