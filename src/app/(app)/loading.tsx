export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-slate-200" />
        <div className="h-7 w-64 rounded bg-slate-200" />
        <div className="h-4 w-96 max-w-full rounded bg-slate-200/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="h-96 rounded-xl border border-slate-200 bg-white" />
    </div>
  );
}
