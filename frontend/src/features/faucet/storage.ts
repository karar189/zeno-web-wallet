import type {
  ClaimReport,
  FaucetError,
  StoredClaim,
} from "./types";

const STORAGE_KEY = "emperor.faucet.claim.v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeError(value: unknown): FaucetError | null {
  if (!isRecord(value) || typeof value.code !== "string") {
    return null;
  }
  return {
    code: value.code,
    message:
      typeof value.message === "string"
        ? value.message
        : "The faucet returned an error without a message.",
    retryable: value.retryable === true,
    ...(typeof value.nextEligibleAtMs === "number" &&
    Number.isFinite(value.nextEligibleAtMs) &&
    value.nextEligibleAtMs > 0
      ? { nextEligibleAtMs: value.nextEligibleAtMs }
      : {}),
  };
}

function sanitizeReport(
  value: unknown,
  requestId: string,
): ClaimReport | null {
  if (!isRecord(value) || value.requestId !== requestId) {
    return null;
  }
  if (typeof value.state !== "string" || typeof value.note !== "string") {
    return null;
  }
  const amountZat =
    typeof value.amountZat === "number" &&
    Number.isSafeInteger(value.amountZat) &&
    value.amountZat >= 0
      ? value.amountZat
      : null;
  return {
    requestId,
    network: typeof value.network === "string" ? value.network : "testnet",
    state: value.state,
    outcome: optionalString(value.outcome),
    txid: optionalString(value.txid),
    amountZat,
    nextEligibleAtMs:
      typeof value.nextEligibleAtMs === "number" &&
      Number.isFinite(value.nextEligibleAtMs) &&
      value.nextEligibleAtMs > 0
        ? value.nextEligibleAtMs
        : null,
    confirmedHeight:
      typeof value.confirmedHeight === "number" &&
      Number.isSafeInteger(value.confirmedHeight)
        ? value.confirmedHeight
        : null,
    address: optionalString(value.address),
    addressKind: optionalString(value.addressKind),
    privacyPolicy: optionalString(value.privacyPolicy),
    failureReason: optionalString(value.failureReason),
    ambiguous: value.ambiguous === true,
    note: value.note,
    error: sanitizeError(value.error),
  };
}

function sanitizeWebsite(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function sanitizeStoredClaim(
  value: unknown,
  expectedAddress?: string | null,
): StoredClaim | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  const mode = value.mode === "faucet" || value.mode === "external" ? value.mode : null;
  const address = optionalString(value.address);
  const createdAtMs =
    typeof value.createdAtMs === "number" && Number.isFinite(value.createdAtMs)
      ? value.createdAtMs
      : null;
  const baselineDetectedZatoshis = optionalString(value.baselineDetectedZatoshis);
  const baselineSpendableZatoshis = optionalString(value.baselineSpendableZatoshis);
  if (
    mode === null ||
    address === null ||
    createdAtMs === null ||
    createdAtMs <= 0 ||
    baselineDetectedZatoshis === null ||
    baselineSpendableZatoshis === null ||
    !/^\d+$/.test(baselineDetectedZatoshis) ||
    !/^\d+$/.test(baselineSpendableZatoshis)
  ) {
    return null;
  }
  if (expectedAddress && address !== expectedAddress) {
    return null;
  }
  let requestId: string | null = null;
  if (mode === "faucet") {
    if (typeof value.requestId !== "string" || !UUID_PATTERN.test(value.requestId)) {
      return null;
    }
    requestId = value.requestId.toLowerCase();
  }
  const report =
    requestId === null ? null : sanitizeReport(value.report, requestId);
  const submissionError = sanitizeError(value.submissionError);
  const lastCheckedAtMs =
    typeof value.lastCheckedAtMs === "number" &&
    Number.isFinite(value.lastCheckedAtMs) &&
    value.lastCheckedAtMs > 0
      ? value.lastCheckedAtMs
      : null;
  return {
    version: 1,
    mode,
    requestId,
    address,
    createdAtMs,
    baselineDetectedZatoshis,
    baselineSpendableZatoshis,
    report,
    submissionError,
    submissionAmbiguous: value.submissionAmbiguous === true,
    lastCheckedAtMs,
    lastFaucetState: optionalString(value.lastFaucetState),
    websiteUrl: sanitizeWebsite(value.websiteUrl),
  };
}

export function readStoredClaim(
  expectedAddress?: string | null,
): StoredClaim | null {
  if (typeof window === "undefined") {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearStoredClaim();
    return null;
  }
  const claim = sanitizeStoredClaim(parsed, expectedAddress);
  if (!claim) {
    clearStoredClaim();
  }
  return claim;
}

export function writeStoredClaim(claim: StoredClaim): void {
  if (typeof window === "undefined") {
    throw new Error("The claim record can only be saved in the browser.");
  }
  const sanitized = sanitizeStoredClaim(claim, claim.address);
  if (!sanitized) {
    throw new Error("The claim record is incomplete and was not saved.");
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
}

export function clearStoredClaim(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A stale record can be cleared again later; never throw from cleanup.
  }
}

export function newClaimRequestId(): string {
  return globalThis.crypto.randomUUID().toLowerCase();
}
