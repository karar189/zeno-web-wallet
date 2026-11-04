"use client";

import { cn } from "@/lib/utils";
import { useSyncExternalStore } from "react";

// One preference shared by Send and Swap: show the full privacy explanations or keep the
// flow to the essentials. Stored per browser; falls back to "off" when storage is unavailable.
const KEY = "zeno.advancedView";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(next: boolean) {
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Storage blocked: the toggle still works for this page view.
  }
  memory = next;
  listeners.forEach((listener) => listener());
}

let memory: boolean | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      memory = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function snapshot(): boolean {
  if (memory === null) memory = read();
  return memory;
}

export function useAdvancedView(): [boolean, (next: boolean) => void] {
  const advanced = useSyncExternalStore(subscribe, snapshot, () => false);
  return [advanced, write];
}

export function AdvancedToggle({ className }: { className?: string }) {
  const [advanced, setAdvanced] = useAdvancedView();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={advanced}
      onClick={() => setAdvanced(!advanced)}
      className={cn("advanced-toggle", advanced && "is-on", className)}
    >
      <span className="advanced-toggle-track" aria-hidden="true">
        <span className="advanced-toggle-thumb" />
      </span>
      Advanced
    </button>
  );
}
