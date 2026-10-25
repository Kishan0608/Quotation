"use client";

import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { parseNumber } from "@/lib/format";
import { Input } from "./field";

type Props = Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  suffix?: string;
};

/** Number input that keeps the raw text while typing and commits a parsed number on blur / Enter. */
export function NumInput({ value, onValueChange, min, max, allowEmpty = false, suffix, className, onBlur, onKeyDown, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    setDraft(null);
    let n = parseNumber(text);
    if (n == null) {
      if (allowEmpty) onValueChange(null);
      else if (value == null) onValueChange(min != null && min > 0 ? min : 0);
      return;
    }
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (n !== value) onValueChange(n);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        inputMode="decimal"
        value={draft ?? (value == null ? "" : String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          commit(e.target.value);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
          onKeyDown?.(e);
        }}
        className={cn("num", suffix && "pr-10", className)}
      />
      {suffix ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">{suffix}</span> : null}
    </div>
  );
}
