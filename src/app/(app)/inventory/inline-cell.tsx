"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { parseNumber } from "@/lib/format";

type Props = {
  value: number | string | null;
  display: string;
  kind: "number" | "text";
  editable: boolean;
  align?: "left" | "right";
  onSave: (value: number | string | null) => Promise<boolean>;
  label: string;
};

/** Click-to-edit table cell. Enter / blur saves, Esc cancels. */
export function InlineCell({ value, display, kind, editable, align = "right", onSave, label }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!editable) {
    return <span className={cn("block px-2 py-1", align === "right" && "text-right")}>{display || <span className="text-slate-300">—</span>}</span>;
  }

  const commit = async () => {
    if (draft == null) return;
    const next = kind === "number" ? parseNumber(draft) : draft.trim() || null;
    const current = value == null || value === "" ? null : value;
    if (next === current || (kind === "number" && draft.trim() !== "" && next == null)) {
      setDraft(null);
      return;
    }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setDraft(null);
  };

  if (draft != null) {
    return (
      <input
        autoFocus
        aria-label={label}
        inputMode={kind === "number" ? "decimal" : undefined}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
          }
        }}
        className={cn(
          "num h-7 w-full min-w-16 rounded-md border border-brand-400 bg-white px-2 text-sm shadow-sm ring-3 ring-brand-500/15 outline-none",
          align === "right" && "text-right",
          saving && "opacity-60",
        )}
      />
    );
  }

  return (
    <button
      type="button"
      title={`Click to edit ${label.toLowerCase()}`}
      onClick={() => setDraft(value == null ? "" : String(value))}
      className={cn(
        "num block w-full cursor-text rounded-md border border-transparent px-2 py-1 transition-colors hover:border-slate-300 hover:bg-white",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {display || <span className="text-slate-300">—</span>}
    </button>
  );
}
