"use client";

import { PackageSearch, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtQty, fmtWeight, parseNumber } from "@/lib/format";
import type { PickerItem } from "@/lib/inventory/types";

const PAGE_SIZE = 10;

type Props = {
  inQuote: Map<string, number>;
  onAdd: (item: PickerItem, qty: number) => void;
  disabled?: boolean;
};

export function ItemPicker({ inQuote, onAdd, disabled }: Props) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  // A new search starts again on page 1.
  const search = (value: string) => {
    setQ(value);
    setPage(1);
  };
  const [items, setItems] = useState<PickerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [q, page]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/inventory/search?${params}`, { signal: controller.signal, cache: "no-store" });
        if (res.status === 401) throw new Error("Your session has expired. Please sign in again.");
        if (!res.ok) throw new Error("Could not search inventory.");
        const json = (await res.json()) as { items: PickerItem[]; total: number };
        setItems(json.items);
        setTotal(json.total);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [params]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const add = (item: PickerItem) => {
    const qty = parseNumber(qtys[item.id]) ?? 1;
    onAdd(item, qty > 0 ? qty : 1);
    setFlash(item.id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 900);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-md">
          <Label htmlFor="pick-q">Search items</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input id="pick-q" value={q} onChange={(e) => search(e.target.value)} placeholder='"D4, D6, A8" or "2 tee"' className="pl-9" />
          </div>
        </div>
        {q ? (
          <button type="button" onClick={() => search("")} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
            <X className="size-3" /> Clear
          </button>
        ) : null}
      </div>

      <div className="mt-3 text-xs text-slate-500">
        {loading ? "Searching…" : `${fmtQty(total)} match${total === 1 ? "" : "es"}`}
      </div>

      <div className={cn("scroll-thin mt-2 overflow-x-auto rounded-lg border border-slate-200", loading && "opacity-70")}>
        {error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : items.length === 0 && !loading ? (
          <div className="flex flex-col items-center px-6 py-10 text-center text-sm text-slate-500">
            <PackageSearch className="mb-2 size-6 text-slate-400" />
            No items match.
          </div>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 font-medium">Items</th>
                <th className="px-2 py-2 text-right font-medium">Wt (kg)</th>
                <th className="px-2 py-2 text-right font-medium">RMB/PCS</th>
                <th className="px-2 py-2 text-right font-medium">Available</th>
                <th className="w-28 px-2 py-2 text-center font-medium">Quantity</th>
                <th className="w-24 px-3 py-2 text-center font-medium">Add</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const count = inQuote.get(item.id);
                return (
                  <tr key={item.id} className={cn("transition-colors hover:bg-brand-50/50", flash === item.id && "bg-excel-50")}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {item.item_code ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{item.item_code}</span> : null}
                        <span className="font-medium">{item.description}</span>
                        {count ? <Badge tone="green">In quote ×{fmtQty(count)}</Badge> : null}
                      </div>
                      {item.note ? <div className="mt-0.5 text-xs text-slate-500">{item.note}</div> : null}
                    </td>
                    <td className="num px-2 py-2 text-right">{fmtWeight(item.weight_kg) || "—"}</td>
                    <td className="num px-2 py-2 text-right">{item.unit_price != null ? fmtMoney(item.unit_price) : "—"}</td>
                    <td className={cn("num px-2 py-2 text-right", Number(item.stock_qty) <= 0 ? "text-red-600" : "text-slate-600")}>{fmtQty(item.stock_qty)}</td>
                    <td className="px-2 py-2 text-center align-middle">
                      <Input
                        aria-label={`Quantity for ${item.description}`}
                        inputMode="decimal"
                        placeholder="1"
                        value={qtys[item.id] ?? ""}
                        onChange={(e) => setQtys((m) => ({ ...m, [item.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!disabled) add(item);
                          }
                        }}
                        className="num mx-auto h-8 w-20 text-center"
                        disabled={disabled}
                      />
                    </td>
                    <td className="px-3 py-2 text-center align-middle">
                      <Button size="sm" variant="excel" onClick={() => add(item)} disabled={disabled} aria-label={`Add ${item.description}`}>
                        <Plus /> Add
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {total > PAGE_SIZE && !error ? <Pagination page={page} pageSize={PAGE_SIZE} total={total} noun="items" onPage={setPage} /> : null}
      </div>
    </div>
  );
}
