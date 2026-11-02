"use client";

import { Copy, FilePlus2, FileText, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import type { QuotationFilters, QuotationListRow } from "@/lib/data/quotations";
import { fmtDate, fmtMoney, fmtQty, fmtWeight } from "@/lib/format";
import { deleteQuotation } from "./actions";

type Props = {
  rows: QuotationListRow[];
  total: number;
  filters: QuotationFilters;
  loadError: string | null;
};

export function QuotationsList({ rows, total, filters, loadError }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.q);
  const [toDelete, setToDelete] = useState<QuotationListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const push = (patch: Partial<Record<"q" | "page" | "size", string | number>>) => {
    const merged = { q: filters.q, page: filters.page, size: filters.pageSize, ...patch };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", String(merged.q));
    if (Number(merged.page) > 1) params.set("page", String(merged.page));
    if (Number(merged.size) !== 25) params.set("size", String(merged.size));
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };


  const runDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const res = await deleteQuotation(toDelete.id);
    setDeleting(false);
    if (res.ok) {
      toast.success(res.message);
      setToDelete(null);
    } else toast.error(res.error);
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Search quotations"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (timer.current) clearTimeout(timer.current);
              const value = e.target.value;
              timer.current = setTimeout(() => push({ q: value.trim(), page: 1 }), 350);
            }}
            placeholder="Search quotation no. or customer"
            className="pl-9"
          />
        </div>
      </div>

      {loadError ? <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p> : null}

      <div className={cn("scroll-thin overflow-x-auto transition-opacity", pending && "opacity-60")}>
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={filters.q ? "No quotations match" : "No quotations yet"}
            description={filters.q ? "Try another search." : undefined}
            action={
              !filters.q ? (
                <ButtonLink href="/quotations/new">
                  <FilePlus2 /> New quotation
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2.5 font-medium">Quotation</th>
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium">Weight (kg)</th>
                <th className="px-3 py-2.5 text-right font-medium">Grand total</th>
                <th className="px-3 py-2.5 font-medium">Prepared by</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                return (
                  <tr key={row.id} className="group hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <Link href={`/quotations/${row.id}`} className="font-semibold text-brand-700 hover:text-brand-800 hover:underline">
                        {row.quote_no}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {fmtDate(row.quote_date)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900">{row.customer_name}</div>
                      {row.reference ? <div className="text-xs text-slate-500">Ref: {row.reference}</div> : null}
                    </td>
                    <td className="num px-3 py-3 text-right">{fmtQty(row.total_qty)}</td>
                    <td className="num px-3 py-3 text-right text-slate-600">{fmtWeight(row.total_weight_kg)}</td>
                    <td className="num px-3 py-3 text-right font-semibold">
                      <span className="mr-1 text-xs font-normal text-slate-500">{row.currency}</span>
                      {fmtMoney(row.grand_total)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{row.prepared_by ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <ButtonLink href={`/quotations/${row.id}`} variant="outline" size="sm">
                          Open
                        </ButtonLink>
                        <ButtonLink href={`/quotations/new?from=${row.id}`} variant="ghost" size="icon-sm" title="Duplicate" aria-label={`Duplicate ${row.quote_no}`}>
                          <Copy />
                        </ButtonLink>
                        <Button variant="ghost" size="icon-sm" title="Delete" aria-label={`Delete ${row.quote_no}`} className="hover:bg-red-50 hover:text-red-600" onClick={() => setToDelete(row)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        page={filters.page}
        pageSize={filters.pageSize}
        total={total}
        noun={total === 1 ? "quotation" : "quotations"}
        onPage={(page) => push({ page })}
        onPageSize={(size) => push({ size, page: 1 })}
      />

      <ConfirmDialog
        open={toDelete != null}
        title={`Delete ${toDelete?.quote_no ?? ""}?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={runDelete}
        onClose={() => setToDelete(null)}
      />
    </Card>
  );
}
