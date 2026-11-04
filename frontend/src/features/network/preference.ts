export type PreferredNetwork = "testnet" | "mainnet";

const STORAGE_KEY = "zeno.preferred-network";
const CHANGE_EVENT = "zeno:preferred-network";

export function readPreferredNetwork(): PreferredNetwork {
  if (typeof window === "undefined") {
    return "testnet";
  }
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "mainnet" || value === "testnet") {
      return value;
    }
  } catch {
    // ignore storage failures
  }
  return "testnet";
}

export function writePreferredNetwork(network: PreferredNetwork): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, network);
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(
    new CustomEvent<PreferredNetwork>(CHANGE_EVENT, { detail: network }),
  );
}

export function subscribePreferredNetwork(
  listener: (network: PreferredNetwork) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<PreferredNetwork>).detail;
    if (detail === "mainnet" || detail === "testnet") {
      listener(detail);
      return;
    }
    listener(readPreferredNetwork());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    listener(readPreferredNetwork());
  };
  window.addEventListener(CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function networkLabel(network: PreferredNetwork): string {
  return network === "mainnet" ? "Zcash mainnet" : "Zcash testnet";
}

export function isMainnetPreview(_network: PreferredNetwork): boolean {
  return false;
}
