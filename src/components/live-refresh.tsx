"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const EVERY_MS = 10_000;

/**
 * Keeps a page's data current without a manual refresh: every few seconds (and when the tab is
 * shown again) it asks whether the listed tables changed - here or on another PC - and reloads
 * the page's data when they did. Nothing is shown.
 */
export function LiveRefresh({ tables }: { tables: ("inventory" | "customers" | "quotations")[] }) {
  const router = useRouter();
  const key = tables.join(",");

  useEffect(() => {
    let last: string | null = null;
    let busy = false;
    const check = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const res = await fetch(`/api/changes?tables=${key}`, { cache: "no-store" });
        if (!res.ok) return;
        const stamp = JSON.stringify(((await res.json()) as { stamps?: unknown }).stamps ?? null);
        if (last != null && stamp !== last) router.refresh();
        last = stamp;
      } catch {
        // offline for a moment: the next check catches up
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(check, EVERY_MS);
    const onShow = () => !document.hidden && void check();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [key, router]);

  return null;
}
