"use client";

import { create } from "zustand";
import {
  DEFAULT_REQUIREMENTS,
  assessRequirements,
  type PrivacyRequirements,
} from "@/features/guard/policy";
import { classifyTestnetRecipient } from "@/features/payments/payment-request";
import { decodeTracking, trackingSnapshot } from "@/features/payments/recovery";
import { listVaultMeta, vaultReady } from "@/features/session/vault";
import type { ZcashTransactionBackend } from "@/features/payments/backend";
import { LiveWalletBackend } from "@/features/payments/live-backend";
import { PaymentOrchestrator } from "@/features/payments/orchestrator";
import { createWallRuntime } from "@/features/payments/runtime";
import { SimulatedZcashBackend } from "@/features/payments/simulated-backend";
import type {
  PaymentRecord,
  PreparationMode,
  Readiness,
  SyncState,
} from "@/features/payments/types";

const runtime = createWallRuntime();
const backendKind =
  process.env.NEXT_PUBLIC_WALLET_BACKEND === "live" ? "live" : "simulated";
const backend: ZcashTransactionBackend =
  backendKind === "live"
    ? new LiveWalletBackend()
    : new SimulatedZcashBackend(runtime);
const orchestrator = new PaymentOrchestrator(
  backend,
  runtime,
  () => `pay_${crypto.randomUUID()}`,
);

async function checkReadiness(mode: PreparationMode): Promise<Readiness> {
  return backend.warmUp ? backend.warmUp() : backend.getReadiness(mode);
}

export type ReadinessView = {
  sync: SyncState;
  spendableZatoshis: string | null;
  note: string;
};

type PaymentStore = {
  mode: PreparationMode;
  connected: boolean;
  backendKind: "simulated" | "live";
  backendLabel: string;
  honestyNotes: readonly string[];
  readiness: ReadinessView | null;
  record: PaymentRecord | null;
  activity: PaymentRecord[];
  busy: string | null;
  notice: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  setMode: (mode: PreparationMode) => Promise<void>;
  preparePayment: (input: {
    recipient: string;
    amountZec: string;
    zcashName?: string | null;
  }) => Promise<"review" | "stay">;
  authorize: (requirements?: PrivacyRequirements) => Promise<void>;
  keepTracking: boolean;
  trackingScope: string | null;
  setKeepTracking: (value: boolean) => void;
  restoreTracking: () => Promise<void>;
  selectActivity: (id: string) => void;
  clearActivity: () => void;
  track: () => Promise<void>;
};

function remember(
  activity: PaymentRecord[],
  record: PaymentRecord,
): PaymentRecord[] {
  return [record, ...activity.filter((item) => item.id !== record.id)].slice(
    0,
    8,
  );
}

function viewReadiness(readiness: {
  sync: SyncState;
  spendableZatoshis: bigint | null;
  note: string;
}): ReadinessView {
  return {
    sync: readiness.sync,
    spendableZatoshis: readiness.spendableZatoshis?.toString() ?? null,
    note: readiness.note,
  };
}

function recoveryKey(): string | null {
  if (backendKind === "simulated") return "emperor.tracking.simulated";
  const wallet = listVaultMeta().find((v) => v.hasSession);
  return wallet ? `emperor.tracking.${wallet.walletId}` : null;
}
function saveTracking(records: PaymentRecord[]) {
  const key = recoveryKey();
  if (!key || typeof sessionStorage === "undefined") return;
  const tracking = records
    .filter((r) => r.phase === "tracking" || r.phase === "submitting")
    .map(trackingSnapshot);
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ version: 1, records: tracking }),
    );
  } catch {
    /* Storage may be disabled; in-memory tracking continues. */
  }
}
let tracking = false;
const walletName = backendKind === "live" ? "testnet wallet" : "demo wallet";

