import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  networkLabel,
  readPreferredNetwork,
  subscribePreferredNetwork,
  writePreferredNetwork,
} from "@/features/network/preference";

function installWindowStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
  const listeners = new Map<string, Set<EventListener>>();
  const windowShim = {
    localStorage,
    addEventListener(type: string, listener: EventListener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    },
  };
  vi.stubGlobal("window", windowShim);
  return store;
}

describe("preferred network", () => {
  beforeEach(() => {
    installWindowStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to testnet and persists mainnet preview", () => {
    expect(readPreferredNetwork()).toBe("testnet");
    expect(networkLabel("testnet")).toBe("Zcash testnet");

    writePreferredNetwork("mainnet");
    expect(readPreferredNetwork()).toBe("mainnet");
    expect(networkLabel("mainnet")).toBe("Zcash mainnet");
  });

  it("notifies subscribers when the preference changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePreferredNetwork(listener);
    writePreferredNetwork("mainnet");
    expect(listener).toHaveBeenCalledWith("mainnet");
    unsubscribe();
  });
});
