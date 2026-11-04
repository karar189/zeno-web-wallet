"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  List,
  RefreshCw,
  Shield,
} from "lucide-react";
import {
  getWalletHistory,
  WalletServiceError,
} from "@/features/faucet/client";
import { readStoredClaim } from "@/features/faucet/storage";
import type { WalletHistoryTx } from "@/features/faucet/types";
import { formatZatoshis } from "@/features/payments/amount";
import {
  looksLikeTxid,
  transactionExplorerUrl,
} from "@/features/payments/explorer";
import { deriveLifecycle } from "@/features/payments/lifecycle";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { useWalletSession } from "@/features/session/use-wallet-session";
import { usePaymentStore } from "@/stores/payment-store";
import { CipherLoading } from "@/components/ui/cipher-loading";

function signedZec(deltaZat: string): string {
  try {
    return `${formatZatoshis(BigInt(deltaZat))} ZEC`;
  } catch {
    return "—";
  }
}

function receivedZec(tx: WalletHistoryTx): string {
  try {
    const received = BigInt(tx.totalReceivedZatoshis);
    if (received > BigInt(0)) {
      return `+${formatZatoshis(received)} ZEC`;
    }
    return signedZec(tx.accountBalanceDeltaZatoshis);
  } catch {
    return signedZec(tx.accountBalanceDeltaZatoshis);
  }
}

function historyLabel(
  tx: WalletHistoryTx,
  faucetTxid: string | null,
): { title: string; amount: string; Icon: typeof ArrowDownLeft } {
  const isFaucet =
    faucetTxid !== null &&
    tx.txid.toLowerCase() === faucetTxid.toLowerCase() &&
    tx.kind === "received";
  if (isFaucet || tx.kind === "received") {
    return {
      title: isFaucet ? "Received · faucet" : "Received",
      amount: receivedZec(tx),
      Icon: ArrowDownLeft,
    };
  }
  if (tx.kind === "shield") {
    return {
      title: "Shielded",
      amount: signedZec(tx.accountBalanceDeltaZatoshis),
      Icon: Shield,
    };
  }
  if (tx.kind === "sent") {
    return {
      title: "Sent",
      amount: signedZec(tx.accountBalanceDeltaZatoshis),
      Icon: ArrowUpRight,
    };
  }
  return {
    title: "Activity",
    amount: signedZec(tx.accountBalanceDeltaZatoshis),
    Icon: List,
  };
}