export const usePaymentStore = create<PaymentStore>((set, get) => ({
  mode: "optimized",
  connected: false,
  backendKind,
  backendLabel: backend.label,
  honestyNotes: backend.honestyNotes,
  readiness: null,
  record: null,
  activity: [],
  keepTracking: false,
  trackingScope: null,
  setKeepTracking: (value) => {
    set({ keepTracking: value });
    if (value) saveTracking(get().activity);
    else {
      const key = recoveryKey();
      if (key) {
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* optional storage */
        }
      }
    }
  },
  restoreTracking: async () => {
    await vaultReady();
    const key = recoveryKey();
    if (!key || get().busy) return;
    if (get().trackingScope === key && get().activity.length) return;
    if (get().trackingScope && get().trackingScope !== key)
      set({ activity: [], record: null, keepTracking: false });
    set({ trackingScope: key });
    if (get().activity.length) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const activity = decodeTracking(raw, backendKind);
      set({ activity, record: activity[0] ?? null, keepTracking: true });
    } catch {
      /* Optional recovery cannot stop the wallet. */
    }
  },
  selectActivity: (id) => {
    const record = get().activity.find((r) => r.id === id);
    if (record && !get().busy) set({ record });
  },
  clearActivity: () => {
    if (get().busy) return;
    const key = recoveryKey();
    if (key) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* optional storage */
      }
    }
    set({ activity: [], record: null, keepTracking: false });
  },
  busy: null,
  notice: null,

  connect: async () => {
    set({ connected: true, notice: null });
    if (get().mode === "baseline") {
      set({
        readiness: {
          sync: "unknown",
          spendableZatoshis: null,
          note: "Baseline mode checks the wallet when you prepare a payment.",
        },
      });
      return;
    }

    set({ busy: `Checking the ${walletName}` });
    const readiness = await checkReadiness("optimized");
    set({ busy: null, readiness: viewReadiness(readiness) });
  },

  disconnect: () => {
    backend.clearWarmth?.();
    set({ connected: false, readiness: null, record: null, busy: null });
  },

  setMode: async (mode) => {
    set({ mode });
    if (!get().connected) {
      return;
    }
    if (mode === "baseline") {
      set({
        readiness: {
          sync: "unknown",
          spendableZatoshis: null,
          note: "Baseline mode checks the wallet when you prepare a payment.",
        },
      });
      return;
    }
    if (backend.isWarm) {
      return;
    }
    set({ busy: `Preparing the ${walletName}` });
    const readiness = await checkReadiness("optimized");
    set({ busy: null, readiness: viewReadiness(readiness) });
  },

  preparePayment: async (input) => {
    if (get().busy) return "stay";
    if (get().activity.some((r) => r.statusConfidence === "unknown")) {
      set({
        notice:
          "A previous submission has an unknown outcome. Check that payment in Activity and reconcile it with the wallet before starting another.",
      });
      return "stay";
    }
    set({ connected: true, busy: "Preparing", notice: null });
    const draft = orchestrator.createDraft(input, get().mode);
    const prepared = await orchestrator.prepare(draft);
    set({
      busy: null,
      record: prepared,
      activity: remember(get().activity, prepared),
    });
    return prepared.phase === "awaiting_approval" ? "review" : "stay";
  },

  authorize: async (requirements = DEFAULT_REQUIREMENTS) => {
    const record = get().record;
    if (!record || get().busy) {
      return;
    }
    const pool = classifyTestnetRecipient(record.request.recipient);
    const blockers = assessRequirements(
      {
        receiver: !pool.ok
          ? "unknown"
          : pool.pool === "transparent"
            ? "transparent"
            : "shielded",
        provider: false,
        verified:
          pool.ok &&
          (backendKind !== "live" || Boolean(record.preparation)),
      },
      requirements,
    );
    if (blockers.length) {
      set({ notice: blockers.join(" ") });
      return;
    }
    // Save an uncertain receipt before awaiting broadcast, never an approval to replay.
    if (get().keepTracking)
      saveTracking(
        remember(get().activity, { ...record, phase: "submitting" }),
      );
    set({ busy: "Submitting" });
    const next = await orchestrator.authorizeAndSubmit(record);
    set({
      busy: null,
      record: next,
      activity: remember(get().activity, next),
    });
  },

  track: async () => {
    if (tracking) {
      return;
    }
    const current = get().record;
    if (!current?.submission?.acceptedForBroadcast) {
      return;
    }
    const reference = current.submission.reference;
    tracking = true;
    try {
      set({ busy: "Checking confirmation" });
      // One status fetch so confirmation and detection cannot diverge across two round-trips.
      if (backend.getChainStatus) {
        const status = await backend.getChainStatus(reference);
        if (!status) {
          const unavailable = await orchestrator.confirm({
            ...current,
            confirmation: null,
          });
          set({
            record: unavailable,
            activity: remember(get().activity, unavailable),
          });
          return;
        }
        const txid =
          status.txid ||
          current.submission?.txids?.[0] ||
          current.submission?.reference ||
          reference;
        const minedHeight =
          typeof status.minedHeight === "number" ? status.minedHeight : null;
        const blockHash =
          typeof status.blockHash === "string" ? status.blockHash : null;
        const confirmations =
          typeof status.confirmations === "number"
            ? status.confirmations
            : null;
        const explorerTx =
          status.explorer?.transaction ||
          (txid
            ? `https://testnet.zcashblockexplorer.com/transactions/${txid}`
            : null);
        const explorerBlock =
          status.explorer?.block ||
          (blockHash
            ? `https://testnet.zcashblockexplorer.com/blocks/${blockHash}`
            : minedHeight != null
              ? `https://testnet.zcashblockexplorer.com/blocks/${minedHeight}`
              : null);
        const next = {
          ...current,
          confirmation: {
            ...status.confirmation,
            minedHeight,
            blockHash,
            confirmations,
          },
          detection: status.detection,
          chain:
            explorerTx && txid
              ? {
                  txid,
                  minedHeight,
                  blockHash,
                  confirmations,
                  explorer: {
                    transaction: explorerTx,
                    block: explorerBlock,
                  },
                }
              : current.chain,
        };
        set({ record: next, activity: remember(get().activity, next) });
        return;
      }
      const confirmed = await orchestrator.confirm({
        ...current,
        confirmation:
          current.confirmation?.source === "unavailable"
            ? null
            : current.confirmation,
        detection:
          current.detection?.source === "unavailable"
            ? null
            : current.detection,
      });
      set({ record: confirmed, activity: remember(get().activity, confirmed) });
      if (confirmed.confirmation?.source === "unavailable") {
        return;
      }
      if (confirmed.detection?.detected) {
        return;
      }
      set({ busy: "Checking recipient detection" });
      const detected = await orchestrator.detect(confirmed);
      set({ record: detected, activity: remember(get().activity, detected) });
    } finally {
      tracking = false;
      set({ busy: null });
    }
  },
}));

// Only explicit opt-in writes payment metadata; keys and viewing keys never enter receipts.
usePaymentStore.subscribe((state) => {
  if (state.keepTracking && state.busy !== "Submitting")
    saveTracking(state.activity);
});
