"use client";

import { useSyncExternalStore } from "react";

const EVENT = "qp:local-storage";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / blocked storage
  }
}

/** Per-browser convenience storage. Always null during server rendering. */
export function useLocalStorage(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}

export function writeLocalStorage(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}
