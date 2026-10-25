"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-500">
        The page could not be loaded. Check your connection and try again.
        {error.digest ? <span className="mt-2 block font-mono text-xs text-slate-400">Reference: {error.digest}</span> : null}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <ButtonLink href="/dashboard" variant="outline">
          Dashboard
        </ButtonLink>
        <Button onClick={reset}>
          <RotateCcw /> Try again
        </Button>
      </div>
    </div>
  );
}
