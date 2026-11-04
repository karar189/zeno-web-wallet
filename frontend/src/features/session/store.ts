import { getWalletSession, lockWallet } from "./client";
import type { WalletSession } from "./types";
import {
  clearSessionTokens,
  listVaultMeta,
  rememberSession,
  vaultReady,
  type VaultMeta,
} from "./vault";

export type SessionView =
  | { status: "loading" }
  | { status: "unreachable" }
  | { status: "ready"; session: WalletSession; vaults: VaultMeta[] };

const serverView: SessionView = { status: "loading" };
let view: SessionView = serverView;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function publish(next: SessionView) {
  view = next;
  emit();
}

export function subscribeWalletSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWalletSessionSnapshot(): SessionView {
  return view;
}

export function getWalletSessionServerSnapshot(): SessionView {
  return serverView;
}

export async function refreshWalletSession(): Promise<void> {
  try {
    await vaultReady();
    const session = await getWalletSession();
    publish({ status: "ready", session, vaults: listVaultMeta() });
  } catch {
    publish({ status: "unreachable" });
  }
}

export async function logoutLiveWallet(): Promise<void> {
  await lockWallet();
  await clearSessionTokens();
  const previous = view.status === "ready" ? view.session : null;
  publish({
    status: "ready",
    session: {
      locked: true,
      hasWallet: listVaultMeta().length > 0,
      hasPassword: true,
      legacyUnclaimed: previous?.legacyUnclaimed ?? false,
    },
    vaults: listVaultMeta(),
  });
}

export async function markWalletUnlocked(walletId: string, sessionToken: string) {
  await rememberSession(walletId, sessionToken);
  const previous = view.status === "ready" ? view.session : null;
  publish({
    status: "ready",
    session: {
      locked: false,
      hasWallet: true,
      hasPassword: true,
      legacyUnclaimed: previous?.legacyUnclaimed ?? false,
    },
    vaults: listVaultMeta(),
  });
}
