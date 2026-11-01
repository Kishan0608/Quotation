"use client";

import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, MessageSquareText, Sparkles, UploadCloud } from "lucide-react";
import type { Workbook } from "exceljs";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { suggestColumns } from "@/app/(app)/import/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtQty, fmtWeight } from "@/lib/format";
import { fillGaps, workbookTops, type ColumnChoice } from "@/lib/import/sheet-columns";
import { detectInventoryColumns, parseInventoryWorkbook, type ImportResult, type ImportRow, type InventoryColumns, type InventoryField } from "@/lib/inventory/excel-import";
import { shipmentOrder } from "@/lib/inventory/shipment-order";
import { importInventoryItems, readInventoryText, type TextImportRow } from "./actions";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 20;

type FileRead = { name: string; workbook: Workbook; result: ImportResult; ai: boolean };
/** A preview row and the file it came from (several files). */
type FileRow = ImportRow & { file?: string };
type FileImport = Omit<ImportResult, "rows"> & { rows: FileRow[] };

/** Several files as one import, in shipment order (a later file's price wins). */
function combineFiles(files: FileRead[]): FileImport {
  const many = files.length > 1;
  return {
    sheetName: many ? "" : files[0]?.result.sheetName ?? "",
    rows: files.flatMap((f) => f.result.rows.map((r) => (many ? { ...r, file: f.name.replace(/\.xlsx$/i, "") } : r))),
    issues: files.flatMap((f) => f.result.issues.map((i) => (many ? { ...i, message: `${f.name}: ${i.message}` } : i))),
    truncated: files.some((f) => f.result.truncated),
    columns: files[0]?.result.columns ?? null,
  };
}

/** The headings' columns with the AI's filling the gaps; null when the AI adds nothing usable. */
function withAi(wb: Workbook, aiList: ColumnChoice<InventoryField>[]) {
  const rules = detectInventoryColumns(wb);
  const aiPick = aiList.find((a) => a.sheet === rules?.sheet) ?? aiList.find((a) => a.columns.description != null) ?? null;
  const merged = fillGaps<InventoryField>(rules, aiPick) as InventoryColumns | null;
  if (!merged || merged.columns.description == null) return null;
  const found = (Object.keys(merged.columns) as InventoryField[]).some((f) => rules?.columns[f] == null || rules.sheet !== merged.sheet);
  return { result: parseInventoryWorkbook(wb, merged), found };
}

const TEXT_EXAMPLE = `Paste the price message from China, e.g.
114X3.5MM 300MM 1.65kg 6.9 rmb
2" SCH40 TEE 5.3
4"X2" SCH40 同心大小头 8.4 元/件`;

