"use client";

import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Sparkles, UploadCloud } from "lucide-react";
import type { Workbook } from "exceljs";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { suggestColumns } from "@/app/(app)/import/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { detectCustomerColumns, mergeCustomerRows, parseCustomerWorkbook, type CustomerColumns, type CustomerField, type CustomerImportResult } from "@/lib/customers/excel-import";
import { fmtQty } from "@/lib/format";
import { fillGaps, workbookTops, type ColumnChoice } from "@/lib/import/sheet-columns";
import { importCustomers } from "./actions";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;

type FileRead = { name: string; workbook: Workbook; result: CustomerImportResult; ai: boolean };
type Read = { files: FileRead[]; result: CustomerImportResult };

/** Several files as one list: the same customer in two files is one customer, details combined. */
function combineFiles(files: FileRead[]): CustomerImportResult {
  const many = files.length > 1;
  const label = (f: FileRead, sheet: string) => (many ? `${f.name.replace(/\.xlsx$/i, "")} · ${sheet}` : sheet);
  return {
    sheetName: files.map((f) => (many ? `${f.name} (${f.result.sheetName})` : f.result.sheetName)).filter(Boolean).join(", "),
    rows: mergeCustomerRows(files.map((f) => f.result.rows.map((r) => ({ ...r, sheet: label(f, r.sheet) })))),
    issues: files.flatMap((f) => f.result.issues.map((i) => (many ? { ...i, message: `${f.name}: ${i.message}` } : i))),
    truncated: files.some((f) => f.result.truncated),
    columns: files.flatMap((f) => f.result.columns),
  };
}

/** The headings' columns with the AI's filling the gaps, sheet by sheet. */
function withAi(workbook: Workbook, rules: CustomerColumns[], aiList: ColumnChoice<CustomerField>[]) {
  const choices: CustomerColumns[] = [];
  let found = false;
  for (const ws of workbook.worksheets) {
    const rule = rules.find((r) => r.sheet === ws.name) ?? null;
    const merged = fillGaps(rule, aiList.find((a) => a.sheet === ws.name) ?? null);
    if (!merged || merged.columns.name == null) continue;
    choices.push(merged);
    found ||= (Object.keys(merged.columns) as CustomerField[]).some((f) => rule?.columns[f] == null);
  }
  return { choices, found };
}

