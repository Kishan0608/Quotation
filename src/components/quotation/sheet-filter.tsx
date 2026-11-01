"use client";

import { ArrowDownAZ, ArrowDownZA, FilterX, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";

export type FilterValue = { text: string; count: number };

type Props = {
  title: string;
  /** The column's values as shown, in sort order ("" = blank cells). */
  values: FilterValue[];
  /** The values shown now (null = every value, no filter). */
  shown: string[] | null;
  numeric: boolean;
  style: CSSProperties;
  onSort: (dir: "asc" | "desc") => void;
  /** null = no filter on this column. */
  onApply: (shown: string[] | null) => void;
  onClose: () => void;
};

const label = (v: string) => (v === "" ? "(Blanks)" : v);

/** Excel's AutoFilter menu for one column: sort, then tick the values to show. */
export function SheetFilterMenu({ title, values, shown, numeric, style, onSort, onApply, onClose }: Props) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(shown ?? values.map((v) => v.text)));
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  // Closes on a click outside or Esc, like Excel's dropdown.
  useEffect(() => {
    const outside = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? values.filter((v) => label(v.text).toLowerCase().includes(needle)) : values;
  }, [values, q]);
  const allTicked = visible.length > 0 && visible.every((v) => ticked.has(v.text));

  const toggleAll = () =>
    setTicked((t) => {
      const next = new Set(t);
      for (const v of visible) {
        if (allTicked) next.delete(v.text);
        else next.add(v.text);
      }
      return next;
    });
  const toggle = (text: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });

  const apply = () => {
    // A search narrows the result to the ticked values among those found (Excel does the same).
    const chosen = q.trim() ? visible.filter((v) => ticked.has(v.text)).map((v) => v.text) : values.filter((v) => ticked.has(v.text)).map((v) => v.text);
    onApply(chosen.length === values.length ? null : chosen);
  };

  const item = "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-[#e1efe6] disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div ref={box} role="dialog" aria-label={`Filter ${title}`} style={style} className="fixed z-50 flex w-64 animate-scale-in flex-col rounded-md border border-[#c8c8c8] bg-white py-1 text-[13px] text-[#1f1f1f] shadow-pop">
      <button type="button" className={item} onClick={() => onSort("asc")}>
        <ArrowDownAZ className="size-4 text-slate-500" /> {numeric ? "Sort Smallest to Largest" : "Sort A to Z"}
      </button>
      <button type="button" className={item} onClick={() => onSort("desc")}>
        <ArrowDownZA className="size-4 text-slate-500" /> {numeric ? "Sort Largest to Smallest" : "Sort Z to A"}
      </button>
      <div className="my-1 border-t border-[#e1e1e1]" />
      <button type="button" className={item} disabled={!shown} onClick={() => onApply(null)}>
        <FilterX className="size-4 text-slate-500" /> Clear filter from “{title}”
      </button>
      <div className="mx-3 mt-1.5 flex items-center gap-2 rounded border border-[#c8c8c8] px-2">
        <Search className="size-3.5 shrink-0 text-slate-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="Search" aria-label="Search the values" className="min-w-0 flex-1 py-1 outline-none" />
      </div>
      <div className="scroll-thin mx-3 mt-1.5 max-h-56 overflow-y-auto rounded border border-[#e1e1e1] py-1">
        <label className="flex cursor-pointer items-center gap-2 px-2 py-0.5 hover:bg-slate-50">
          <input type="checkbox" checked={allTicked} onChange={toggleAll} className="accent-[#217346]" />({q.trim() ? "Select All Search Results" : "Select All"})
        </label>
        {visible.map((v) => (
          <label key={v.text} className="flex cursor-pointer items-center gap-2 px-2 py-0.5 hover:bg-slate-50">
            <input type="checkbox" checked={ticked.has(v.text)} onChange={() => toggle(v.text)} className="accent-[#217346]" />
            <span className={cn("min-w-0 flex-1 truncate", v.text === "" && "text-slate-500 italic")}>{label(v.text)}</span>
            {v.count > 1 ? <span className="text-[11px] text-slate-400">{v.count}</span> : null}
          </label>
        ))}
        {!visible.length ? <p className="px-2 py-1 text-slate-400">No matches</p> : null}
      </div>
      <div className="mt-2 flex justify-end gap-2 px-3 pb-1.5">
        <button type="button" onClick={apply} disabled={!visible.some((v) => ticked.has(v.text)) && !!q.trim()} className="rounded border border-[#217346] bg-[#217346] px-4 py-1 font-medium text-white hover:bg-[#185c37] disabled:opacity-50">
          OK
        </button>
        <button type="button" onClick={onClose} className="rounded border border-[#c8c8c8] px-3 py-1 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
