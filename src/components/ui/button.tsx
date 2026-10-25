import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "excel";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300",
  secondary: "bg-slate-900 text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-400",
  outline: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:bg-red-300",
  excel: "bg-excel-700 text-white shadow-sm hover:bg-excel-800 disabled:opacity-60",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-md px-2.5 text-xs",
  md: "h-9 gap-2 rounded-lg px-3.5 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-sm",
  icon: "size-9 rounded-lg",
  "icon-sm": "size-8 rounded-md",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean };

export function Button({ variant, size, loading, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size };

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
