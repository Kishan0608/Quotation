"use client";

import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { QuoteDocument } from "@/lib/quotation/types";

type Props = {
  buildDocument: () => QuoteDocument | null;
  fileBase: { quoteNo: string; customer: string };
};

/** Excel / PDF download. The file has exactly the sheet's columns (delete a column on the sheet to leave it out). */
export function ExportMenu({ buildDocument, fileBase }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (kind: "xlsx" | "pdf", orientation?: "portrait" | "landscape") => {
    const doc = buildDocument();
    if (!doc) return;
    setBusy(kind);
    try {
      const { downloadBlob, quoteFileName } = await import("@/lib/quotation/export-columns");
      if (kind === "xlsx") {
        const { buildQuotationWorkbook } = await import("@/lib/quotation/export-excel");
        const buffer = await buildQuotationWorkbook(doc);
        downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), quoteFileName(fileBase.quoteNo, fileBase.customer, "xlsx"));
      } else {
        const { buildQuotationPdf } = await import("@/lib/quotation/export-pdf");
        const blob = await buildQuotationPdf(doc, { orientation });
        downloadBlob(blob, quoteFileName(fileBase.quoteNo, fileBase.customer, "pdf"));
      }
      toast.success(kind === "xlsx" ? "Excel file downloaded." : "PDF downloaded.");
      setOpen(false);
    } catch (e) {
      console.error(e);
      toast.error("Could not generate the file. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  // Opens on hover (with a short grace period so the pointer can reach the menu) or on click.
  const openNow = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(false), 250);
  };
  const item = "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="relative" ref={ref} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" loading={busy != null}>
        <Download /> Export <ChevronDown className="opacity-70" />
      </Button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 w-64 pt-2">
          <div className="animate-scale-in rounded-xl border border-slate-200 bg-white p-2 shadow-pop">
            <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Download as</p>
            <button type="button" role="menuitem" onClick={() => run("xlsx")} disabled={busy != null} className={item}>
              <FileSpreadsheet className="size-4 text-excel-700" /> Excel workbook (.xlsx)
            </button>
            <button type="button" role="menuitem" onClick={() => run("pdf", "portrait")} disabled={busy != null} className={item}>
              <FileText className="size-4 text-red-600" /> PDF · A4 portrait
            </button>
            <button type="button" role="menuitem" onClick={() => run("pdf", "landscape")} disabled={busy != null} className={item}>
              <FileText className="size-4 rotate-90 text-red-600" /> PDF · A4 landscape
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
