import { walletServiceUrl } from "@/features/faucet/client";
import { authorizedHeaders } from "./vault";
import type { NewWalletStart, SessionGrant, VaultPayload, WalletSession } from "./types";

const TIMEOUT_MS = 30_000;

export class WalletSessionError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "WalletSessionError";
    this.status = status;
  }
}

function messageFrom(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return `The wallet service answered with HTTP ${status}.`;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    const headers = await authorizedHeaders(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    response = await fetch(`${walletServiceUrl()}${path}`, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers,
      signal: controller.signal,
    });
  } catch (caught) {
    throw new WalletSessionError(
      (caught as { name?: string } | null)?.name === "AbortError"
        ? "The wallet service did not answer before the browser timed out."
        : "The wallet service is not reachable at its configured local address.",
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new WalletSessionError(messageFrom(body, response.status), response.status);
  }
  if (body === null || typeof body !== "object") {
    throw new WalletSessionError(
      "The wallet service returned an empty session response.",
      response.status,
    );
  }
  return body as T;
}

function asSession(body: WalletSession): WalletSession {
  return {
    locked: body.locked === true,
    hasWallet: body.hasWallet === true,
    hasPassword: body.hasPassword === true,
    legacyUnclaimed: body.legacyUnclaimed === true,
  };
}

function asVault(body: VaultPayload): VaultPayload {
  if (typeof body.walletId !== "string" || typeof body.kdfSalt !== "string" || typeof body.ciphertext !== "string") {
    throw new WalletSessionError("The wallet service did not return an encrypted wallet.");
  }
  return {
    walletId: body.walletId,
    kdfSalt: body.kdfSalt,
    ciphertext: body.ciphertext,
    birthdayHeight: typeof body.birthdayHeight === "number" ? body.birthdayHeight : null,
  };
}

export async function getWalletSession(): Promise<WalletSession> {
  return asSession(await request<WalletSession>("/api/wallet/session", { method: "GET" }));
}

export async function setWalletPassword(password: string): Promise<void> {
  await request("/api/wallet/session/password", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function unlockWallet(input: {
  password: string;
  walletId: string;
  kdfSalt: string;
  ciphertext: string;
}): Promise<string> {
  const body = await request<SessionGrant>("/api/wallet/session/unlock", {
    method: "POST",
    body: JSON.stringify({
      password: input.password,
      walletId: input.walletId,
      kdfSalt: input.kdfSalt,
      ciphertext: input.ciphertext,
    }),
  });
  if (typeof body.sessionToken !== "string" || body.sessionToken.length === 0) {
    throw new WalletSessionError("The wallet service did not open a session.");
  }
  return body.sessionToken;
}

export async function lockWallet(): Promise<void> {
  await request("/api/wallet/session/lock", { method: "POST" });
}

export async function beginNewWallet(password: string): Promise<NewWalletStart> {
  const body = await request<NewWalletStart>("/api/wallet/wallets", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (typeof body.createId !== "string" || typeof body.phrase !== "string") {
    throw new WalletSessionError("The wallet service did not return a new seed.");
  }
  return {
    createId: body.createId,
    phrase: body.phrase,
    expiresAtMs: body.expiresAtMs,
  };
}

export async function confirmNewWallet(createId: string): Promise<VaultPayload> {
  return asVault(
    await request<VaultPayload>("/api/wallet/wallets/confirm", {
      method: "POST",
      body: JSON.stringify({ createId }),
    }),
  );
}

export async function acknowledgeNewWallet(createId: string): Promise<string> {
  const body = await request<SessionGrant>("/api/wallet/wallets/ack", {
    method: "POST",
    body: JSON.stringify({ createId }),
  });
  if (typeof body.sessionToken !== "string" || body.sessionToken.length === 0) {
    throw new WalletSessionError("The wallet service did not open a session.");
  }
  return body.sessionToken;
}

export async function beginClaim(password: string): Promise<NewWalletStart> {
  const body = await request<NewWalletStart & { claimId?: string }>("/api/wallet/wallets/claim", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const createId = body.claimId ?? body.createId;
  if (typeof createId !== "string" || typeof body.phrase !== "string") {
    throw new WalletSessionError("The wallet service did not return the existing seed.");
  }
  return {
    createId,
    phrase: body.phrase,
    expiresAtMs: body.expiresAtMs,
  };
}

export async function confirmClaim(claimId: string): Promise<VaultPayload> {
  return asVault(
    await request<VaultPayload>("/api/wallet/wallets/claim/confirm", {
      method: "POST",
      body: JSON.stringify({ claimId }),
    }),
  );
}

export async function acknowledgeClaim(claimId: string): Promise<string> {
  const body = await request<SessionGrant>("/api/wallet/wallets/claim/ack", {
    method: "POST",
    body: JSON.stringify({ claimId }),
  });
  if (typeof body.sessionToken !== "string" || body.sessionToken.length === 0) {
    throw new WalletSessionError("The wallet service did not open a session.");
  }
  return body.sessionToken;
}

export async function cancelNewWallet(createId: string): Promise<void> {
  await request("/api/wallet/wallets/cancel", {
    method: "POST",
    body: JSON.stringify({ createId }),
  });
}
