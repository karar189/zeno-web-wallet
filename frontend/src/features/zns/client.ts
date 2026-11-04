import type { Network } from "@/features/payments/types";
import type { ZnsResolveResult } from "@/features/zns/types";

export type ResolvedZcashName = Extract<
  ZnsResolveResult,
  { ok: true; found: true }
>;

export async function resolveZcashNameClient(input: {
  query: string;
  network?: Network;
  signal?: AbortSignal;
}): Promise<ZnsResolveResult> {
  const params = new URLSearchParams({
    name: input.query.trim(),
    network: input.network ?? "testnet",
  });
  const response = await fetch(`/api/names/resolve?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal: input.signal,
  });
  const payload = (await response.json()) as ZnsResolveResult | { message?: string };
  if (!response.ok) {
    return {
      ok: false,
      reason:
        "message" in payload && typeof payload.message === "string"
          ? payload.message
          : "Name lookup failed.",
    };
  }
  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    return { ok: false, reason: "Name lookup returned an unexpected response." };
  }
  return payload as ZnsResolveResult;
}
