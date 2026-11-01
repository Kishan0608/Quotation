"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtQty, fmtWeight } from "@/lib/format";
import type { PickerItem } from "@/lib/inventory/types";

/** Every relevant item, within reason: the list scrolls. */
const LIMIT = 50;

/**
 * Inventory items for what is being typed in the sheet's Items cell, from the same search as
 * the inventory page ("D4", "2 tee", "1" B/2.5 MM"). Null = not typing in an Items cell.
 */
export function useItemSuggestions(query: string | null) {
  const [found, setFound] = useState<{
    q: string;
    items: PickerItem[];
    failed: boolean;
  }>({ q: "", items: [], failed: false });
  const [loading, setLoading] = useState(false);
  const q = query?.trim() ?? "";

  useEffect(() => {
    if (!q) return;
    // A newer keystroke makes this search stale: its answer is ignored. (Not aborted: an aborted
    // fetch rejects, and the dev tools report that as an unhandled error.)
    let stale = false;
    const ask = async () => {
      try {
        const res = await fetch(
          `/api/inventory/search?${new URLSearchParams({ q, limit: String(LIMIT) })}`,
          { cache: "no-store" },
        );
        const json = (await res.json().catch(() => ({}))) as {
          items?: PickerItem[];
        };
        return res.ok ? (json.items ?? []) : null;
      } catch {
        return null;
      }
    };
    const t = setTimeout(async () => {
      setLoading(true);
      // A search can fail for a moment (e.g. while the sign-in is being renewed): tried once more.
      let items = await ask();
      if (items == null && !stale) {
        await new Promise((r) => setTimeout(r, 400));
        if (!stale) items = await ask();
      }
      if (stale) return;
      setFound(
        items ? { q, items, failed: false } : { q, items: [], failed: true },
      );
      setLoading(false);
    }, 150);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  // While the next search runs the last results stay, so the list doesn't flicker.
  return {
    items: q && found.q ? found.items : [],
    loading: Boolean(q) && loading,
    failed: Boolean(q) && found.q === q && found.failed && !loading,
    /** The answer for exactly this text has come (results, none, or failed). */
    done: Boolean(q) && found.q === q && !loading,
    query: q,
  };
}

type Props = {
  items: PickerItem[];
  loading: boolean;
  failed: boolean;
  active: number;
  style: CSSProperties;
  onHover: (i: number) => void;
  onPick: (item: PickerItem) => void;
};

/** The list under the Items cell being typed in: ↓ / ↑ to move, Enter or a click to take one. */
export function ItemSuggestList({
  items,
  loading,
  failed,
  active,
  style,
  onHover,
  onPick,
}: Props) {
  return (
    <div
      role="listbox"
      aria-label="Inventory items"
      style={style}
      // Clicking the list must not take the focus from the cell being typed in.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex animate-scale-in flex-col overflow-hidden rounded-md border border-[#c8c8c8] bg-white text-[13px] shadow-pop"
    >
      {items.length ? (
        // The items scroll inside the list.
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {items.map((item, i) => (
            <button
              key={item.id}
              // ↓ / ↑ keep the highlighted item in view.
              ref={
                i === active
                  ? (el) => el?.scrollIntoView({ block: "nearest" })
                  : undefined
              }
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(item)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-1.5 text-left",
                i === active ? "bg-[#e1efe6]" : "hover:bg-slate-50",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800">
                  {item.description}
                </span>
                {item.note ? (
                  <span className="block truncate text-[11px] text-slate-500">
                    {item.note}
                  </span>
                ) : null}
              </span>
              <span className="num shrink-0 text-right text-[12px] text-slate-600">
                {item.weight_kg != null
                  ? `${fmtWeight(item.weight_kg)} kg · `
                  : ""}
                <span className="font-semibold text-slate-800">
                  {item.unit_price != null
                    ? `RMB ${fmtMoney(item.unit_price)}`
                    : "no price"}
                </span>
                {item.stock_qty ? (
                  <span className="block text-[11px] text-slate-400">
                    {fmtQty(item.stock_qty)} available
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p
          className={cn(
            "px-3 py-2",
            failed ? "text-red-700" : "text-slate-500",
          )}
        >
          {loading
            ? "Searching…"
            : failed
              ? "Could not search the inventory just now. Type another letter to try again, or press Enter to keep what you typed."
              : "No inventory item matches. Press Enter to keep what you typed."}
        </p>
      )}
    </div>
  );
}
