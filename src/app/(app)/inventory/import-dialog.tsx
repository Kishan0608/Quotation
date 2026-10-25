"use client";

import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtQty, fmtWeight } from "@/lib/format";
import type { ImportResult } from "@/lib/inventory/excel-import";
import { importInventoryItems } from "./actions";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setResult(null);
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const close = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const readFile = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("Please choose an .xlsx Excel file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("That file is larger than 5 MB.");
      return;
    }
    setParsing(true);
    setFileName(file.name);
    try {
      const [{ default: ExcelJS }, { parseInventoryWorkbook }] = await Promise.all([import("exceljs"), import("@/lib/inventory/excel-import")]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      setResult(parseInventoryWorkbook(workbook));
    } catch {
      toast.error("Could not read that file. Is it a valid Excel workbook?");
      reset();
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    if (!result?.rows.length) return;
    setImporting(true);
    const res = await importInventoryItems({ rows: result.rows.map((r) => r.data) });
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
      title="Import inventory from Excel"
      footer={
        result ? (
          <>
            <p className="mr-auto text-xs text-slate-500">Items already in inventory: only their price is updated.</p>
            <Button variant="outline" onClick={reset} disabled={importing}>
              Choose another file
            </Button>
            <Button onClick={runImport} loading={importing} disabled={!result.rows.length}>
              Import {fmtQty(result.rows.length)} items
            </Button>
          </>
        ) : null
      }
    >
      {!result ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) readFile(file);
          }}
          className={cn(
            "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
            dragOver ? "border-brand-400 bg-brand-50" : "border-slate-300 bg-slate-50/60",
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-white text-brand-600 shadow-sm ring-1 ring-slate-200">
            {parsing ? <span className="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : <UploadCloud className="size-6" />}
          </span>
          <p className="mt-4 text-sm font-medium text-slate-900">{parsing ? `Reading ${fileName}…` : "Drop your .xlsx file here"}</p>
          <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          <Button variant="outline" className="mt-5" onClick={() => inputRef.current?.click()} disabled={parsing}>
            <FileSpreadsheet /> Choose file
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
                  {["Row", "Item no.", "Items", "Wt (kg)", "Price", "Qty", "Note / Length"].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.slice(0, 300).map(({ row, data }) => (
                  <tr key={row} className="hover:bg-slate-50">
                    <td className="num px-2 py-1.5 text-slate-400">{row}</td>
                    <td className="px-2 py-1.5 font-mono">{data.item_code}</td>
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
