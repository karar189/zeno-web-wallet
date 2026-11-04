export type TradeSpec = {
  blockchain: string;
  symbol: string;
  name: string;
};

export type ListedToken = {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  price?: number;
};

export type TradeListing = TradeSpec & {
  price: number | null;
  decimals: number | null;
  available: boolean;
};

export const TRADE_SPECS: TradeSpec[] = [
  { blockchain: "zec", symbol: "ZEC", name: "Zcash" },
  { blockchain: "sol", symbol: "SOL", name: "Solana" },
  { blockchain: "sol", symbol: "USDC", name: "USD Coin" },
  { blockchain: "sol", symbol: "USDT", name: "Tether" },
  { blockchain: "eth", symbol: "ETH", name: "Ether" },
  { blockchain: "eth", symbol: "USDC", name: "USD Coin" },
  { blockchain: "eth", symbol: "USDT", name: "Tether" },
  { blockchain: "base", symbol: "ETH", name: "Ether" },
  { blockchain: "base", symbol: "USDC", name: "USD Coin" },
  { blockchain: "arb", symbol: "ETH", name: "Ether" },
  { blockchain: "arb", symbol: "USDC", name: "USD Coin" },
  { blockchain: "op", symbol: "ETH", name: "Ether" },
  { blockchain: "op", symbol: "USDC", name: "USD Coin" },
  { blockchain: "btc", symbol: "BTC", name: "Bitcoin" },
];

const CHAIN_LABELS: Record<string, string> = {
  zec: "Zcash",
  sol: "Solana",
  eth: "Ethereum",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  btc: "Bitcoin",
};

const EVM = new Set(["eth", "base", "arb", "op"]);

const PLACEHOLDER = {
  zec: "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs",
  btc: "1111111111111111111114oLvT2",
  sol: "4iBR7RCMPRFpGF6vqKejc6e9gGLAxhuFhXPLXu7o7VfG",
  evm: "0x1111111111111111111111111111111111111111",
} as const;

export function chainLabel(blockchain: string): string {
  return CHAIN_LABELS[blockchain] ?? blockchain;
}

export function tradeKey(token: { blockchain: string; symbol: string }): string {
  return `${token.blockchain}:${token.symbol}`;
}

export function findSpec(blockchain: string, symbol: string): TradeSpec | null {
  return (
    TRADE_SPECS.find(
      (token) => token.blockchain === blockchain && token.symbol === symbol,
    ) ?? null
  );
}

export function fallbackListings(): TradeListing[] {
  return TRADE_SPECS.map((token) => ({
    ...token,
    price: null,
    decimals: null,
    available: true,
  }));
}

export function quoteAddress(blockchain: string): string {
  if (blockchain === "zec") return PLACEHOLDER.zec;
  if (blockchain === "btc") return PLACEHOLDER.btc;
  if (blockchain === "sol") return PLACEHOLDER.sol;
  if (EVM.has(blockchain)) return PLACEHOLDER.evm;
  throw new Error("That network is not available for a quote.");
}

function rank(token: ListedToken): number {
  const id = token.assetId;
  if (id.startsWith("1cs_v1:") || id.includes("miden-")) return 0;
  if (id.startsWith("nep245:")) return 1;
  if (id.endsWith(".omft.near") && !id.includes("-")) return 3;
  if (id.includes(".omft.near")) return 2;
  return 1;
}

export function selectListedToken(
  tokens: ListedToken[],
  blockchain: string,
  symbol: string,
): ListedToken & TradeSpec {
  const spec = findSpec(blockchain, symbol);
  if (!spec) throw new Error("That token is not available to trade.");
  const matches = tokens
    .filter(
      (token) =>
        token.blockchain === blockchain &&
        token.symbol === symbol &&
        typeof token.assetId === "string" &&
        Number.isInteger(token.decimals),
    )
    .sort((a, b) => rank(b) - rank(a));
  const selected = matches[0];
  if (!selected) {
    throw new Error(
      `${symbol} on ${chainLabel(blockchain)} is not currently quoted.`,
    );
  }
  return { ...spec, ...selected };
}

export function toListings(tokens: ListedToken[]): TradeListing[] {
  return TRADE_SPECS.map((spec) => {
    try {
      const selected = selectListedToken(tokens, spec.blockchain, spec.symbol);
      return {
        ...spec,
        price:
          typeof selected.price === "number" && Number.isFinite(selected.price)
            ? selected.price
            : null,
        decimals: selected.decimals,
        available: true,
      };
    } catch {
      return { ...spec, price: null, decimals: null, available: false };
    }
  });
}

export function formatTokenPrice(price: number | null): string {
  if (price === null || !Number.isFinite(price) || price < 0) return "—";
  if (price >= 1000) return `$${price.toFixed(0)}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toPrecision(3)}`;
}

export function parseUnits(
  input: string,
  decimals: number,
): { ok: true; units: bigint } | { ok: false; reason: string } {
  const value = input.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return { ok: false, reason: "Unsupported token decimals." };
  }
  if (value.length > 40) {
    return { ok: false, reason: "Enter a shorter amount." };
  }
  const pattern =
    decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(value)) {
    return {
      ok: false,
      reason: `Enter an amount with at most ${decimals} decimal places.`,
    };
  }
  const [whole, fraction = ""] = value.split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  const scale = BigInt(10) ** BigInt(decimals);
  const units = BigInt(whole) * scale + (padded ? BigInt(padded) : BigInt(0));
  if (units <= BigInt(0)) {
    return { ok: false, reason: "Amount must be greater than zero." };
  }
  return { ok: true, units };
}
