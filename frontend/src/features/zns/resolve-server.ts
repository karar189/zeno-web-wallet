import { ZNS } from "zcashname-sdk";
import type { Network } from "@/features/payments/types";
import { formatZcashName, parseZcashNameInput } from "@/features/zns/parse";
import type { ZnsResolveResult } from "@/features/zns/types";

export type { ZnsResolveResult };

type Registration = NonNullable<Awaited<ReturnType<ZNS["resolveName"]>>>;

function resolverUrl(network: Network): string | undefined {
  if (network === "mainnet") {
    return process.env.ZNS_MAINNET_URL?.trim() || undefined;
  }
  return process.env.ZNS_TESTNET_URL?.trim() || undefined;
}

export function createZnsClient(network: Network): ZNS {
  const url = resolverUrl(network);
  return new ZNS({
    network,
    ...(url ? { url } : {}),
    timeout: 8_000,
  });
}

export function parseResolveNetwork(raw: string | null): Network | null {
  if (raw === null || raw === "" || raw === "testnet") {
    return "testnet";
  }
  if (raw === "mainnet") {
    return "mainnet";
  }
  return null;
}

export async function resolveZcashName(input: {
  query: string;
  network: Network;
  signal?: AbortSignal;
}): Promise<ZnsResolveResult> {
  const parsed = parseZcashNameInput(input.query);
  const name =
    parsed?.name ??
    input.query
      .trim()
      .toLowerCase()
      .replace(/\.(zcash|zec)$/i, "");

  if (!parsed && !/^[a-z0-9]{1,63}$/.test(name)) {
    return {
      ok: false,
      reason:
        "Enter a Zcash name like alice.zcash (letters and digits, 1–63 characters).",
    };
  }

  const display = parsed?.display ?? formatZcashName(name);
  const client = createZnsClient(input.network);

  let registration: Registration | null;
  try {
    registration = await client.resolveName(name, input.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    return {
      ok: false,
      reason:
        error instanceof Error
          ? error.message
          : "The Zcash Names indexer did not respond.",
    };
  }

  if (!registration) {
    return {
      ok: true,
      found: false,
      name,
      display,
      network: input.network,
    };
  }

  return {
    ok: true,
    found: true,
    name: registration.name,
    display: formatZcashName(registration.name),
    address: registration.address,
    txid: registration.txid,
    height: registration.height,
    lastAction: registration.lastAction,
    expiresAt: registration.expiresAt,
    network: input.network,
  };
}
