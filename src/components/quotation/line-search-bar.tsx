"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtWeight } from "@/lib/format";
import type { PickerItem } from "@/lib/inventory/types";
import { PIPE_CHART } from "@/lib/pipe/chart-data";
import { isSearching, KIND_FILTERS, NO_SEARCH, RANGE_FIELDS, searchLines, sortFound, WALL_FILTERS, type FoundLine, type LineSearch, type SortKey } from "@/lib/quotation/line-search";
import type { QuoteHeader, QuoteLine } from "@/lib/quotation/types";
import { lineFromItem } from "./line-utils";

/** 1.5 -> 1 1/2", 4 -> 4" (an outside diameter off the chart as decimal inches). */
function sizeLabel(inches: number | null) {
  if (inches == null) return "—";
  const row = PIPE_CHART.find((r) => r[1] === inches);
  return `${row ? row[0] : Math.round(inches * 100) / 100}"`;
}

type Props = {
  /** The sheet's lines (to mark the items already on it). */
  lines: QuoteLine[];
  /** For the customer price of inventory items (the commission). */
  header: QuoteHeader;
  /** Changes when the inventory changed (here or on another PC): it is loaded again. */
  inventoryVersion: number;
  /** Shown on the left of the bar (the Commission box). */
  left?: ReactNode;
  readOnly: boolean;
  /** An item already on the sheet was clicked: select its row. */
  onPick: (index: number, key: string) => void;
  /** Inventory items to add to the sheet. */
  onAdd: (items: PickerItem[]) => void;
};

/**
 * Inventory finder above the sheet: a kind and wall filter (only B / C class, only tees...) and
 * "from ... to ..." on size (inch or mm), China price or customer price. The matches are listed
 * in the pipe-chart order (or by any column clicked) and added to the sheet with a click.
 */
