import { formatUnits } from "@/features/near/preview";
import {
  findSpec,
  parseUnits,
  quoteAddress,
  selectListedToken,
  toListings,
  type ListedToken,
  type TradeListing,
} from "@/features/trade/catalog";
import { oneClick } from "@/features/trade/oneclick";

/** Dry price quotes stay short-lived. */
const DRY_DEADLINE_MS = 3 * 60 * 1000;
/**
 * Executable ZEC deposits need room for mining plus bridge confirmations.
 * Anew and similar ZEC→Intents flows use ~30 minutes.
 */
const DEPOSIT_DEADLINE_MS = 30 * 60 * 1000;
const PRICE_FRESH_MS = 60 * 1000;

export type TradeInput = {
  amount: string;
  payBlockchain: string;
  paySymbol: string;
  receiveBlockchain: string;
  receiveSymbol: string;
  consent: true;
};

export type TradeQuote = {
  source: "live";
  paySymbol: string;
  payChain: string;
  payAmount: string;
  receiveSymbol: string;
  receiveChain: string;
  receiveAmount: string;
  minimumReceive: string;
  estimatedSeconds: number | null;
  fetchedAt: string;
  validUntil: string;
  slippageBps: 100;
};

export function validateTrade(input: unknown): TradeInput {
  if (!input || typeof input !== "object") {
    throw new Error("Enter the trade details.");
  }
  const value = input as Record<string, unknown>;
  const pay = findSpec(
    String(value.payBlockchain ?? ""),
    String(value.paySymbol ?? ""),
  );
  const receive = findSpec(
    String(value.receiveBlockchain ?? ""),
    String(value.receiveSymbol ?? ""),
  );
  if (!pay || !receive) throw new Error("Choose a listed token.");
  if (pay.blockchain === receive.blockchain && pay.symbol === receive.symbol) {
    throw new Error("Choose two different tokens.");
  }
  if (pay.symbol !== "ZEC" && receive.symbol !== "ZEC") {
    throw new Error("One side of the trade has to be ZEC.");
  }
  if (typeof value.amount !== "string") {
    throw new Error("Enter an amount.");
  }
  if (value.consent !== true) {
    throw new Error("Approve sharing the amount for a live price first.");
  }
  return {
    amount: value.amount,
    payBlockchain: pay.blockchain,
    paySymbol: pay.symbol,
    receiveBlockchain: receive.blockchain,
    receiveSymbol: receive.symbol,
    consent: true,
  };
}

function asListed(raw: unknown): ListedToken[] {
  if (!Array.isArray(raw)) throw new Error("1Click returned an unreadable asset list.");
  return raw.filter(
    (token): token is ListedToken =>
      Boolean(token) &&
      typeof token.assetId === "string" &&
      typeof token.blockchain === "string" &&
      typeof token.symbol === "string" &&
      Number.isInteger(token.decimals),
  );
}

export async function loadTradeListings(
  fetcher: typeof fetch = fetch,
): Promise<TradeListing[]> {
  try {
    return toListings(asListed(await oneClick("tokens", fetcher)));
  } catch {
    return toListings([]);
  }
}