/** Import customers from Excel: a preview first, then new ones are added and saved ones updated. */
export function CustomerImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [read, setRead] = useState<Read | null>(null);
  const [parsing, setParsing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileToken = useRef(0);
  const result = read?.result ?? null;
  /** Rows from more than one sheet or file: each row says where it came from. */
  const multiSource = new Set(result?.rows.map((r) => r.sheet)).size > 1;

  const reset = () => {
    fileToken.current++;
    setRead(null);
    setFileName("");
    setAiBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };
  const close = () => {
    if (importing) return;
    reset();
    onClose();
  };

  /** Reads one Excel file or several; the customers of all of them come into one list. */
  const readFiles = async (picked: File[]) => {
    const notExcel = picked.filter((f) => !/\.xlsx$/i.test(f.name));
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES);
    if (notExcel.length) toast.error(`Not an .xlsx Excel file, left out: ${notExcel.map((f) => f.name).join(", ")}`);
    if (tooBig.length) toast.error(`Larger than 5 MB, left out: ${tooBig.map((f) => f.name).join(", ")}`);
    const list = picked.filter((f) => !notExcel.includes(f) && !tooBig.includes(f)).slice(0, MAX_FILES);
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
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(await f.arrayBuffer());
          files.push({ name: f.name, workbook, result: parseCustomerWorkbook(workbook, detectCustomerColumns(workbook)), ai: false });
        } catch {
          failed.push(f.name);
        }
      }
      if (token !== fileToken.current) return;
      if (failed.length) toast.error(`Could not read: ${failed.join(", ")}`);
      if (!files.length) return reset();
      setRead({ files, result: combineFiles(files) });
      setParsing(false);
      setAiBusy(true);
      const checked = await Promise.all(
        files.map(async (f) => {
          // The headings named the customer and at least two of its details on every sheet: no AI request needed.
          const rules = detectCustomerColumns(f.workbook);
          const named = (c: CustomerColumns) => (["contact_person", "phone", "email", "address", "city"] as const).filter((k) => c.columns[k] != null).length >= 2;
          if (rules.length && rules.every(named)) return f;
          const ai = await suggestColumns("customers", workbookTops(f.workbook));
          if (!ai.ok || !ai.data) return f;
          const { choices, found } = withAi(f.workbook, detectCustomerColumns(f.workbook), ai.data as ColumnChoice<CustomerField>[]);
          return choices.length ? { ...f, result: parseCustomerWorkbook(f.workbook, choices), ai: found } : f;
        }),
      );
      if (token !== fileToken.current) return;
      setAiBusy(false);
      setRead({ files: checked, result: combineFiles(checked) });
    } catch {
      if (token !== fileToken.current) return;
      toast.error("Could not read that file. Is it a valid Excel workbook?");
      reset();
    } finally {
      if (token === fileToken.current) setParsing(false);
    }
  };

  const runImport = async () => {
    if (!result?.rows.length) return;
    setImporting(true);
    const res = await importCustomers({ rows: result.rows.map((r) => r.data) });
    setImporting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      locked={importing}
      size="2xl"
      title="Import customers from Excel"
      footer={
        result ? (
          <>
            <p className="mr-auto text-xs text-slate-500">A customer already saved (same name) gets the details from the file; empty cells keep what is saved.</p>
            <Button variant="outline" onClick={reset} disabled={importing}>
              Choose other files
            </Button>
            <Button onClick={runImport} loading={importing} disabled={!result.rows.length || aiBusy}>
              Import {fmtQty(result.rows.length)} customers
            </Button>
          </>
        ) : null
      }
    >
      {!result || !read ? (
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
          <p className="mt-1 max-w-md text-xs text-slate-500">One or several customer lists: every sheet of every file is read, and a customer in two files comes in once.</p>
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
            {result.sheetName ? <Badge>{multiSource ? "Sheets" : "Sheet"}: {result.sheetName}</Badge> : null}
            <Badge tone="green">
              <CheckCircle2 className="size-3" /> {result.rows.length} ready
            </Badge>
            {result.issues.length ? (
              <Badge tone="amber">
                <AlertTriangle className="size-3" /> {result.issues.length} skipped
              </Badge>
            ) : null}
            {result.truncated ? <Badge tone="red">Only the first 5,000 customers are imported</Badge> : null}
            {aiBusy ? (
              <span className="inline-flex items-center gap-1 text-xs text-violet-700">
                <Loader2 className="size-3 animate-spin" /> AI is checking the columns…
              </span>
            ) : read.files.some((f) => f.ai) ? (
              <span className="inline-flex items-center gap-1 text-xs text-violet-700">
                <Sparkles className="size-3" /> AI found columns the headings didn&apos;t name
              </span>
            ) : null}
          </div>

          {result.issues.length ? (
            <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" open={!result.rows.length}>
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

          <div className="scroll-thin max-h-[45vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  {["Row", "Customer / company", "Contact person", "Phone", "Email", "Address"].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.slice(0, 300).map(({ row, sheet, data }) => (
                  <tr key={`${sheet}-${row}`} className="hover:bg-slate-50">
                    <td className="num px-2 py-1.5 whitespace-nowrap text-slate-400">
                      {multiSource ? `${sheet} · ` : ""}
                      {row}
                    </td>
                    <td className="px-2 py-1.5 font-medium">{data.name}</td>
                    <td className="px-2 py-1.5">{data.contact_person}</td>
                    <td className="px-2 py-1.5">{data.phone}</td>
                    <td className="px-2 py-1.5">{data.email}</td>
                    <td className="max-w-64 truncate px-2 py-1.5 text-slate-500" title={data.address ?? ""}>
                      {data.address}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length > 300 ? <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Showing the first 300 of {result.rows.length} customers.</p> : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
