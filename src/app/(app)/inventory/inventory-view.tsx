"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Boxes,
  Copy,
  Download,
  FileUp,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { DEFAULT_SORT, PAGE_SIZES, type InventoryFilters, type InventorySort } from "@/lib/inventory/filters";
import { fmtMoney, fmtQty, fmtWeight } from "@/lib/format";
import type { InlineField } from "@/lib/inventory/schema";
import type { InventoryItemRow } from "@/lib/supabase/database.types";
import { deleteInventoryItems, updateInventoryField } from "./actions";
import { ImportDialog } from "./import-dialog";
import { InlineCell } from "./inline-cell";
import { InventoryForm, type InventoryFormMode } from "./inventory-form";

type Props = {
  rows: InventoryItemRow[];
  total: number;
  loadError: string | null;
  filters: InventoryFilters;
  baseCurrency: string;
};

export function InventoryView({ rows: initialRows, total, loadError, filters, baseCurrency }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Local copy so inline edits show instantly; re-synced whenever the server sends new rows.
  const [rows, setRows] = useState(initialRows);
  const [syncedFrom, setSyncedFrom] = useState(initialRows);
  if (syncedFrom !== initialRows) {
    setSyncedFrom(initialRows);
    setRows(initialRows);
  }

  const [form, setForm] = useState<InventoryFormMode | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState(filters.q);

  const pushParams = (patch: Partial<Record<string, string | number | null>>) => {
    const params = new URLSearchParams();
    const merged = { q: filters.q, sort: filters.sort, dir: filters.dir, page: filters.page, size: filters.pageSize, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v === null || v === "" || v === undefined) continue;
      if (k === "sort" && v === DEFAULT_SORT) continue;
      if (k === "dir" && v === "asc") continue;
      if (k === "page" && Number(v) === 1) continue;
      if (k === "size" && Number(v) === 50) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // Debounced search -> URL.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);
  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => pushParams({ q: value.trim(), page: 1 }), 350);
  };

  const toggleSort = (key: InventorySort) => {
    if (filters.sort !== key) pushParams({ sort: key, dir: "asc", page: 1 });
    else if (filters.dir === "asc") pushParams({ sort: key, dir: "desc", page: 1 });
    else pushParams({ sort: DEFAULT_SORT, dir: "asc", page: 1 });
  };

  const saveField = async (row: InventoryItemRow, field: InlineField, value: number | string | null) => {
    const previous = rows;
    setRows((list) => list.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)));
    const res = await updateInventoryField(row.id, field, value);
    if (!res.ok) {
      setRows(previous);
      toast.error(res.error);
      return false;
    }
    setRows((list) => list.map((r) => (r.id === row.id ? res.data : r)));
    return true;
  };

  const runDelete = async () => {
    if (!confirmIds) return;
    setDeleting(true);
    const res = await deleteInventoryItems(confirmIds);
    setDeleting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setConfirmIds(null);
  };

  const hasFilters = Boolean(filters.q);

  const pageQty = useMemo(() => rows.reduce((sum, r) => sum + Number(r.stock_qty), 0), [rows]);

  const exportHref = `/api/inventory/export?${new URLSearchParams(
    Object.entries({ q: filters.q }).filter(([, v]) => v) as [string, string][],
  ).toString()}`;

  const sortHeader = (label: string, sortKey: InventorySort, className?: string) => {
    const active = filters.sort === sortKey;
    const Icon = !active ? ArrowUpDown : filters.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={cn("px-2 py-2.5 font-medium", className)} aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : undefined}>
        <button type="button" onClick={() => toggleSort(sortKey)} className={cn("inline-flex items-center gap-1 hover:text-slate-900", active && "text-brand-700")}>
          {label}
          <Icon className={cn("size-3", !active && "opacity-40")} />
        </button>
      </th>
    );
  };

  return (
    <>
      <Card>
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="w-full max-w-md">
            <div>
              <label htmlFor="inv-search" className="mb-1.5 block text-xs font-medium text-slate-700">
                Search
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input id="inv-search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder='Item or note…' className="pl-9" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  pushParams({ q: "", page: 1 });
                }}
              >
                <X /> Clear
              </Button>
            ) : null}
            <a href={exportHref} className={buttonClasses("outline", "md")} download>
              <Download /> Export
            </a>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import Excel
            </Button>
            <Button onClick={() => setForm({ kind: "create" })}>
              <Plus /> Add item
            </Button>
          </div>
        </div>

        {loadError ? <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p> : null}

        {/* Table */}
        <div className={cn("scroll-thin overflow-x-auto transition-opacity", pending && "opacity-60")}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Boxes />}
              title={hasFilters ? "No items match your filters" : "Your inventory is empty"}
              description={hasFilters ? "Try another search." : "Add an item or import an Excel file."}
              action={
                !hasFilters ? (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setImportOpen(true)}>
                      <FileUp /> Import Excel
                    </Button>
                    <Button onClick={() => setForm({ kind: "create" })}>
                      <Plus /> Add item
                    </Button>
                  </div>
                ) : null
              }
            />
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  {/* Shares of the width, so the columns spread evenly instead of bunching on the right. */}
                  {sortHeader("Items", "description", "w-[24%] pl-4")}
                  {sortHeader("Wt (kg)", "weight", "w-[11%] pr-3 text-right")}
                  {sortHeader(`Price/pc (${baseCurrency})`, "price", "w-[13%] pr-3 text-right")}
                  {sortHeader("Quantity", "quantity", "w-[11%] pr-3 text-right")}
                  <th className="w-[16%] py-2.5 pr-2 pl-10 font-medium">Actual weight</th>
                  <th className="w-[15%] py-2.5 pr-2 pl-4 font-medium">Note / Length</th>
                  <th className="w-[10%] px-3 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="group hover:bg-slate-50/80">
                    <td className="py-1.5 pr-2 pl-4">
                      <span className="font-medium text-slate-900">{row.description}</span>
                    </td>
                    <td className="px-1 py-1.5">
                      <InlineCell kind="number" label="Weight per piece" editable value={row.weight_kg} display={fmtWeight(row.weight_kg)} onSave={(v) => saveField(row, "weight_kg", v)} />
                    </td>
                    <td className="px-1 py-1.5">
                      <InlineCell kind="number" label="Unit price" editable value={row.unit_price} display={row.unit_price == null ? "" : fmtMoney(row.unit_price)} onSave={(v) => saveField(row, "unit_price", v)} />
                    </td>
                    <td className="px-1 py-1.5">
                      <InlineCell kind="number" label="Quantity" editable value={row.stock_qty} display={fmtQty(row.stock_qty)} onSave={(v) => saveField(row, "stock_qty", v ?? 0)} />
                    </td>
                    <td className="py-1.5 pr-1 pl-8 text-xs">
                      <InlineCell kind="text" align="left" label="Actual weight" editable value={row.actual_weight} display={row.actual_weight ?? ""} onSave={(v) => saveField(row, "actual_weight", v)} />
                    </td>
                    <td className="py-1.5 pr-1 pl-2 text-xs">
                      <InlineCell kind="text" align="left" label="Note / Length" editable value={row.note} display={row.note ?? ""} onSave={(v) => saveField(row, "note", v)} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                        <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${row.description}`} onClick={() => setForm({ kind: "edit", item: row })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" title="Duplicate" aria-label={`Duplicate ${row.description}`} onClick={() => setForm({ kind: "duplicate", item: row })}>
                          <Copy />
                        </Button>
                        <Button variant="ghost" size="icon-sm" title="Delete" aria-label={`Delete ${row.description}`} className="hover:bg-red-50 hover:text-red-600" onClick={() => setConfirmIds([row.id])}>
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-medium">
                <tr>
                  <td colSpan={3} className="px-3 py-2.5 text-right text-xs text-slate-500">
                    Page totals
                  </td>
                  <td className="num px-3 py-2.5 text-right">{fmtQty(pageQty)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          noun="items"
          pageSizes={PAGE_SIZES}
          onPage={(page) => pushParams({ page })}
          onPageSize={(size) => pushParams({ size, page: 1 })}
        />
      </Card>

      {form ? (
        <InventoryForm
          mode={form}
          baseCurrency={baseCurrency}
          onClose={() => setForm(null)}
          onSaved={(item, kind) => {
            if (kind === "edit") setRows((list) => list.map((r) => (r.id === item.id ? item : r)));
          }}
        />
      ) : null}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={confirmIds != null}
        title={confirmIds && confirmIds.length > 1 ? `Delete ${confirmIds.length} items?` : "Delete this item?"}
        message="This cannot be undone. Saved quotations are not changed."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={runDelete}
        onClose={() => setConfirmIds(null)}
      />
    </>
  );
}
