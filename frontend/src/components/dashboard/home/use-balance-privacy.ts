"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "emperor.balance.hidden";

function readHidden(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function setHidden(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }
  listeners.forEach((listener) => listener());
}

export function useBalancePrivacy() {
  const hidden = useSyncExternalStore(subscribe, readHidden, () => false);

  const toggle = useCallback(() => {
    setHidden(!readHidden());
  }, []);

  return { hidden, toggle };
}
