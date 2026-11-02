import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "block rounded-lg border border-slate-300 bg-white text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-500/15";

// Full width unless the caller sets its own width (w-32, w-auto...), so overrides always win.
const width = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? undefined : "w-full");

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, width(className), "h-9 px-3", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, width(className), "min-h-20 px-3 py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(control, width(className), "select-chevron h-9 cursor-pointer pr-8 pl-3", className)}
      {...props}
    >
      {children}
    </select>
  );
}

function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-slate-700", className)} {...props} />;
}

type FieldProps = {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
