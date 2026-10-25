"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtQty } from "@/lib/format";
import { Select } from "./field";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  pageSizes?: readonly number[];
};

// 1 … 4 5 6 … 20
function pageList(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  let start = Math.max(2, Math.min(page - 1, count - 4));
  let end = Math.min(count - 1, Math.max(page + 1, 5));
  if (start === 3) start = 2; // no "…" standing in for a single page
  if (end === count - 2) end = count - 1;
  const list: (number | "gap")[] = [1];
  if (start > 2) list.push("gap");
  for (let n = start; n <= end; n++) list.push(n);
  if (end < count - 1) list.push("gap");
  list.push(count);
  return list;
}

const pageBtn =
  "inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed [&_svg]:size-4";

export function Pagination({ page, pageSize, total, noun, onPage, onPageSize, pageSizes = [25, 50, 100, 200] }: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const arrow = cn(pageBtn, "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:bg-transparent disabled:text-slate-300");

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span>
          Showing <span className="num font-medium text-slate-900">{fmtQty(first)}–{fmtQty(last)}</span> of{" "}
          <span className="num font-medium text-slate-900">{fmtQty(total)}</span> {noun}
        </span>
        {onPageSize ? (
          <label className="flex items-center gap-2 text-xs whitespace-nowrap text-slate-500">
            Rows per page
            <Select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="num h-8 w-[4.5rem] text-xs font-medium">
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>

      <nav aria-label="Pagination" className="flex items-center gap-1 self-end sm:self-auto">
        <button type="button" className={cn(arrow, "max-sm:hidden")} disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">
          <ChevronsLeft />
        </button>
        <button type="button" className={arrow} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </button>
        {pageList(page, pageCount).map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-xs text-slate-400">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPage(n)}
              aria-current={n === page ? "page" : undefined}
              className={cn(pageBtn, "num", n === page ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm")}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" className={arrow} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </button>
        <button type="button" className={cn(arrow, "max-sm:hidden")} disabled={page >= pageCount} onClick={() => onPage(pageCount)} aria-label="Last page">
          <ChevronsRight />
        </button>
      </nav>
    </div>
  );
}