export async function fetchTradeQuote(
  input: TradeInput,
  fetcher: typeof fetch = fetch,
): Promise<TradeQuote> {
  const tokens = asListed(await oneClick("tokens", fetcher));
  const pay = selectListedToken(tokens, input.payBlockchain, input.paySymbol);
  const receive = selectListedToken(
    tokens,
    input.receiveBlockchain,
    input.receiveSymbol,
  );
  const amount = parseUnits(input.amount, pay.decimals);
  if (!amount.ok) throw new Error(amount.reason);
  let result: unknown;
  try {
    result = await oneClick("quote", fetcher, {
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: pay.assetId,
      destinationAsset: receive.assetId,
      amount: amount.units.toString(),
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      recipient: quoteAddress(receive.blockchain),
      refundTo: quoteAddress(pay.blockchain),
      deadline: new Date(Date.now() + DRY_DEADLINE_MS).toISOString(),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes("1Click")
        ? error.message.replace(
            "complete this request",
            "quote this pair. Try another token or amount",
          )
        : "1Click could not quote this pair. Try another token or amount.",
    );
  }
  const quote = (result as { quote?: Record<string, unknown> } | null)?.quote;
  if (
    !quote ||
    typeof quote.amountOut !== "string" ||
    typeof quote.minAmountOut !== "string" ||
    quote.amountIn !== amount.units.toString()
  ) {
    throw new Error("1Click returned an incomplete or mismatched quote.");
  }
  return {
    source: "live",
    paySymbol: pay.symbol,
    payChain: pay.blockchain,
    payAmount: input.amount,
    receiveSymbol: receive.symbol,
    receiveChain: receive.blockchain,
    receiveAmount: formatUnits(quote.amountOut, receive.decimals),
    minimumReceive: formatUnits(quote.minAmountOut, receive.decimals),
    estimatedSeconds:
      typeof quote.timeEstimate === "number" &&
      Number.isFinite(quote.timeEstimate)
        ? quote.timeEstimate
        : null,
    fetchedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + PRICE_FRESH_MS).toISOString(),
    slippageBps: 100,
  };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type DepositInput = TradeInput & {
  recipient: string;
  refundTo: string;
};

export type DepositQuote = {
  depositAddress: string;
  amountIn: string;
  payAmount: string;
  receiveAmount: string;
  minimumReceive: string;
  receiveSymbol: string;
  receiveChain: string;
  refundTo: string;
  recipient: string;
  /** When the 1Click refund window begins if the swap is incomplete. */
  deadline: string;
  /** Local UI freshness for preparing the spend; not the refund deadline. */
  validUntil: string;
  estimatedSeconds: number | null;
};

function usesCharset(value: string, alphabet: string): boolean {
  return [...value].every((character) => alphabet.includes(character));
}

export function destinationError(chain: string, address: string): string | null {
  const value = address.trim();
  if (value.length === 0 || /\s/.test(value) || value.length > 128) {
    return "Enter the destination address.";
  }
  if (chain === "sol") {
    return value.length >= 32 && value.length <= 44 && usesCharset(value, BASE58)
      ? null
      : "Enter a Solana address.";
  }
  if (chain === "btc") {
    return /^(bc1|[13])[a-zA-Z0-9]{20,80}$/.test(value)
      ? null
      : "Enter a Bitcoin address.";
  }
  if (chain === "eth" || chain === "base" || chain === "arb" || chain === "op") {
    return /^0x[a-fA-F0-9]{40}$/.test(value) ? null : "Enter an EVM address.";
  }
  return "This chain is not available for a live swap.";
}

export function refundError(address: string): string | null {
  const value = address.trim();
  if (!value.startsWith("t1") && !value.startsWith("t3")) {
    return "Refunds use your mainnet transparent address (t1 or t3).";
  }
  const body = value.slice(2);
  if (body.length < 20 || !usesCharset(body, BASE58)) {
    return "The refund address is not a transparent mainnet address.";
  }
  return null;
}

export function validateDeposit(input: unknown): DepositInput {
  const trade = validateTrade(input);
  if (trade.paySymbol !== "ZEC" || trade.payBlockchain !== "zec") {
    throw new Error("A live swap spends ZEC from this wallet.");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.recipient !== "string" || typeof value.refundTo !== "string") {
    throw new Error("Enter the destination and the wallet refund address.");
  }
  const destination = destinationError(trade.receiveBlockchain, value.recipient);
  if (destination) throw new Error(destination);
  const refund = refundError(value.refundTo);
  if (refund) throw new Error(refund);
  return {
    ...trade,
    recipient: value.recipient.trim(),
    refundTo: value.refundTo.trim(),
  };
}

function matches(record: Record<string, unknown>, key: string, expected: string): boolean {
  return record[key] === undefined || record[key] === expected;
}

export async function fetchDepositQuote(
  input: DepositInput,
  fetcher: typeof fetch = fetch,
): Promise<DepositQuote> {
  const tokens = asListed(await oneClick("tokens", fetcher));
  const pay = selectListedToken(tokens, input.payBlockchain, input.paySymbol);
  const receive = selectListedToken(
    tokens,
    input.receiveBlockchain,
    input.receiveSymbol,
  );
  const amount = parseUnits(input.amount, pay.decimals);
  if (!amount.ok) throw new Error(amount.reason);
  const requestedDeadline = new Date(
    Date.now() + DEPOSIT_DEADLINE_MS,
  ).toISOString();
  let result: unknown;
  try {
    result = await oneClick("quote", fetcher, {
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: pay.assetId,
      destinationAsset: receive.assetId,
      amount: amount.units.toString(),
      depositType: "ORIGIN_CHAIN",
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      recipient: input.recipient,
      refundTo: input.refundTo,
      deadline: requestedDeadline,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "1Click could not create a deposit for this swap.",
    );
  }
  const record = (result ?? {}) as {
    quote?: Record<string, unknown>;
    quoteRequest?: Record<string, unknown>;
  };
  const quote = record.quote;
  const request = record.quoteRequest ?? {};
  const depositAddress =
    typeof quote?.depositAddress === "string" ? quote.depositAddress : "";
  if (
    typeof quote?.depositMemo === "string" &&
    quote.depositMemo.length > 0
  ) {
    throw new Error(
      "This deposit requires a memo. Zeno Wallet cannot attach memos to Zcash deposits yet.",
    );
  }
  if (
    !quote ||
    typeof quote.amountOut !== "string" ||
    typeof quote.minAmountOut !== "string" ||
    quote.amountIn !== amount.units.toString() ||
    refundError(depositAddress) ||
    depositAddress === input.refundTo ||
    !matches(quote, "refundTo", input.refundTo) ||
    !matches(quote, "recipient", input.recipient) ||
    !matches(request, "refundTo", input.refundTo) ||
    !matches(request, "recipient", input.recipient) ||
    (request.amount !== undefined && request.amount !== amount.units.toString())
  ) {
    throw new Error("1Click returned a deposit quote that does not match this swap.");
  }
  const deadline =
    typeof quote.deadline === "string" && quote.deadline.length > 0
      ? quote.deadline
      : requestedDeadline;
  return {
    depositAddress,
    amountIn: amount.units.toString(),
    payAmount: input.amount,
    receiveAmount: formatUnits(quote.amountOut, receive.decimals),
    minimumReceive: formatUnits(quote.minAmountOut, receive.decimals),
    receiveSymbol: receive.symbol,
    receiveChain: receive.blockchain,
    refundTo: input.refundTo,
    recipient: input.recipient,
    deadline,
    validUntil: new Date(Date.now() + PRICE_FRESH_MS).toISOString(),
    estimatedSeconds:
      typeof quote.timeEstimate === "number" &&
      Number.isFinite(quote.timeEstimate)
        ? quote.timeEstimate
        : null,
  };
}
