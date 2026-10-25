import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-slate-200 bg-white shadow-card", className)} {...props} />;
}

type CardHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  step?: number;
  className?: string;
};

export function CardHeader({ title, description, actions, icon, step, className }: CardHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {step != null ? (
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white">{step}</span>
        ) : icon ? (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 [&_svg]:size-4">{icon}</span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4 sm:p-5", className)} {...props} />;
}
