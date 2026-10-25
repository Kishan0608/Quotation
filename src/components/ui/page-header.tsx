import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium tracking-wide text-brand-700 uppercase">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 grid size-12 place-items-center rounded-full bg-slate-100 text-slate-500 [&_svg]:size-5">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function AccessDenied({ message = "You do not have permission to view this page." }: { message?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
      <h2 className="text-base font-semibold text-amber-900">Access restricted</h2>
      <p className="mt-1 text-sm text-amber-800">{message}</p>
    </div>
  );
}
