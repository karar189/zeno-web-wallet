import { readPreferredNetwork, type PreferredNetwork } from "@/features/network/preference";

export type StoredVault = {
  walletId: string;
  kdfSalt: string;
  ciphertext: string;
  birthdayHeight: number | null;
  sessionToken: string | null;
  network?: PreferredNetwork;
};

export type VaultMeta = {
  walletId: string;
  birthdayHeight: number | null;
  hasSession: boolean;
};

const DB_NAME = "emperor-wallet";
const STORE = "vaults";

let records: StoredVault[] = [];
let activeWalletId: string | null = null;
let hydrated = false;

const ready: Promise<void> =
  typeof indexedDB === "undefined" ? Promise.resolve() : hydrateVault();

export function vaultReady(): Promise<void> {
  return ready;
}

export function peekSessionToken(): string | null {
  const visible = recordsForCurrentNetwork();
  const active = visible.find((record) => record.walletId === activeWalletId);
  if (active?.sessionToken) {
    return active.sessionToken;
  }
  return visible.find((record) => record.sessionToken)?.sessionToken ?? null;
}

export function listVaultMeta(): VaultMeta[] {
  return recordsForCurrentNetwork().map((record) => ({
    walletId: record.walletId,
    birthdayHeight: record.birthdayHeight,
    hasSession: Boolean(record.sessionToken),
  }));
}

export function vaultMaterial(walletId: string): StoredVault | null {
  const record = records.find((item) => item.walletId === walletId) ?? null;
  if (!record || vaultNetwork(record) !== readPreferredNetwork()) {
    return null;
  }
  return record;
}

export async function saveVault(vault: {
  walletId: string;
  kdfSalt: string;
  ciphertext: string;
  birthdayHeight: number | null;
}): Promise<void> {
  const next: StoredVault = {
    ...vault,
    network: readPreferredNetwork(),
    sessionToken: null,
  };
  records = [next, ...records.filter((record) => record.walletId !== vault.walletId)];
  activeWalletId = vault.walletId;
  await persist(next);
}

export async function rememberSession(walletId: string, sessionToken: string): Promise<void> {
  const network = readPreferredNetwork();
  records = records.map((record) => {
    if (record.walletId === walletId) {
      return { ...record, sessionToken, network };
    }
    if (vaultNetwork(record) === network) {
      return { ...record, sessionToken: null };
    }
    return record;
  });
  activeWalletId = walletId;
  const active = records.find((record) => record.walletId === walletId);
  if (active) {
    await persist(active);
  }
  await Promise.all(
    records
      .filter((record) => record.walletId !== walletId)
      .map((record) => persist(record)),
  );
}

export async function clearSessionTokens(): Promise<void> {
  records = records.map((record) => ({ ...record, sessionToken: null }));
  await Promise.all(records.map((record) => persist(record)));
}

export async function authorizedHeaders(init?: HeadersInit): Promise<Headers> {
  await ready;
  const headers = new Headers(init);
  const token = peekSessionToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function hydrateVault(): Promise<void> {
  if (hydrated || typeof indexedDB === "undefined") {
    hydrated = true;
    return;
  }
  const db = await openDb();
  records = await readAll(db);
  db.close();
  const visible = recordsForCurrentNetwork();
  activeWalletId =
    visible.find((record) => record.sessionToken)?.walletId ??
    visible[0]?.walletId ??
    null;
  hydrated = true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "walletId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The browser wallet store did not open."));
  });
}

function readAll(db: IDBDatabase): Promise<StoredVault[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () => {
      const value = request.result;
      resolve(Array.isArray(value) ? value.filter(isStoredVault) : []);
    };
    request.onerror = () => reject(request.error ?? new Error("The browser wallet store could not be read."));
  });
}

function persist(record: StoredVault): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve();
  }
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(record);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("The browser wallet store could not be saved."));
        };
      }),
  );
}

function isStoredVault(value: unknown): value is StoredVault {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<StoredVault>;
  return (
    typeof record.walletId === "string" &&
    typeof record.kdfSalt === "string" &&
    typeof record.ciphertext === "string" &&
    (record.birthdayHeight === null || typeof record.birthdayHeight === "number") &&
    (record.sessionToken === null || typeof record.sessionToken === "string") &&
    (record.network === undefined ||
      record.network === "testnet" ||
      record.network === "mainnet")
  );
}

function vaultNetwork(record: StoredVault): PreferredNetwork {
  return record.network === "mainnet" ? "mainnet" : "testnet";
}

function recordsForCurrentNetwork(): StoredVault[] {
  const network = readPreferredNetwork();
  return records.filter((record) => vaultNetwork(record) === network);
}
