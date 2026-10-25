import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Tone = "slate" | "brand" | "green" | "amber" | "red" | "violet" | "sky";

const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge({ tone = "slate", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TONES[tone], className)}
      {...props}
    />
  );
}
