"use client";

import {
  currentExplorerUrl,
  looksLikeTxid,
  transactionExplorerUrl,
} from "@/features/payments/explorer";
import type { PaymentChainRef, SubmissionEvidence } from "@/features/payments/types";
import { ExternalLink } from "lucide-react";

type Props = {
  submission?: SubmissionEvidence | null;
  chain?: PaymentChainRef | null;
};

export function ChainLinks({ submission, chain }: Props) {
  const references = unique([
    ...(submission?.txids ?? []),
    submission?.reference,
    chain?.txid,
  ].filter((value): value is string => Boolean(value)));

  const blockHref = currentExplorerUrl(chain?.explorer.block);

  if (!references.length && !chain?.blockHash && chain?.minedHeight == null) {
    return null;
  }

  return (
    <div className="chain-links">
      <p className="text-muted-foreground text-xs">On-chain</p>
      <ul className="space-y-2">
        {references.map((value) => {
          const href = looksLikeTxid(value)
            ? chain?.explorer.transaction && chain.txid === value
              ? currentExplorerUrl(chain.explorer.transaction)
              : transactionExplorerUrl(value)
            : null;
          return (
            <li key={value}>
              <p className="text-muted-foreground text-[11px] uppercase tracking-wide">
                Transaction
              </p>
              {href ? (
                <a
                  className="chain-link"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="font-mono text-sm break-all">{value}</span>
                  <ExternalLink size={13} />
                </a>
              ) : (
                <p className="font-mono text-sm break-all">{value}</p>
              )}
            </li>
          );
        })}
        {chain?.blockHash || chain?.minedHeight != null ? (
          <li>
            <p className="text-muted-foreground text-[11px] uppercase tracking-wide">
              Block
              {chain.minedHeight != null ? ` · height ${chain.minedHeight}` : ""}
              {chain.confirmations != null
                ? ` · ${chain.confirmations} confirmation${chain.confirmations === 1 ? "" : "s"}`
                : ""}
            </p>
            {blockHref && chain.blockHash ? (
              <a
                className="chain-link"
                href={blockHref}
                target="_blank"
                rel="noreferrer"
              >
                <span className="font-mono text-sm break-all">{chain.blockHash}</span>
                <ExternalLink size={13} />
              </a>
            ) : blockHref ? (
              <a
                className="chain-link"
                href={blockHref}
                target="_blank"
                rel="noreferrer"
              >
                <span className="text-sm">
                  Open block {chain.minedHeight ?? ""}
                </span>
                <ExternalLink size={13} />
              </a>
            ) : chain.blockHash ? (
              <p className="font-mono text-sm break-all">{chain.blockHash}</p>
            ) : null}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}
