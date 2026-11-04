"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ExternalLink, List, Shield } from "lucide-react";
import {
  looksLikeTxid,
  transactionExplorerUrl,
} from "@/features/payments/explorer";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { usePaymentStore } from "@/stores/payment-store";
import { deriveLifecycle } from "@/features/payments/lifecycle";
export function ActivityPlaceholder({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { activity, selectActivity, clearActivity, busy, keepTracking } =
    usePaymentStore();
  const { mainnetPreview } = usePreferredNetwork();
  const router = useRouter();
  const rows = mainnetPreview
    ? []
    : compact
      ? activity.slice(0, 3)
      : activity;
  if (!rows.length)
    return (
      <div className="surface activity-empty">
        <List size={25} />
        <div>
          <h2>{mainnetPreview ? "No mainnet activity" : "No payments yet"}</h2>
          <p>
            {mainnetPreview
              ? "Testnet payment history is hidden while mainnet preview is selected."
              : "Your payment attempts appear here, with submission and confirmation kept separate."}
          </p>
          {!mainnetPreview ? (
            <Link className="text-link mt-3" href="/pay/send">
              Prepare a payment <ArrowUpRight size={14} />
            </Link>
          ) : null}
        </div>
      </div>
    );
  return (
    <section aria-label="Payment history">
      {!compact && (
        <div className="activity-tools">
          <p>
            {keepTracking
              ? "Tracking receipts are saved in this tab. No seed or viewing key is saved here."
              : "Payment history is in memory. Refreshing clears it unless tracking receipts were enabled."}
          </p>
          <button
            disabled={busy !== null}
            onClick={() => {
              if (
                window.confirm(
                  "Remove the local history? This does not cancel payments or resolve an unknown submission. Check your wallet before retrying any payment.",
                )
              )
                clearActivity();
            }}
          >
            Clear local history
          </button>
        </div>
      )}
      <div className="surface !p-0">
        {rows.map((record) => {
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
                      : "Testnet"}
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
