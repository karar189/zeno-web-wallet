import { walletServiceUrl } from "@/features/faucet/client";

/**
 * How the local wallet service reaches lightwalletd and the faucet.
 * `mixnet`: through a SOCKS5 proxy on this machine (nym-socks5-client) that is listening.
 * `proxy-down`: a proxy is configured but nothing listens on its port, so wallet traffic fails closed.
 * `direct`: plain connections; lightwalletd sees this machine's IP address.
 * `unknown`: simulated backend, or the wallet service did not answer.
 */
export type TransportStatus =
  | { kind: "mixnet"; name: string; proxy: string }
  | { kind: "proxy-down"; name: string; proxy: string }
  | { kind: "direct" }
  | { kind: "unknown" };

type NetworkReply = {
  transport?: unknown;
  name?: unknown;
  proxy?: unknown;
  proxyListening?: unknown;
};

export function parseTransport(reply: NetworkReply): TransportStatus {
  if (reply.transport === "direct") return { kind: "direct" };
  if (
    reply.transport === "socks5" &&
    typeof reply.name === "string" &&
    typeof reply.proxy === "string"
  ) {
    return reply.proxyListening === true
      ? { kind: "mixnet", name: reply.name, proxy: reply.proxy }
      : { kind: "proxy-down", name: reply.name, proxy: reply.proxy };
  }
  return { kind: "unknown" };
}

export async function fetchTransport(): Promise<TransportStatus> {
  if (process.env.NEXT_PUBLIC_WALLET_BACKEND !== "live") return { kind: "unknown" };
  try {
    const response = await fetch(`${walletServiceUrl()}/api/wallet/network`, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { kind: "unknown" };
    return parseTransport((await response.json()) as NetworkReply);
  } catch {
    return { kind: "unknown" };
  }
}

/** One line for the privacy review. */
export function describeTransport(status: TransportStatus): {
  title: string;
  detail: string;
} {
  switch (status.kind) {
    case "mixnet":
      return {
        title: `Network: ${status.name}`,
        detail: `The wallet service reaches lightwalletd through the ${status.name} proxy at ${status.proxy}. The lightwallet server sees the proxy's exit instead of your IP address. It still sees when you sync and the transaction bytes you broadcast. Shielding is not network anonymity on its own.`,
      };
    case "proxy-down":
      return {
        title: `Network: ${status.name} proxy not running`,
        detail: `The wallet service is set to use the ${status.name} proxy at ${status.proxy}, but nothing is listening there. Nothing is sent directly, so sync and send will fail until the proxy is started.`,
      };
    case "direct":
      return {
        title: "Network: direct connection",
        detail:
          "The local wallet service processes payment details and signs. The lightwallet server sees your IP address, when you sync, and the bytes you broadcast. Shielding is not network anonymity. Route wallet traffic through Nym in Settings to hide your IP.",
      };
    default:
      return {
        title: "Local wallet and network visibility",
        detail:
          "The local wallet service processes payment details and signs. The lightwallet server can observe connection metadata. Shielding is not network anonymity.",
      };
  }
}