export function LineSearchBar({ lines, header, inventoryVersion, left, readOnly, onPick, onAdd }: Props) {
  const [search, setSearch] = useState<LineSearch>(NO_SEARCH);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const active = isSearching(search);

  // The whole inventory, loaded when a search starts (and again after it changes).
  const [inventory, setInventory] = useState<{ items: PickerItem[]; version: number } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/inventory/all", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ items: PickerItem[] }>) : Promise.reject(new Error())))
      .then((json) => !cancelled && (setInventory({ items: json.items, version: inventoryVersion }), setLoadFailed(false)))
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [active, inventoryVersion]);

  // Inventory items as lines at today's prices (China price, and the customer price with the commission).
  const { margin_pct, pricing_basis, rate_per_kg } = header;
  const inventoryLines = useMemo(
    () => (inventory?.items ?? []).map((item) => lineFromItem(item, 1, { margin_pct, pricing_basis, rate_per_kg } as QuoteHeader)),
    [inventory, margin_pct, pricing_basis, rate_per_kg],
  );
  const itemsById = useMemo(() => new Map((inventory?.items ?? []).map((i) => [i.id, i])), [inventory]);
  const onSheet = useMemo(() => new Map(lines.flatMap((l, i) => (l.inventory_item_id ? [[l.inventory_item_id, i] as const] : []))), [lines]);

  // Pipe-chart order unless a column title was clicked.
  const order = sort ?? { key: "standard" as const, dir: "asc" as const };
  const found = useMemo(() => (active ? sortFound(searchLines(inventoryLines, search), order.key, order.dir) : []), [active, inventoryLines, search, order.key, order.dir]);
  const addable = found.filter((f) => f.line.inventory_item_id && !onSheet.has(f.line.inventory_item_id));
  const loading = active && !inventory && !loadFailed;

  const set = (patch: Partial<LineSearch>) => setSearch((s) => ({ ...s, ...patch }));
  const sortBy = (key: SortKey) => setSort(order.key === key ? { key, dir: order.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  const add = (items: (PickerItem | undefined)[]) => onAdd(items.filter((i): i is PickerItem => Boolean(i)));

  const head = (key: SortKey | null, label: string, align: "left" | "right" = "right") => {
    const on = key != null && order.key === key;
    const Icon = !on ? ArrowUpDown : order.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={cn("px-3 py-2 font-medium whitespace-nowrap", align === "right" ? "text-right" : "text-left")}>
        {key ? (
          <button type="button" onClick={() => sortBy(key)} className={cn("inline-flex items-center gap-1 hover:text-slate-900", on && "text-brand-700")}>
            {label} <Icon className={cn("size-3.5", !on && "opacity-40")} />
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {left}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select aria-label="Kind" value={search.kind} onChange={(e) => set({ kind: e.target.value })} className="h-8 w-32 text-sm">
            <option value="">All kinds</option>
            {KIND_FILTERS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Wall" value={search.wall} onChange={(e) => set({ wall: e.target.value as LineSearch["wall"] })} className="h-8 w-40 text-sm">
            <option value="">All walls</option>
            {WALL_FILTERS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Range of" value={search.field} onChange={(e) => set({ field: e.target.value as LineSearch["field"] })} className="h-8 w-36 text-sm">
            {RANGE_FIELDS.filter((f) => f.id !== "row").map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
          <Input aria-label="From" inputMode="decimal" placeholder="From" value={search.from} onChange={(e) => set({ from: e.target.value })} className="num h-8 w-20 text-right" />
          <span className="text-slate-400">to</span>
          <Input aria-label="To" inputMode="decimal" placeholder="To" value={search.to} onChange={(e) => set({ to: e.target.value })} className="num h-8 w-20 text-right" />
          {active ? (
            <button type="button" onClick={() => (setSearch((s) => ({ ...NO_SEARCH, field: s.field })), setSort(null))} title="Clear" aria-label="Clear" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {active ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              <span className="font-semibold text-slate-900">{found.length}</span> of {inventory?.items.length ?? 0} inventory items
            </span>
            {!readOnly && addable.length > 1 ? (
              <button
                type="button"
                onClick={() => add(addable.map((f) => itemsById.get(f.line.inventory_item_id!)))}
                className="ml-auto inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white hover:bg-brand-700"
              >
                <Plus className="size-3.5" /> Add all {addable.length}
              </button>
            ) : null}
          </div>
          {loading ? (
            <p className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" /> Loading the inventory…
            </p>
          ) : loadFailed ? (
            <p className="px-3 py-6 text-center text-sm text-red-600">Could not load the inventory. Check the connection and try again.</p>
          ) : found.length ? (
            <div className="scroll-thin max-h-80 overflow-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="sticky top-0 z-10 bg-white text-xs text-slate-500 shadow-[0_1px_0_#e2e8f0]">
                  <tr>
                    {head("standard", "Items", "left")}
                    {head("size", "Size")}
                    {head("china", "China price")}
                    {head("customer", "Customer price")}
                    {head("weight", "WT IN KGS")}
                    {head(null, "Note / Length", "left")}
                    {!readOnly ? <th className="w-24 px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {found.map((f) => (
                    <Row key={f.line.key} found={f} readOnly={readOnly} sheetIndex={f.line.inventory_item_id ? onSheet.get(f.line.inventory_item_id) : undefined} onPick={onPick} onAdd={() => add([itemsById.get(f.line.inventory_item_id!)])} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No inventory items match. Try another kind, wall or range.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Row({ found: f, readOnly, sheetIndex, onPick, onAdd }: { found: FoundLine; readOnly: boolean; sheetIndex: number | undefined; onPick: Props["onPick"]; onAdd: () => void }) {
  const cell = "num px-3 py-1.5 text-right";
  // An item already on the sheet goes to its row when clicked.
  return (
    <tr onClick={sheetIndex != null ? () => onPick(sheetIndex, f.line.key) : undefined} className={cn(sheetIndex != null && "cursor-pointer", "hover:bg-brand-50/60")}>
      <td className="px-3 py-1.5 font-medium text-slate-900">{f.line.description}</td>
      <td className={cell}>{sizeLabel(f.inches)}</td>
      <td className={cell}>{f.line.base_price == null ? "—" : fmtMoney(f.line.base_price)}</td>
      <td className={cell}>{f.line.unit_price == null ? "—" : fmtMoney(f.line.unit_price)}</td>
      <td className={cell}>{fmtWeight(f.line.unit_weight_kg)}</td>
      <td className="px-3 py-1.5 text-slate-600">{f.line.remarks}</td>
      {!readOnly ? (
        <td className="px-3 py-1 text-right">
          {sheetIndex != null ? (
            <span className="inline-flex items-center gap-1 text-xs text-excel-700">
              <Check className="size-3.5" /> On sheet
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
              className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-white px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              <Plus className="size-3.5" /> Add
            </button>
          )}
        </td>
      ) : null}
    </tr>
  );
}
