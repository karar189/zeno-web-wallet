"use client";

// TeeSync: client for the opt-in Instant Sync server.
// The server only ever receives the viewing key. Spending stays on the local wallet service.
//
// When enclave-measurements.json carries PCRs (published by the reproducible enclave build),
// the client refuses to register unless the server proves, with a fresh AWS Nitro attestation
// document, that it is exactly that enclave image. The viewing key is then encrypted to a key
// that only exists inside the enclave, and state comes back encrypted to a key only this
// browser and the enclave hold. There is no fallback to an unattested server in that mode.

import { walletServiceUrl } from "@/features/faucet/client";
import { readPreferredNetwork } from "@/features/network/preference";
import { authorizedHeaders } from "@/features/session/vault";

import { measurementsConfigured, toHex, verifyAttestation, type Measurements } from "./attestation";
import measurementsFile from "./enclave-measurements.json";
import { b64, openState, randomBytes, sealToEnclave, unb64, type SealedState } from "./seal";

const BASE = (process.env.NEXT_PUBLIC_INSTANT_SYNC_URL ?? "").replace(/\/$/, "");
const ENABLED_KEY = "zeno.instantSync.v1.enabled";
const TOKEN_KEY = "zeno.instantSync.v1.token.testnet";
const STATE_KEY_KEY = "zeno.instantSync.v1.stateKey.testnet";
const ATTESTED_KEY = "zeno.instantSync.v1.attestedPcr0.testnet";
const CHANGE_EVENT = "zeno:instant-sync";

const pinned = measurementsFile as unknown as Partial<Measurements>;
const MEASUREMENTS: Measurements | null = measurementsConfigured(pinned) ? pinned : null;

type AttestationResponse = { document?: string | null; publicKey?: string | null; attested?: boolean };

/** Fetch the enclave key. With measurements configured, only a verified attestation is accepted. */
async function enclaveKey(): Promise<{ publicKey: Uint8Array | null; pcr0: string | null }> {
  const nonce = randomBytes(32);
  let res: Response;
  try {
    res = await withTimeout(`/v1/attestation?nonce=${toHex(nonce)}`, {}, 10_000);
  } catch (error) {
    if (MEASUREMENTS) throw new Error("Could not reach the Instant Sync enclave for attestation.");
    throw error;
  }
  const body = (await res.json().catch(() => null)) as AttestationResponse | null;
  if (MEASUREMENTS) {
    if (!res.ok || !body?.document) throw new Error("Instant Sync server did not provide an enclave attestation.");
    const verified = await verifyAttestation(unb64(body.document), { expected: MEASUREMENTS, nonce });
    return { publicKey: verified.publicKey, pcr0: verified.pcrs.pcr0 };
  }
  // Dev / unattested server: encrypt if it offers a key, else fall back to the v0 plaintext API.
  if (res.ok && body?.publicKey) return { publicKey: unb64(body.publicKey), pcr0: null };
  return { publicKey: null, pcr0: null };
}

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

  /** True when this build pins an enclave measurement and refuses anything else. */
  requiresAttestation(): boolean {
    return MEASUREMENTS !== null;
  },

  /** PCR0 of the enclave the current registration was attested against, if any. */
  attestedPcr0(): string | null {
    return store()?.getItem(ATTESTED_KEY) ?? null;
  },

  /** Register a viewing key. Stores the bearer token (and state key) locally. */
  async register(ufvk: string, birthday?: number | null): Promise<InstantState["status"]> {
    const { publicKey, pcr0 } = await enclaveKey();
    const message = birthday ? { ufvk, birthday } : { ufvk };
    let payload: unknown = message;
    let stateKey: Uint8Array | null = null;
    if (publicKey) {
      const sealed = await sealToEnclave(publicKey, message);
      payload = { sealed: sealed.box };
      stateKey = sealed.stateKey;
    }
    const res = await withTimeout(
      "/v1/register",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
      10_000,
    );
    const body = (await res.json().catch(() => null)) as { token?: string; status?: InstantState["status"]; error?: string } | null;
    if (res.status !== 201 || !body?.token) {
      throw new Error(body?.error ?? `Instant Sync register failed (${res.status}).`);
    }
    const s = store();
    s?.setItem(TOKEN_KEY, body.token);
    if (stateKey) s?.setItem(STATE_KEY_KEY, b64(stateKey));
    else s?.removeItem(STATE_KEY_KEY);
    if (pcr0) s?.setItem(ATTESTED_KEY, pcr0);
    else s?.removeItem(ATTESTED_KEY);
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
      const body = (await res.json()) as InstantState | { sealed: SealedState };
      if ("sealed" in body) {
        const key = store()?.getItem(STATE_KEY_KEY);
        if (!key) return null;
        return await openState<InstantState>(unb64(key), body.sealed);
      }
      // A plaintext answer from a server we registered with an attested, sealed key means
      // something between us and the enclave changed. Do not trust it.
      if (store()?.getItem(STATE_KEY_KEY)) return null;
      return body;
    } catch {
      return null;
    }
  },

  /** Delete the server's copy and the local token. */
  async forget(): Promise<void> {
    const token = store()?.getItem(TOKEN_KEY);
    store()?.removeItem(TOKEN_KEY);
    store()?.removeItem(STATE_KEY_KEY);
    store()?.removeItem(ATTESTED_KEY);
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
    if (!TeeSync.available() || !TeeSync.enabled()) return;
    // Registered with an unattested server or an older enclave build: drop it and re-register.
    if (TeeSync.hasToken() && MEASUREMENTS && TeeSync.attestedPcr0() !== MEASUREMENTS.pcr0) await TeeSync.forget();
    if (TeeSync.hasToken()) return;
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