export function ActivityPlaceholder({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { activity, selectActivity, clearActivity, busy, keepTracking } =
    usePaymentStore();
  const { mainnetPreview } = usePreferredNetwork();
  const session = useWalletSession();
  const router = useRouter();
  const [chainTxs, setChainTxs] = useState<WalletHistoryTx[]>([]);
  const [chainError, setChainError] = useState<string | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [faucetTxid, setFaucetTxid] = useState<string | null>(null);

  useEffect(() => {
    const claim = readStoredClaim();
    setFaucetTxid(claim?.report?.txid ?? null);
  }, []);

  useEffect(() => {
    if (mainnetPreview) {
      setChainTxs([]);
      setChainError(null);
      setChainLoading(false);
      return;
    }
    if (session.status !== "ready" || session.session.locked) {
      setChainTxs([]);
      setChainError(null);
      setChainLoading(false);
      return;
    }

    let cancelled = false;
    setChainLoading(true);
    setChainError(null);

    void getWalletHistory()
      .then((history) => {
        if (cancelled) return;
        setChainTxs(history.transactions);
      })
      .catch((error) => {
        if (cancelled) return;
        setChainTxs([]);
        setChainError(
          error instanceof WalletServiceError
            ? error.message
            : "Could not load wallet history.",
        );
      })
      .finally(() => {
        if (!cancelled) setChainLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mainnetPreview, session]);

  const paymentRows = mainnetPreview
    ? []
    : compact
      ? activity.slice(0, 3)
      : activity;
  const historyRows = mainnetPreview
    ? []
    : compact
      ? chainTxs.slice(0, 3)
      : chainTxs;

  const empty =
    !chainLoading &&
    historyRows.length === 0 &&
    paymentRows.length === 0 &&
    !chainError;

  if (empty) {
    return (
      <div className="surface activity-empty">
        <List size={25} />
        <div>
          <h2>{mainnetPreview ? "No mainnet activity" : "No payments yet"}</h2>
          <p>
            {mainnetPreview
              ? "Testnet payment history is hidden while mainnet preview is selected."
              : "Received faucet funds and payment attempts appear here after the wallet syncs."}
          </p>
          {!mainnetPreview ? (
            <Link className="text-link mt-3" href="/pay/send">
              Prepare a payment <ArrowUpRight size={14} />
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Payment history">
      {!compact && (
        <div className="activity-tools">
          <p>
            {keepTracking
              ? "Tracking receipts are saved in this tab. Chain receives come from your local wallet sync."
              : "Chain history comes from the local wallet. Payment drafts stay in memory unless tracking is enabled."}
          </p>
          <button
            disabled={busy !== null}
            onClick={() => {
              if (
                window.confirm(
                  "Remove the local payment drafts? This does not cancel payments or remove on-chain history.",
                )
              )
                clearActivity();
            }}
          >
            Clear local drafts
          </button>
        </div>
      )}

      <div className="surface !p-0">
        {chainLoading ? (
          <div className="activity-row">
            <RefreshCw size={19} className="animate-spin text-[#ffc14a]" />
            <div>
              <strong>
                <CipherLoading label="Decrypting history" text="Decrypting…" length={12} />
              </strong>
              <p>Reading received and sent amounts from the local wallet…</p>
            </div>
          </div>
        ) : null}

        {chainError ? (
          <div className="activity-row">
            <List size={19} className="text-[#e7a598]" />
            <div>
              <strong>History unavailable</strong>
              <p>{chainError}</p>
            </div>
          </div>
        ) : null}

        {historyRows.map((tx) => {
          const { title, amount, Icon } = historyLabel(tx, faucetTxid);
          const txHref = looksLikeTxid(tx.txid)
            ? transactionExplorerUrl(tx.txid)
            : null;
          return (
            <div className="activity-row" key={`chain-${tx.txid}`}>
              <Icon size={19} className="text-[#ffc14a]" />
              <div>
                <strong>
                  {amount}{" "}
                  <span className="network-pill ml-2">{title}</span>
                </strong>
                <p>
                  {tx.minedHeight != null
                    ? `Block ${tx.minedHeight.toLocaleString()}`
                    : "Unmined"}
                  {tx.kind === "received"
                    ? " · shielded receive"
                    : tx.kind === "sent"
                      ? " · shielded send"
                      : ""}
                </p>
                {looksLikeTxid(tx.txid) ? (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-cream/45">
                    {txHref ? (
                      <a
                        className="inline-flex items-center gap-1 text-cream/70 hover:text-cream"
                        href={txHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Tx {tx.txid.slice(0, 8)}…{tx.txid.slice(-6)}
                        <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span className="font-mono">
                        Tx {tx.txid.slice(0, 8)}…{tx.txid.slice(-6)}
                      </span>
                    )}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}

        {paymentRows.map((record) => {
          const board = deriveLifecycle(record);
          const txid =
            record.chain?.txid ||
            record.submission?.txids?.[0] ||
            record.submission?.reference ||
            null;
          const txHref =
            record.chain?.explorer.transaction ||
            (looksLikeTxid(txid) ? transactionExplorerUrl(txid) : null);
          const blockHref = record.chain?.explorer.block ?? null;
          return (
            <div className="activity-row" key={record.id}>
              <Shield size={19} className="text-[#ffc14a]" />
              <div>
                <strong>
                  {record.request.amountZec} ZEC{" "}
                  <span className="network-pill ml-2">
                    {record.dataSource === "simulated"
                      ? "Simulated"
                      : "Draft"}
                  </span>
                </strong>
                <p>
                  {record.request.zcashName
                    ? `${record.request.zcashName} · `
                    : ""}
                  {record.request.recipient.slice(0, 20)}… ·{" "}
                  {board.state.replaceAll("_", " ")}
                </p>
                {txid ? (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-cream/45">
                    {txHref ? (
                      <a
                        className="inline-flex items-center gap-1 text-cream/70 hover:text-cream"
                        href={txHref}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Tx {txid.slice(0, 8)}…{txid.slice(-6)}
                        <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span className="font-mono">
                        Tx {txid.slice(0, 8)}…{txid.slice(-6)}
                      </span>
                    )}
                    {blockHref ? (
                      <a
                        className="inline-flex items-center gap-1 text-cream/70 hover:text-cream"
                        href={blockHref}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Block
                        {record.chain?.minedHeight != null
                          ? ` ${record.chain.minedHeight}`
                          : ""}
                        <ExternalLink size={11} />
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <button
                disabled={busy !== null}
                onClick={() => {
                  selectActivity(record.id);
                  router.push(
                    record.phase === "awaiting_approval"
                      ? "/pay/review"
                      : "/pay/status",
                  );
                }}
              >
                View status ↗
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
