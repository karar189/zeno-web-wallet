import { readPreferredNetwork } from "@/features/network/preference";
import { authorizedHeaders } from "@/features/session/vault";
import type {
  ClaimReport,
  FaucetInfo,
  WalletAddress,
  WalletHistory,
  WalletHistoryTx,
  WalletReadiness,
} from "./types";

const TESTNET_WALLET_URL = (
  process.env.NEXT_PUBLIC_WALLET_URL ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");
const MAINNET_WALLET_URL = (
  process.env.NEXT_PUBLIC_MAINNET_WALLET_URL ?? "http://127.0.0.1:8788"
).replace(/\/$/, "");

export const WALLET_SERVICE_URL = TESTNET_WALLET_URL;

export function walletServiceUrl(): string {
  if (typeof window === "undefined") {
    return TESTNET_WALLET_URL;
  }
  return readPreferredNetwork() === "mainnet"
    ? MAINNET_WALLET_URL
    : TESTNET_WALLET_URL;
}

export class WalletServiceError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly report: ClaimReport | null;
  readonly ambiguous: boolean;

  constructor(input: {
    code: string;
    message: string;
    status?: number | null;
    report?: ClaimReport | null;
    ambiguous?: boolean;
  }) {
    super(input.message);
    this.name = "WalletServiceError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.report = input.report ?? null;
    this.ambiguous = input.ambiguous === true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClaimReport(value: unknown): value is ClaimReport {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    typeof value.state === "string" &&
    typeof value.note === "string"
  );
}

function browserMessage(error: unknown, timeoutMessage: string): string {
  if ((error as { name?: string } | null)?.name === "AbortError") {
    return timeoutMessage;
  }
  return "The wallet service is not reachable at its configured local address.";
}

async function request(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = await authorizedHeaders(init.headers);
    return await fetch(`${walletServiceUrl()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new WalletServiceError({
      code: "wallet_service_unreachable",
      message: browserMessage(
        error,
        "The wallet service did not answer before the browser timed out.",
      ),
      status: null,
      ambiguous: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function messageFromBody(body: unknown, response: Response): string {
  if (isRecord(body)) {
    if (typeof body.note === "string" && body.note.length > 0) {
      return body.note;
    }
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
    if (isRecord(body.error) && typeof body.error.message === "string") {
      return body.error.message;
    }
  }
  return `The wallet service answered with HTTP ${response.status}.`;
}

function claimFromResponse(
  body: unknown,
  response: Response,
  expectedRequestId?: string,
): ClaimReport {
  if (!isClaimReport(body)) {
    throw new WalletServiceError({
      code: "faucet_invalid_response",
      message: `The wallet service returned HTTP ${response.status} without a claim record that the browser can verify.`,
      status: response.status,
      ambiguous: true,
    });
  }
  if (
    expectedRequestId !== undefined &&
    body.requestId.toLowerCase() !== expectedRequestId.toLowerCase()
  ) {
    throw new WalletServiceError({
      code: "faucet_invalid_response",
      message:
        "The wallet service returned a claim for a different request id. The browser ignored it.",
      status: response.status,
      ambiguous: true,
    });
  }
  return body;
}

export async function getWalletReadiness(): Promise<WalletReadiness> {
  const response = await request("/api/wallet/readiness", { method: "GET" }, 15000);
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new WalletServiceError({
      code: "readiness_unavailable",
      message: messageFromBody(body, response),
      status: response.status,
      ambiguous: false,
    });
  }
  return body as WalletReadiness;
}

export async function getWalletAddress(): Promise<WalletAddress> {
  const response = await request("/api/wallet/address", { method: "GET" }, 15000);
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new WalletServiceError({
      code: "address_unavailable",
      message: messageFromBody(body, response),
      status: response.status,
      ambiguous: false,
    });
  }
  return body as WalletAddress;
}

function parseHistoryTx(value: unknown): WalletHistoryTx | null {
  if (!isRecord(value) || typeof value.txid !== "string") {
    return null;
  }
  if (
    typeof value.accountBalanceDeltaZatoshis !== "string" ||
    typeof value.totalReceivedZatoshis !== "string" ||
    typeof value.totalSpentZatoshis !== "string" ||
    typeof value.kind !== "string"
  ) {
    return null;
  }
  return {
    txid: value.txid,
    minedHeight:
      typeof value.minedHeight === "number" && Number.isFinite(value.minedHeight)
        ? value.minedHeight
        : null,
    accountBalanceDeltaZatoshis: value.accountBalanceDeltaZatoshis,
    totalReceivedZatoshis: value.totalReceivedZatoshis,
    totalSpentZatoshis: value.totalSpentZatoshis,
    feePaidZatoshis:
      typeof value.feePaidZatoshis === "string" ? value.feePaidZatoshis : null,
    kind: value.kind,
    receivedNoteCount:
      typeof value.receivedNoteCount === "number" ? value.receivedNoteCount : 0,
    sentNoteCount: typeof value.sentNoteCount === "number" ? value.sentNoteCount : 0,
  };
}

export async function getWalletHistory(): Promise<WalletHistory> {
  const response = await request("/api/wallet/history", { method: "GET" }, 15000);
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new WalletServiceError({
      code: "history_unavailable",
      message: messageFromBody(body, response),
      status: response.status,
      ambiguous: false,
    });
  }
  const transactions = Array.isArray(body.transactions)
    ? body.transactions
        .map(parseHistoryTx)
        .filter((row): row is WalletHistoryTx => row !== null)
    : [];
  return {
    network: typeof body.network === "string" ? body.network : "test",
    transactions,
  };
}

export async function getFaucetInfo(): Promise<FaucetInfo> {
  const response = await request("/api/wallet/faucet/info", { method: "GET" }, 30000);
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new WalletServiceError({
      code: "faucet_info_unavailable",
      message: messageFromBody(body, response),
      status: response.status,
      ambiguous: false,
    });
  }
  return body as FaucetInfo;
}

const SCAN_PASSES = 6;
let scanInFlight: Promise<WalletReadiness> | null = null;

export function walletNeedsScan(readiness: WalletReadiness): boolean {
  return readiness.sync !== "synced";
}

export function catchUpWallet(): Promise<WalletReadiness> {
  if (!scanInFlight) {
    scanInFlight = scanUntilCurrent().finally(() => {
      scanInFlight = null;
    });
  }
  return scanInFlight;
}

function syncStopped(readiness: WalletReadiness): boolean {
  return typeof readiness.blocker === "string" && readiness.blocker.startsWith("Sync stopped");
}

async function scanUntilCurrent(): Promise<WalletReadiness> {
  let readiness = await getWalletReadiness();
  // Always run at least one pass. "synced" means within 10 blocks of the tip, so a payment
  // mined in those blocks would otherwise never be fetched until the wallet fell further behind.
  for (let pass = 0; pass < SCAN_PASSES && (pass === 0 || walletNeedsScan(readiness)); pass += 1) {
    if (syncStopped(readiness)) {
      break;
    }
    try {
      readiness = await syncWallet();
    } catch (error) {
      const latest = await getWalletReadiness().catch(() => null);
      if (latest && !walletNeedsScan(latest)) {
        return latest;
      }
      if (latest) {
        readiness = latest;
      }
      if (pass === SCAN_PASSES - 1 || !latest) {
        throw error;
      }
    }
    if (syncStopped(readiness)) {
      break;
    }
  }
  return readiness;
}

export async function syncWallet(): Promise<WalletReadiness> {
  const response = await request(
    "/api/wallet/sync",
    { method: "POST" },
    600000,
  );
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new WalletServiceError({
      code: "sync_failed",
      message: messageFromBody(body, response),
      status: response.status,
      ambiguous: false,
    });
  }
  return body as WalletReadiness;
}

export async function syncAndRead(): Promise<{
  readiness: WalletReadiness;
  synced: boolean;
  syncError: string | null;
}> {
  try {
    const readiness = await catchUpWallet();
    return {
      readiness,
      synced: !walletNeedsScan(readiness),
      syncError: walletNeedsScan(readiness)
        ? readiness.blocker || "The wallet is still behind the testnet tip."
        : null,
    };
  } catch (error) {
    const readiness = await getWalletReadiness().catch(() => null);
    return {
      readiness:
        readiness ??
        ({
          network: "testnet",
          sync: "unknown",
          detectedZatoshis: null,
          spendableZatoshis: null,
          canSubmit: false,
          blocker: error instanceof Error ? error.message : "The wallet sync did not finish.",
          note: error instanceof Error ? error.message : "The wallet sync did not finish.",
        } satisfies WalletReadiness),
      synced: false,
      syncError:
        error instanceof Error
          ? error.message
          : "The wallet sync did not finish.",
    };
  }
}

export async function submitFaucetClaim(requestId: string): Promise<ClaimReport> {
  const response = await request(
    "/api/wallet/faucet/claim",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    },
    45000,
  );
  const body = await readBody(response);
  if (response.ok || response.status === 202) {
    return claimFromResponse(body, response, requestId);
  }
  if (isClaimReport(body)) {
    const report = claimFromResponse(body, response, requestId);
    throw new WalletServiceError({
      code: report.error?.code ?? "claim_failed",
      message: report.error?.message ?? report.note,
      status: response.status,
      report,
      ambiguous: report.ambiguous || response.status >= 500,
    });
  }
  throw new WalletServiceError({
    code: response.status >= 500 ? "faucet_unreachable" : "claim_rejected",
    message: messageFromBody(body, response),
    status: response.status,
    ambiguous: response.status >= 500,
  });
}

export async function getFaucetClaimStatus(
  requestId: string,
): Promise<ClaimReport> {
  const response = await request(
    `/api/wallet/faucet/status/${encodeURIComponent(requestId)}`,
    { method: "GET" },
    30000,
  );
  const body = await readBody(response);
  if (response.ok || response.status === 202) {
    return claimFromResponse(body, response, requestId);
  }
  if (isClaimReport(body)) {
    const report = claimFromResponse(body, response, requestId);
    throw new WalletServiceError({
      code: report.error?.code ?? "status_failed",
      message: report.error?.message ?? report.note,
      status: response.status,
      report,
      ambiguous: report.ambiguous || response.status >= 500,
    });
  }
  throw new WalletServiceError({
    code: response.status >= 500 ? "faucet_unreachable" : "status_rejected",
    message: messageFromBody(body, response),
    status: response.status,
    ambiguous: response.status >= 500,
  });
}

export type ShieldQuote = {
  quoteId: string | null;
  recipient: string | null;
  amountZatoshis: string | null;
  feeZatoshis: string | null;
  expiresAtMs: number | null;
  note: string;
};

export type ShieldSendResult = {
  outcome?: string;
  message?: string;
  evidence?: { reference?: string };
  txids?: string[];
};

export async function quoteShieldFunds(): Promise<ShieldQuote> {
  const response = await request(
    "/api/wallet/shield/quote",
    { method: "POST" },
    120000,
  );
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new WalletServiceError({
      code: "shield_quote_failed",
      message: messageFromBody(body, response),
      status: response.status,
      ambiguous: false,
    });
  }
  const asZatoshiString = (value: unknown): string | null => {
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return value;
    }
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      return String(value);
    }
    return null;
  };
  return {
    quoteId: typeof body.quoteId === "string" ? body.quoteId : null,
    recipient: typeof body.recipient === "string" ? body.recipient : null,
    amountZatoshis: asZatoshiString(body.amountZatoshis),
    feeZatoshis: asZatoshiString(body.feeZatoshis),
    expiresAtMs: typeof body.expiresAtMs === "number" ? body.expiresAtMs : null,
    note: typeof body.note === "string" ? body.note : "Shield quote unavailable.",
  };
}

export async function sendShieldFunds(input: {
  quoteId: string;
  recipient: string;
  amountZatoshis: string;
  feeZatoshis: string;
}): Promise<ShieldSendResult> {
  const response = await request(
    "/api/wallet/shield/send",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteId: input.quoteId,
        approved: true,
        recipient: input.recipient,
        amountZatoshis: input.amountZatoshis,
        feeZatoshis: input.feeZatoshis,
      }),
    },
    600000,
  );
  const body = await readBody(response);
  if (!response.ok || !isRecord(body)) {
    throw new WalletServiceError({
      code: "shield_send_failed",
      message: messageFromBody(body, response),
      status: response.status,
      ambiguous: response.status >= 500,
    });
  }
  return body as ShieldSendResult;
}
