"use client";

// TeeSync: client for the opt-in Instant Sync server (v0 is a normal server; the API is
// shaped so the server can move into an attested enclave later).
// The server only ever receives the viewing key. Spending stays on the local wallet service.

import { walletServiceUrl } from "@/features/faucet/client";
import { readPreferredNetwork } from "@/features/network/preference";
import { authorizedHeaders } from "@/features/session/vault";

const BASE = (process.env.NEXT_PUBLIC_INSTANT_SYNC_URL ?? "").replace(/\/$/, "");
const ENABLED_KEY = "zeno.instantSync.v1.enabled";
const TOKEN_KEY = "zeno.instantSync.v1.token.testnet";
const CHANGE_EVENT = "zeno:instant-sync";

export type InstantBalance = {
  total: string;
  ironwood_spendable: string;
  orchard_spendable: string;
  sapling_spendable: string;
  transparent_spendable: string;
};

export type InstantState = {
  status: "registering" | "syncing" | "ready" | "error";
  balance: InstantBalance | null;
  txs: { txid: string; mined_height: number | null }[];
  chainTipHeight: number | null;
  lastSyncedAt: number | null;
  stalenessMs: number | null;
  firstSyncMs: number | null;
  lastSyncMs: number | null;
  error: string | null;
};

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

async function withTimeout(path: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(`${BASE}${path}`, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export const TeeSync = {
  /** Configured at build time and testnet selected. */
  available(): boolean {
    return BASE.length > 0 && readPreferredNetwork() === "testnet";
  },

  enabled(): boolean {
    return store()?.getItem(ENABLED_KEY) === "1";
  },

  setEnabled(on: boolean): void {
    const s = store();
    if (!s) return;
    if (on) s.setItem(ENABLED_KEY, "1");
    else s.removeItem(ENABLED_KEY);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  },

  subscribe(listener: () => void): () => void {
    window.addEventListener(CHANGE_EVENT, listener);
    return () => window.removeEventListener(CHANGE_EVENT, listener);
  },

  hasToken(): boolean {
    return Boolean(store()?.getItem(TOKEN_KEY));
  },

  /** Register a viewing key. Stores the bearer token locally. */
  async register(ufvk: string, birthday?: number | null): Promise<InstantState["status"]> {
    const res = await withTimeout(
      "/v1/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(birthday ? { ufvk, birthday } : { ufvk }),
      },
      10_000,
    );
    const body = (await res.json().catch(() => null)) as { token?: string; status?: InstantState["status"]; error?: string } | null;
    if (res.status !== 201 || !body?.token) {
      throw new Error(body?.error ?? `Instant Sync register failed (${res.status}).`);
    }
    store()?.setItem(TOKEN_KEY, body.token);
    return body.status ?? "registering";
  },

  /** Cached server state, or null if unavailable, unregistered, or slower than 3 s. */
  async getState(): Promise<InstantState | null> {
    const token = store()?.getItem(TOKEN_KEY);
    if (!token || !TeeSync.available()) return null;
    try {
      const res = await withTimeout("/v1/state", { headers: { authorization: `Bearer ${token}` } }, 3_000);
      if (res.status === 401) {
        store()?.removeItem(TOKEN_KEY); // server forgot us; re-register on next unlock
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as InstantState;
    } catch {
      return null;
    }
  },

  /** Delete the server's copy and the local token. */
  async forget(): Promise<void> {
    const token = store()?.getItem(TOKEN_KEY);
    store()?.removeItem(TOKEN_KEY);
    if (!token || !BASE) return;
    try {
      await withTimeout("/v1/account", { method: "DELETE", headers: { authorization: `Bearer ${token}` } }, 5_000);
    } catch {
      // Server unreachable: token is gone locally; the server copy stays until it is cleaned up.
    }
  },

  /**
   * If the toggle is on and we have no token yet, fetch the primary UFVK from the local wallet
   * service (unlocked session required) and register it. Safe to call on every unlock.
   */
  async ensureRegistered(): Promise<void> {
    if (!TeeSync.available() || !TeeSync.enabled() || TeeSync.hasToken()) return;
    const res = await fetch(`${walletServiceUrl()}/api/wallet/instant-sync/viewing-key`, {
      method: "POST",
      headers: await authorizedHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ approved: true }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { ufvk?: string; birthday?: number | null; message?: string } | null;
    if (!res.ok || !body?.ufvk) {
      throw new Error(body?.message ?? "The wallet did not release a viewing key.");
    }
    await TeeSync.register(body.ufvk, body.birthday ?? null);
  },
};

/** Sum of shielded spendable pools, in zatoshis, for reconciling with the local wallet. */
export function instantShieldedSpendable(balance: InstantBalance): bigint {
  return (
    BigInt(balance.ironwood_spendable || "0") +
    BigInt(balance.orchard_spendable || "0") +
    BigInt(balance.sapling_spendable || "0")
  );
}
