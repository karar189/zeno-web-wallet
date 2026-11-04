"use client";

import { TokenMark } from "@/components/trade/token-mark";
import {
  chainLabel,
  fallbackListings,
  formatTokenPrice,
  tradeKey,
  type TradeListing,
} from "@/features/trade/catalog";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const HOME_KEYS = ["zec:ZEC", "sol:SOL", "sol:USDC", "eth:ETH", "btc:BTC", "eth:USDT"];

export function TradeTokenStrip({
  zecBalance,
}: {
  zecBalance: string | null;
}) {
  const [tokens, setTokens] = useState<TradeListing[]>(fallbackListings());

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/trade/tokens")
      .then((response) => response.json())
      .then((body: { tokens?: TradeListing[] }) => {
        if (!cancelled && Array.isArray(body.tokens) && body.tokens.length) {
          setTokens(body.tokens);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = HOME_KEYS.map((key) => tokens.find((token) => tradeKey(token) === key)).filter(
    (token): token is TradeListing => Boolean(token),
  );

  return (
    <section className="surface token-panel" aria-label="Tokens">
      <div className="section-heading">
        <h2>Tokens</h2>
        <Link href="/swap">
          Trade <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="token-list">
        {rows.map((token) => {
          const href =
            token.symbol === "ZEC"
              ? "/swap"
              : `/swap?to=${token.symbol}&chain=${token.blockchain}`;
          return (
            <Link key={tradeKey(token)} href={href} className="token-row">
              <TokenMark symbol={token.symbol} />
              <span className="token-copy">
                <strong>{token.name}</strong>
                <small>
                  {token.symbol} · {chainLabel(token.blockchain)}
                </small>
              </span>
              <span className="token-figures">
                <strong>
                  {token.symbol === "ZEC"
                    ? (zecBalance ?? "—")
                    : formatTokenPrice(token.price)}
                </strong>
                <small>{token.symbol === "ZEC" ? "Spendable" : "Price"}</small>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
