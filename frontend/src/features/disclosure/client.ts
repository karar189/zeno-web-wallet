import { walletServiceUrl } from "@/features/faucet/client";
import { authorizedHeaders } from "@/features/session/vault";
import type {
  DisclosureExportRequest,
  DisclosureKey,
  DisclosureStatus,
} from "./types";

const TIMEOUT_MS = 30_000;

export class DisclosureServiceError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "DisclosureServiceError";
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
    throw new DisclosureServiceError(
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
    throw new DisclosureServiceError(
      messageFrom(body, response.status),
      response.status,
    );
  }
  if (body === null) {
    throw new DisclosureServiceError(
      "The wallet service returned an empty disclosure response.",
      response.status,
    );
  }
  return body as T;
}

export async function getDisclosureStatus(): Promise<DisclosureStatus> {
  return request<DisclosureStatus>("/api/wallet/disclosure", { method: "GET" });
}

export async function createDisclosureAccount(): Promise<DisclosureStatus> {
  return request<DisclosureStatus>("/api/wallet/disclosure/account", {
    method: "POST",
    body: JSON.stringify({ approved: true }),
  });
}

export async function requestDisclosureExport(): Promise<DisclosureExportRequest> {
  return request<DisclosureExportRequest>(
    "/api/wallet/disclosure/export/request",
    {
      method: "POST",
      body: JSON.stringify({ approved: true }),
    },
  );
}

export async function exportDisclosureKey(
  exportId: string,
): Promise<DisclosureKey> {
  return request<DisclosureKey>("/api/wallet/disclosure/export", {
    method: "POST",
    body: JSON.stringify({ exportId, approved: true }),
  });
}
