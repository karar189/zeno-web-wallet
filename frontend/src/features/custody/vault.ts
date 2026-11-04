import { parseMnemonic } from "@/features/custody/mnemonic";

export const VAULT_STORAGE_KEY = "emperor.wallet.vault.v1";
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

export type StoredVault = {
  version: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
};

export type VaultStorage = {
  get(): string | null;
  set(value: string): void;
  remove(): void;
};

const VAULT_CHANGE_EVENT = "emperor-wallet-vault";

export function browserVaultStorage(): VaultStorage {
  return {
    get: () => localStorage.getItem(VAULT_STORAGE_KEY),
    set: (value) => {
      localStorage.setItem(VAULT_STORAGE_KEY, value);
      window.dispatchEvent(new Event(VAULT_CHANGE_EVENT));
    },
    remove: () => {
      localStorage.removeItem(VAULT_STORAGE_KEY);
      window.dispatchEvent(new Event(VAULT_CHANGE_EVENT));
    },
  };
}

export function subscribeVault(onChange: () => void): () => void {
  window.addEventListener(VAULT_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(VAULT_CHANGE_EVENT, onChange);
}

export function readVaultRaw(): string | null {
  return localStorage.getItem(VAULT_STORAGE_KEY);
}

export function memoryVaultStorage(): VaultStorage {
  let value: string | null = null;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
    remove: () => {
      value = null;
    },
  };
}

export async function encryptSeed(
  mnemonic: string,
  password: string,
  options?: { iterations?: number; createdAt?: string },
): Promise<StoredVault> {
  const parsed = parseMnemonic(mnemonic);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  assertPassword(password);

  const iterations = options?.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(parsed.mnemonic),
  );

  return {
    version: 1,
    kdf: "PBKDF2-SHA-256",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt: options?.createdAt ?? new Date().toISOString(),
  };
}

export async function decryptSeed(vault: StoredVault, password: string): Promise<string> {
  assertVault(vault);
  const key = await deriveKey(password, base64ToBytes(vault.salt), vault.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(base64ToBytes(vault.iv)) },
      key,
      bufferSource(base64ToBytes(vault.ciphertext)),
    );
  } catch {
    throw new Error("Password did not unlock this wallet.");
  }

  const parsed = parseMnemonic(new TextDecoder().decode(plain));
  if (!parsed.ok) {
    throw new Error("The saved wallet could not be read.");
  }
  return parsed.mnemonic;
}

export function readVault(storage: VaultStorage): StoredVault | null {
  const raw = storage.get();
  if (raw === null || raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The saved wallet file is unreadable.");
  }
  assertVault(parsed);
  return parsed;
}

export function writeVault(storage: VaultStorage, vault: StoredVault): void {
  assertVault(vault);
  storage.set(JSON.stringify(vault));
}

export function clearVault(storage: VaultStorage): void {
  storage.remove();
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Use a password of at least 8 characters.");
  }
}

function assertVault(value: unknown): asserts value is StoredVault {
  if (typeof value !== "object" || value === null) {
    throw new Error("The saved wallet file is unreadable.");
  }
  const vault = value as Partial<StoredVault>;
  if (vault.version !== 1 || vault.kdf !== "PBKDF2-SHA-256") {
    throw new Error("This browser has a wallet file this version cannot open.");
  }
  if (
    typeof vault.iterations !== "number" ||
    typeof vault.salt !== "string" ||
    typeof vault.iv !== "string" ||
    typeof vault.ciphertext !== "string" ||
    typeof vault.createdAt !== "string"
  ) {
    throw new Error("The saved wallet file is unreadable.");
  }
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bufferSource(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
