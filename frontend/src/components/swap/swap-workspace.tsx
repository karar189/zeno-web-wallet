"use client";

import { TokenMark } from "@/components/trade/token-mark";
import {
  AdvancedToggle,
  useAdvancedView,
} from "@/components/ui/advanced-toggle";
import { PrivacyPreview } from "@/components/privacy/privacy-preview";
import {
  chainLabel,
  fallbackListings,
  findSpec,
  formatTokenPrice,
  tradeKey,
  type TradeListing,
  type TradeSpec,
} from "@/features/trade/catalog";
import {
  DEFAULT_REQUIREMENTS,
  assessRequirements,
  type PrivacyRequirements,
} from "@/features/guard/policy";
import type { DepositQuote, TradeQuote } from "@/features/trade/quote";
import { sendMainnetDeposit } from "@/features/trade/execute";
import { isTerminalSwapStatus, type SwapStatus } from "@/features/trade/status";
import { getWalletAddress } from "@/features/faucet/client";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import {
  ArrowDownUp,
  ArrowUpRight,
  CircleAlert,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

const facts = {
  receiver: "transparent",
  provider: true,
  verified: true,
} as const;

function specFromList(
  tokens: TradeListing[],
  blockchain: string,
  symbol: string,
): TradeSpec {
  return (
    tokens.find(
      (token) => token.blockchain === blockchain && token.symbol === symbol,
    ) ??
    findSpec(blockchain, symbol) ??
    fallbackListings()[0]
  );
}

export function SwapWorkspace() {
  const params = useSearchParams();
  const { network } = usePreferredNetwork();
  const [advanced] = useAdvancedView();
  const requested = findSpec(params.get("chain") ?? "", params.get("to") ?? "");
  const [tokens, setTokens] = useState<TradeListing[]>(fallbackListings());
  const [pay, setPay] = useState<TradeSpec>(fallbackListings()[0]);
  const [receive, setReceive] = useState<TradeSpec>(
    requested ?? specFromList(fallbackListings(), "sol", "USDC"),
  );
  const [amount, setAmount] = useState("0.1");
  const [consent, setConsent] = useState(false);
  const [requirements, setRequirements] =
    useState<PrivacyRequirements>(DEFAULT_REQUIREMENTS);
  const [picker, setPicker] = useState<"pay" | "receive" | null>(null);
  const [query, setQuery] = useState("");
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [destination, setDestination] = useState("");
  const [deposit, setDeposit] = useState<DepositQuote | null>(null);
  const [spendConfirmed, setSpendConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string[] | null>(null);
  const [swapStatus, setSwapStatus] = useState<SwapStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const privacyBlockers = assessRequirements(facts, requirements);
  const privacyAllowsExit = privacyBlockers.length === 0;

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

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expired = quote !== null && now >= Date.parse(quote.validUntil);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tokens.filter((token) => {
      if (!needle) return true;
      return `${token.symbol} ${token.name} ${chainLabel(token.blockchain)}`
        .toLowerCase()
        .includes(needle);
    });
  }, [query, tokens]);

  function clearQuote() {
    setQuote(null);
    setDeposit(null);
    setSpendConfirmed(false);
    setSent(null);
    setSwapStatus(null);
    setError(null);
  }

  useEffect(() => {
    if (!deposit || !sent?.length) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(
          `/api/trade/status?depositAddress=${encodeURIComponent(deposit!.depositAddress)}`,
          { cache: "no-store", signal: AbortSignal.timeout(15000) },
        );
        const body = (await response.json().catch(() => null)) as
          SwapStatus | { message?: string } | null;
        if (cancelled) return;
        if (!response.ok || !body || !("status" in body)) {
          timer = setTimeout(() => void poll(), 8000);
          return;
        }
        setSwapStatus(body);
        if (!isTerminalSwapStatus(body.status)) {
          timer = setTimeout(() => void poll(), 5000);
        }
      } catch {
        if (!cancelled) {
          timer = setTimeout(() => void poll(), 8000);
        }
      }
    }

    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deposit, sent]);

  function choose(token: TradeListing) {
    if (!token.available) return;
    const next = {
      blockchain: token.blockchain,
      symbol: token.symbol,
      name: token.name,
    };
    const other = picker === "pay" ? receive : pay;
    let nextPay = picker === "pay" ? next : pay;
    let nextReceive = picker === "receive" ? next : receive;
    if (tradeKey(next) === tradeKey(other)) {
      nextPay = receive;
      nextReceive = pay;
    }
    if (nextPay.symbol !== "ZEC" && nextReceive.symbol !== "ZEC") {
      if (picker === "pay") nextReceive = specFromList(tokens, "zec", "ZEC");
      else nextPay = specFromList(tokens, "zec", "ZEC");
    }
    setPay(nextPay);
    setReceive(nextReceive);
    setPicker(null);
    setQuery("");
    clearQuote();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setQuote(null);
    setBusy(true);
    try {
      const response = await fetch("/api/trade/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          payBlockchain: pay.blockchain,
          paySymbol: pay.symbol,
          receiveBlockchain: receive.blockchain,
          receiveSymbol: receive.symbol,
          consent,
        }),
        signal: AbortSignal.timeout(35000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Price unavailable.");
      setQuote(result);
      setNow(Date.now());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Price unavailable. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function prepareDeposit() {
    if (busy || sending || !quote || !privacyAllowsExit) return;
    setError(null);
    setDeposit(null);
    setSent(null);
    setSwapStatus(null);
    setSpendConfirmed(false);
    setBusy(true);
    try {
      const address = await getWalletAddress();
      if (address.network !== "mainnet" || !address.transparentAddress) {
        throw new Error(
          "Unlock the mainnet wallet and wait until it has a transparent refund address.",
        );
      }
      const response = await fetch("/api/trade/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          payBlockchain: pay.blockchain,
          paySymbol: pay.symbol,
          receiveBlockchain: receive.blockchain,
          receiveSymbol: receive.symbol,
          consent,
          recipient: destination.trim(),
          refundTo: address.transparentAddress,
        }),
        signal: AbortSignal.timeout(35000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "Deposit unavailable.");
      setDeposit(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Deposit unavailable. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function broadcastDeposit() {
    if (!deposit || !spendConfirmed || sending || !privacyAllowsExit) return;
    setSending(true);
    setError(null);
    setSwapStatus(null);
    try {
      const result = await sendMainnetDeposit({
        depositAddress: deposit.depositAddress,
        amountZatoshis: deposit.amountIn,
      });
      setSent(result.txids);
      setSpendConfirmed(false);
      const txHash = result.txids[0];
      if (txHash) {
        await fetch("/api/trade/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            depositAddress: deposit.depositAddress,
            txHash,
          }),
          signal: AbortSignal.timeout(15000),
        }).catch(() => undefined);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The deposit was not sent.",
      );
    } finally {
      setSending(false);
    }
  }

  const payListing = tokens.find((token) => tradeKey(token) === tradeKey(pay));
  const receiveListing = tokens.find(
    (token) => tradeKey(token) === tradeKey(receive),
  );

  return (
    <div className="workspace-page single-flow">
      <div className="page-intro">
        <span className="eyebrow">Trade</span>
        <h1>
          Swap ZEC
          <br />
          <span>for another token.</span>
        </h1>
        {advanced ? (
          <p>
            Live NEAR Intents prices, then a real mainnet ZEC deposit when you
            confirm. Testnet can price the pair but cannot fund the swap.
          </p>
        ) : null}
      </div>
      <div className="flow-toolbar">
        <AdvancedToggle />
      </div>
      <div className="route-layout">
        <form
          className="surface swap-form"
          onSubmit={(event) => void submit(event)}
        >
          <div className="section-heading">
            <h2>Trade</h2>
            <span className="network-pill">Mainnet price</span>
          </div>
          <fieldset disabled={busy} className="contents">
            <div className="amount-field">
              <span>You pay</span>
              <div>
                <input
                  aria-label="Amount to pay"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => {
                    clearQuote();
                    setAmount(event.target.value);
                  }}
                />
                <TokenButton
                  token={pay}
                  onClick={() => {
                    setQuery("");
                    setPicker("pay");
                  }}
                />
              </div>
              <small>
                {chainLabel(pay.blockchain)}
                {payListing?.price != null
                  ? ` · ${formatTokenPrice(payListing.price)}`
                  : ""}
              </small>
            </div>
            <div className="swap-divider">
              <button
                type="button"
                className="token-flip"
                aria-label="Switch pay and receive"
                onClick={() => {
                  setPay(receive);
                  setReceive(pay);
                  clearQuote();
                }}
              >
                <ArrowDownUp size={16} />
              </button>
            </div>
            <div className="amount-field">
              <span>You receive</span>
              <div>
                <strong className="trade-out">
                  {quote ? quote.receiveAmount : "—"}
                </strong>
                <TokenButton
                  token={receive}
                  onClick={() => {
                    setQuery("");
                    setPicker("receive");
                  }}
                />
              </div>
              <small>
                {chainLabel(receive.blockchain)}
                {receiveListing?.price != null
                  ? ` · ${formatTokenPrice(receiveListing.price)}`
                  : ""}
                {receiveListing && !receiveListing.available
                  ? " · not quoted right now"
                  : ""}
              </small>
            </div>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => {
                  clearQuote();
                  setConsent(event.target.checked);
                }}
              />
              <span>
                Share this amount with 1Click to price the pair. Your addresses
                stay here. Zeno Wallet does not save the price.
              </span>
            </label>
          </fieldset>
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-action" disabled={busy || !consent}>
            {busy ? "Getting price…" : quote ? "Refresh price" : "Get price"}
          </button>
          {advanced ? (
            <p className="form-footnote">
              {network === "mainnet" && pay.symbol === "ZEC"
                ? "A price does not move ZEC. The deposit below is a separate, confirmed payment."
                : "This price does not move ZEC. Switch the header menu to Zcash mainnet to send a swap."}
            </p>
          ) : null}
          {network === "mainnet" &&
          pay.symbol === "ZEC" &&
          quote &&
          !expired ? (
            <div className="amount-field">
              <span>Destination address</span>
              <input
                aria-label="Destination address"
                value={destination}
                onChange={(event) => {
                  setDestination(event.target.value);
                  setDeposit(null);
                  setSpendConfirmed(false);
                  setSent(null);
                  setSwapStatus(null);
                }}
                placeholder={
                  receive.blockchain === "sol"
                    ? "Solana address"
                    : receive.blockchain === "btc"
                      ? "Bitcoin address"
                      : "0x address"
                }
              />
              <small>
                1Click pays this address. Your ZEC refund address is the
                wallet&apos;s transparent address, and that payment is public.
              </small>
              {!privacyAllowsExit ? (
                <p className="inline-error" role="status">
                  Relax the privacy requirements below before preparing a public
                  DeFi exit.
                </p>
              ) : null}
              <button
                type="button"
                className="secondary-action"
                disabled={
                  busy ||
                  sending ||
                  !privacyAllowsExit ||
                  destination.trim().length === 0
                }
                onClick={() => void prepareDeposit()}
              >
                {busy ? "Preparing deposit…" : "Prepare deposit"}
              </button>
            </div>
          ) : null}
          {deposit ? (
            <div className="quote-result">
              <p>
                Send {deposit.payAmount} ZEC to {deposit.depositAddress}. You
                receive at least {deposit.minimumReceive}{" "}
                {deposit.receiveSymbol} on {chainLabel(deposit.receiveChain)}.
                Refunds return to {deposit.refundTo}.
              </p>
              <p className="form-footnote">
                Deposit window open until{" "}
                {new Date(deposit.deadline).toLocaleString()}.
                {deposit.estimatedSeconds != null
                  ? ` Provider estimate after confirmation: ${deposit.estimatedSeconds}s.`
                  : ""}
              </p>
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={spendConfirmed}
                  onChange={(event) => setSpendConfirmed(event.target.checked)}
                />
                <span>
                  Send this real mainnet ZEC deposit. It is public, and the
                  wallet fee is extra.
                </span>
              </label>
              <button
                type="button"
                className="primary-action"
                disabled={
                  !spendConfirmed ||
                  sending ||
                  !privacyAllowsExit ||
                  Boolean(sent)
                }
                onClick={() => void broadcastDeposit()}
              >
                {sending
                  ? "Sending ZEC…"
                  : sent
                    ? "Deposit broadcast"
                    : "Send ZEC deposit"}
              </button>
              {sent ? (
                <p>
                  Broadcast {sent.length ? sent.join(", ") : "accepted"}.
                  Tracking 1Click status below.
                </p>
              ) : null}
              {swapStatus ? (
                <p role="status">
                  1Click ·{" "}
                  {swapStatus.status.replaceAll("_", " ").toLowerCase()}
                  {" — "}
                  {swapStatus.note}
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
        <div className="space-y-5">
          {advanced || quote || deposit ? (
            <PrivacyPreview
              facts={facts}
              requirements={requirements}
              onChange={setRequirements}
              sharingAddresses={
                Boolean(deposit) || destination.trim().length > 0
              }
            />
          ) : null}
          {quote ? (
            <section className="surface quote-result" aria-live="polite">
              <div className="section-heading">
                <span className="eyebrow">1Click · live price</span>
                <span className="network-pill">
                  {expired ? "Price stale" : "Price only"}
                </span>
              </div>
              <h2>
                {quote.receiveAmount} <span>{quote.receiveSymbol}</span>
              </h2>
              <p>
                For {quote.payAmount} {quote.paySymbol} ·{" "}
                {chainLabel(quote.receiveChain)}
              </p>
              <dl>
                <div>
                  <dt>Minimum received · 1% slippage</dt>
                  <dd>
                    {quote.minimumReceive} {quote.receiveSymbol}
                  </dd>
                </div>
                <div>
                  <dt>Provider time estimate</dt>
                  <dd>
                    {quote.estimatedSeconds === null
                      ? "Not reported"
                      : `${quote.estimatedSeconds} seconds`}
                  </dd>
                </div>
                <div>
                  <dt>Price fetched</dt>
                  <dd>{new Date(quote.fetchedAt).toLocaleTimeString()}</dd>
                </div>
              </dl>
              <p className="form-footnote">
                {expired
                  ? "Refresh to see the current price."
                  : "Refresh after 60 seconds. This is not a held price, and no deposit address was created."}
              </p>
            </section>
          ) : null}
          {advanced ? (
            <div className="boundary-note">
              <CircleAlert size={20} />
              <div>
                <strong>
                  {network === "mainnet" && pay.symbol === "ZEC"
                    ? "A deposit spends real ZEC"
                    : "Pricing only until mainnet"}
                </strong>
                <p>
                  {network === "mainnet" && pay.symbol === "ZEC"
                    ? "Prepare deposit asks 1Click for a one-time transparent address. ZEC moves only after you confirm Send ZEC deposit. Relax the privacy requirements first."
                    : "These prices are mainnet pairs. Switch to Zcash mainnet, unlock that wallet, and relax the privacy requirements before a deposit can be prepared."}
                </p>
                <Link href="/pay/send">
                  {network === "mainnet"
                    ? "Send shielded ZEC"
                    : "Send shielded testnet ZEC"}{" "}
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {picker ? (
        <div className="token-sheet-layer" role="presentation">
          <div
            className="token-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Choose a token"
          >
            <div className="token-sheet-head">
              <strong>{picker === "pay" ? "You pay" : "You receive"}</strong>
              <button
                type="button"
                className="wallet-popup-icon-btn"
                aria-label="Close token list"
                onClick={() => setPicker(null)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="token-search">
              <Search size={14} />
              <input
                autoFocus
                value={query}
                placeholder="Search name, symbol, or network"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="token-list" role="listbox">
              {filtered.map((token) => (
                <button
                  key={tradeKey(token)}
                  type="button"
                  className="token-row"
                  disabled={!token.available}
                  onClick={() => choose(token)}
                >
                  <TokenMark symbol={token.symbol} />
                  <span className="token-copy">
                    <strong>{token.name}</strong>
                    <small>
                      {token.symbol} · {chainLabel(token.blockchain)}
                      {token.available ? "" : " · unavailable"}
                    </small>
                  </span>
                  <span className="token-figures">
                    <small>{formatTokenPrice(token.price)}</small>
                  </span>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="form-footnote">No token matches that search.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TokenButton({
  token,
  onClick,
}: {
  token: TradeSpec;
  onClick: () => void;
}) {
  return (
    <button type="button" className="token-chip" onClick={onClick}>
      <TokenMark symbol={token.symbol} size={22} />
      <span>
        <strong>{token.symbol}</strong>
        <small>{chainLabel(token.blockchain)}</small>
      </span>
    </button>
  );
}