/** Import inventory from a supplier's Excel file, or from a price message pasted as text. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [pasted, setPasted] = useState("");
  const [reading, setReading] = useState(false);
  /** The pasted message as inventory lines (text mode). */
  const [textRows, setTextRows] = useState<{ rows: TextImportRow[]; skipped: { row: number; message: string }[] } | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<FileImport | null>(null);
  const [parsing, setParsing] = useState(false);
  /** The AI placed columns the headings didn't name. */
  const [aiFound, setAiFound] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const fileToken = useRef(0);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    fileToken.current++;
    setResult(null);
    setTextRows(null);
    setAiFound(false);
    setAiBusy(false);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (importing || reading) return;
    reset();
    setPasted("");
    onClose();
  };

  /** The AI reads the pasted message; nothing is saved until Import. */
  const readText = async () => {
    if (!pasted.trim()) return;
    setReading(true);
    const res = await readInventoryText(pasted);
    setReading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (!res.data.rows.length) {
      toast.info("No items with a size were found in the text.");
      return;
    }
    setTextRows(res.data);
  };

  /** Reads one supplier file or several (in shipment order); their rows come into one import. */
  const readFiles = async (picked: File[]) => {
    const notExcel = picked.filter((f) => !/\.xlsx$/i.test(f.name));
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES);
    if (notExcel.length) toast.error(`Not an .xlsx Excel file, left out: ${notExcel.map((f) => f.name).join(", ")}`);
    if (tooBig.length) toast.error(`Larger than 5 MB, left out: ${tooBig.map((f) => f.name).join(", ")}`);
    const list = shipmentOrder(picked.filter((f) => !notExcel.includes(f) && !tooBig.includes(f))).slice(0, MAX_FILES);
    if (!list.length) return;
    if (picked.length > MAX_FILES) toast.info(`Only the first ${MAX_FILES} files are read.`);
    const token = ++fileToken.current;
    setParsing(true);
    setFileName(list.length > 1 ? `${list.length} files` : list[0].name);
    try {
      const { default: ExcelJS } = await import("exceljs");
      // The headings first (instant) for every file, then the AI checks the columns and fills what they missed.
      const files: FileRead[] = [];
      const failed: string[] = [];
      for (const f of list) {
        try {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(await f.arrayBuffer());
          files.push({ name: f.name, workbook: wb, result: parseInventoryWorkbook(wb, detectInventoryColumns(wb)), ai: false });
        } catch {
          failed.push(f.name);
        }
      }
      if (token !== fileToken.current) return;
      if (failed.length) toast.error(`Could not read: ${failed.join(", ")}`);
      if (!files.length) return reset();
      setResult(combineFiles(files));
      setParsing(false);
      setAiBusy(true);
      const checked = await Promise.all(
        files.map(async (f) => {
          // The headings named the item, price and quantity columns: no AI request needed.
          const rules = detectInventoryColumns(f.workbook);
          if (rules?.columns.description && rules.columns.unit_price && rules.columns.stock_qty) return f;
          const ai = await suggestColumns("inventory", workbookTops(f.workbook));
          const better = ai.ok && ai.data ? withAi(f.workbook, ai.data as ColumnChoice<InventoryField>[]) : null;
          return better ? { ...f, result: better.result, ai: better.found } : f;
        }),
      );
      if (token !== fileToken.current) return;
      setAiBusy(false);
      setAiFound(checked.some((f) => f.ai));
      setResult(combineFiles(checked));
    } catch {
      if (token !== fileToken.current) return;
      toast.error("Could not read that file. Is it a valid Excel workbook?");
      reset();
    } finally {
      if (token === fileToken.current) setParsing(false);
    }
  };



  const toImport = textRows ? textRows.rows.map((r) => r.data) : (result?.rows.map((r) => r.data) ?? []);
  const runImport = async () => {
    if (!toImport.length) return;
    setImporting(true);
    const res = await importInventoryItems({ rows: toImport });
    setImporting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    reset();
    setPasted("");
    onClose();
  };
  const updates = textRows?.rows.filter((r) => r.was !== undefined && r.data.unit_price != null).length ?? 0;
  const newOnes = textRows?.rows.filter((r) => r.was === undefined).length ?? 0;
  const flagged = textRows?.rows.filter((r) => r.problem).length ?? 0;

  return (
    <Modal
      open={open}
      onClose={close}
      locked={importing || reading}
      size="2xl"
      title="Import inventory"
      footer={
        result || textRows ? (
          <>
            <p className="mr-auto text-xs text-slate-500">Items already in inventory: only their price is updated.</p>
            <Button variant="outline" onClick={reset} disabled={importing}>
              {textRows ? "Change the text" : "Choose other files"}
            </Button>
            <Button onClick={runImport} loading={importing} disabled={!toImport.length || aiBusy}>
              Import {fmtQty(toImport.length)} items
            </Button>
          </>
        ) : null
      }
    >
      {!result && !textRows ? (
        <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm font-medium">
          {(
            [
              ["file", "Excel file", FileSpreadsheet],
              ["text", "Paste text", MessageSquareText],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5", mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      ) : null}
      {textRows ? (
        <TextPreview data={textRows} updates={updates} newOnes={newOnes} flagged={flagged} />
      ) : !result && mode === "text" ? (
        <div className="space-y-3">
          <textarea
            autoFocus
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={reading}
            rows={12}
            maxLength={20_000}
            placeholder={TEXT_EXAMPLE}
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{reading ? "The AI is reading the message…" : "English or Chinese, any layout. Each item is matched to your inventory before anything is saved."}</p>
            <Button onClick={readText} disabled={!pasted.trim() || reading} loading={reading}>
              {!reading ? <Sparkles /> : null} Read the text
            </Button>
          </div>
        </div>
      ) : !result ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = Array.from(e.dataTransfer.files ?? []);
            if (dropped.length) readFiles(dropped);
          }}
          className={cn(
            "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
            dragOver ? "border-brand-400 bg-brand-50" : "border-slate-300 bg-slate-50/60",
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-white text-brand-600 shadow-sm ring-1 ring-slate-200">
            {parsing ? <span className="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : <UploadCloud className="size-6" />}
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">{parsing ? `Reading ${fileName}…` : "Drop your .xlsx files here"}</p>
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple hidden onChange={(e) => e.target.files?.length && readFiles(Array.from(e.target.files))} />
          <Button variant="outline" className="mt-5" onClick={() => inputRef.current?.click()} disabled={parsing}>
            <FileSpreadsheet /> Choose files
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileSpreadsheet className="size-4 text-excel-700" />
            <span className="font-medium">{fileName}</span>
            {result.sheetName ? <Badge>Sheet: {result.sheetName}</Badge> : null}
            <Badge tone="green">
              <CheckCircle2 className="size-3" /> {result.rows.length} ready
            </Badge>
            {result.issues.length ? (
              <Badge tone="amber">
                <AlertTriangle className="size-3" /> {result.issues.length} skipped
              </Badge>
            ) : null}
            {result.truncated ? <Badge tone="red">Only the first 2,000 rows are imported</Badge> : null}
            {aiBusy ? (
              <span className="inline-flex items-center gap-1 text-xs text-violet-700">
                <Loader2 className="size-3 animate-spin" /> AI is checking the columns…
              </span>
            ) : aiFound ? (
              <span className="inline-flex items-center gap-1 text-xs text-violet-700">
                <Sparkles className="size-3" /> AI found columns the headings didn&apos;t name
              </span>
            ) : null}
          </div>


          {result.issues.length ? (
            <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <summary className="cursor-pointer font-medium">Rows that could not be imported</summary>
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                {result.issues.map((i) => (
                  <li key={`${i.row}-${i.message}`}>
                    {i.row ? `Row ${i.row}: ` : ""}
                    {i.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="scroll-thin max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  {["Row", "Items", "Wt (kg)", "Price", "Qty", "Note / Length"].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.slice(0, 300).map(({ row, data, file }) => (
                  <tr key={`${file ?? ""}-${row}`} className="hover:bg-slate-50">
                    <td className="num px-2 py-1.5 whitespace-nowrap text-slate-400">
                      {file ? `${file} · ` : ""}
                      {row}
                    </td>
                    <td className="px-2 py-1.5 font-medium">{data.description}</td>
                    <td className="num px-2 py-1.5 text-right">{fmtWeight(data.weight_kg)}</td>
                    <td className="num px-2 py-1.5 text-right">{data.unit_price != null ? fmtMoney(data.unit_price) : ""}</td>
                    <td className="num px-2 py-1.5 text-right">{fmtQty(data.stock_qty)}</td>
                    <td className="px-2 py-1.5 text-slate-500">{data.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length > 300 ? <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Showing the first 300 of {result.rows.length} rows.</p> : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The pasted message as it will be imported: each line next to what was written, price changes shown. */
function TextPreview({ data, updates, newOnes, flagged }: { data: { rows: TextImportRow[]; skipped: { row: number; message: string }[] }; updates: number; newOnes: number; flagged: number }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MessageSquareText className="size-4 text-brand-600" />
        <span className="font-medium">Pasted text</span>
        <Badge tone="green">
          <CheckCircle2 className="size-3" /> {data.rows.length} ready
        </Badge>
        {updates ? <Badge>{updates} price update{updates === 1 ? "" : "s"}</Badge> : null}
        {newOnes ? <Badge>{newOnes} new item{newOnes === 1 ? "" : "s"}</Badge> : null}
        {flagged ? (
          <Badge tone="amber">
            <AlertTriangle className="size-3" /> {flagged} to check
          </Badge>
        ) : null}
        {data.skipped.length ? <Badge tone="amber">{data.skipped.length} skipped</Badge> : null}
      </div>
      {data.skipped.length ? (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">Lines that could not be imported</summary>
          <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
            {data.skipped.map((i) => (
              <li key={`${i.row}-${i.message}`}>{i.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="scroll-thin max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr className="border-b border-slate-200">
              {["In the message", "Items", "Note / Length", "Wt (kg)", "Price (RMB)", "Qty", ""].map((h, i) => (
                <th key={i} className={cn("px-2 py-2 font-medium", i >= 3 && i <= 5 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map(({ row, source, data: d, was, problem }) => {
              const isNew = was === undefined;
              return (
                <tr key={row} className={cn("align-top hover:bg-slate-50", problem && "bg-amber-50/60")}>
                  <td className="max-w-56 px-2 py-1.5 text-slate-500">
                    {source}
                    {problem ? <p className="mt-0.5 font-medium text-amber-800">Check: {problem}</p> : null}
                  </td>
                  <td className="px-2 py-1.5 font-medium">{d.description}</td>
                  <td className="px-2 py-1.5 text-slate-500">{d.note}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtWeight(d.weight_kg)}</td>
                  <td className="num px-2 py-1.5 text-right whitespace-nowrap">
                    {d.unit_price == null ? (
                      <span className="text-slate-400">no price{isNew ? "" : " (kept)"}</span>
                    ) : !isNew && was != null && was !== d.unit_price ? (
                      <>
                        <span className="text-slate-400 line-through">{fmtMoney(was)}</span> <span className="font-semibold text-slate-900">{fmtMoney(d.unit_price)}</span>
                      </>
                    ) : (
                      fmtMoney(d.unit_price)
                    )}
                  </td>
                  <td className="num px-2 py-1.5 text-right">{d.stock_qty ? fmtQty(d.stock_qty) : ""}</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap uppercase", isNew ? "bg-brand-50 text-brand-700" : "bg-emerald-50 text-emerald-700")}>
                      {isNew ? "New item" : d.unit_price == null || was === d.unit_price ? "In inventory" : "Price update"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
