"use client";

import { useEffect, useRef } from "react";
import type { PickerItem } from "@/lib/inventory/types";

const EVERY_MS = 10_000;

/**
 * Calls `onItems` with the inventory items added or changed (here or on another PC) since the
 * hook started: every few seconds, and as soon as the tab is shown again. Changes made before it
 * started are not sent. Off while `enabled` is false.
 */
export function useInventoryChanges(enabled: boolean, onItems: (items: PickerItem[]) => void) {
  const handler = useRef(onItems);
  useEffect(() => {
    handler.current = onItems;
  });

  useEffect(() => {
    if (!enabled) return;
    let cursor: string | null = null;
    let busy = false;
    let stopped = false;
    const check = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try {
        const res = await fetch(`/api/inventory/changes${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { cursor: string; items: PickerItem[] };
        const first = cursor == null;
        cursor = json.cursor;
        if (!first && !stopped && json.items.length) handler.current(json.items);
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
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [enabled]);
}
