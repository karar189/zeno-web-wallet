import { parseZecToZatoshis } from "@/features/payments/amount";
export type PreviewInput = {
  amount: string;
  chain: "base" | "sol";
  recipient: string;
  refundTo: string;
  consent: boolean;
};
export type RoutePreview = {
  source: "live";
  amountIn: string;
  amountOut: string;
  minimumOut: string;
  chain: string;
  estimatedSeconds: number | null;
  fetchedAt: string;
  validUntil: string;
  slippageBps: number;
};
export function validatePreview(input: unknown): PreviewInput {
  if (!input || typeof input !== "object")
    throw new Error("Enter the quote details.");
  const v = input as Record<string, unknown>;
  if (
    typeof v.amount !== "string" ||
    v.amount.length > 24 ||
    !parseZecToZatoshis(v.amount).ok
  )
    throw new Error("Enter a positive ZEC amount with at most 8 decimals.");
  if (v.chain !== "base" && v.chain !== "sol")
    throw new Error("Choose Base or Solana.");
  if (
    typeof v.recipient !== "string" ||
    !(
      v.chain === "base"
        ? /^0x[0-9a-fA-F]{40}$/
        : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    ).test(v.recipient)
  )
    throw new Error(
      "Enter a destination address in the selected chain's format.",
    );
  if (
    typeof v.refundTo !== "string" ||
    !/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(v.refundTo)
  )
    throw new Error(
      "Enter a transparent mainnet Zcash refund address (t1 or t3). Testnet funds cannot be swapped.",
    );
  if (v.consent !== true)
    throw new Error("Approve sharing quote details with 1Click first.");
  return {
    amount: v.amount,
    chain: v.chain,
    recipient: v.recipient,
    refundTo: v.refundTo,
    consent: true,
  };
}
export type Token = {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
};
export function selectPair(tokens: Token[], chain: string) {
  const origin = tokens.find(
    (t) => t.blockchain === "zec" && t.symbol === "ZEC" && t.decimals === 8,
  );
  const destination = tokens.find(
    (t) => t.blockchain === chain && t.symbol === "USDC",
  );
  if (!origin || !destination)
    throw new Error(
      "This ZEC / USDC pair is not currently available from 1Click.",
    );
  return { origin, destination };
}
export function formatUnits(raw: string, decimals: number): string {
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 30
  )
    throw new Error("Provider returned an invalid amount.");
  if (!decimals) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`.replace(
    /\.?0+$/,
    "",
  );
}
export async function fetchPreview(
  input: PreviewInput,
  fetcher: typeof fetch = fetch,
): Promise<RoutePreview> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.NEAR_INTENTS_API_KEY)
    headers["X-API-Key"] = process.env.NEAR_INTENTS_API_KEY;
  const call = async (path: string, body?: object) => {
    const response = await fetcher(
      `https://1click.chaindefuser.com/v0/${path}`,
      {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "1Click is rate limiting quotes. Wait and try again."
          : "1Click could not quote this request. Check the addresses, amount, and pair, then try again.",
      );
    return response.json();
  };
  const rawTokens: unknown = await call("tokens");
  if (!Array.isArray(rawTokens))
    throw new Error("1Click returned an unreadable asset list.");
  const tokens = rawTokens.filter(
    (t): t is Token =>
      t &&
      typeof t.assetId === "string" &&
      typeof t.blockchain === "string" &&
      typeof t.symbol === "string" &&
      Number.isInteger(t.decimals),
  );
  const pair = selectPair(tokens, input.chain);
  const amount = parseZecToZatoshis(input.amount);
  if (!amount.ok) throw new Error(amount.reason);
  const result = await call("quote", {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: pair.origin.assetId,
    destinationAsset: pair.destination.assetId,
    amount: amount.zatoshis.toString(),
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    recipient: input.recipient,
    refundTo: input.refundTo,
    deadline: new Date(Date.now() + 180000).toISOString(),
  });
  const q = result?.quote;
  if (
    !q ||
    typeof q.amountOut !== "string" ||
    typeof q.minAmountOut !== "string" ||
    q.amountIn !== amount.zatoshis.toString()
  )
    throw new Error("1Click returned an incomplete or mismatched quote.");
  return {
    source: "live",
    amountIn: input.amount,
    amountOut: formatUnits(q.amountOut, pair.destination.decimals),
    minimumOut: formatUnits(q.minAmountOut, pair.destination.decimals),
    chain: input.chain,
    estimatedSeconds:
      typeof q.timeEstimate === "number" && Number.isFinite(q.timeEstimate)
        ? q.timeEstimate
        : null,
    fetchedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 60000).toISOString(),
    slippageBps: 100,
  };
}
