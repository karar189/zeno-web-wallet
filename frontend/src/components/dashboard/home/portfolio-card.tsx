"use client";

import { QuickActionsRow } from "@/components/dashboard/home/quick-actions-row";
import { useBalancePrivacy } from "@/components/dashboard/home/use-balance-privacy";
import { ChevronRight, CircleHelp, LoaderCircle, TrendingUp } from "lucide-react";
import Link from "next/link";

export type PortfolioCardState =
  | { status: "loading" }
  | {
      status: "ready";
      spendableDisplay: string;
      syncLabel: string;
      synced: boolean;
      detectedNote: string | null;
    }
  | { status: "offline"; message: string };

type PortfolioCardProps = {
  state: PortfolioCardState;
  onRefresh: () => void;
};

function splitBalance(display: string): { whole: string; fraction: string } {
  const numeric = display.replace(/\s*ZEC$/i, "").trim();
  const [whole, fraction = ""] = numeric.split(".");
  return { whole, fraction };
}

export function PortfolioCard({ state, onRefresh }: PortfolioCardProps) {
  const { hidden, toggle } = useBalancePrivacy();
  const { whole, fraction } = splitBalance(
    state.status === "ready" ? state.spendableDisplay : "0.00",
  );

  return (
    <section className="text-center">
      <div className="flex items-center justify-center gap-1">
        <p className="text-[11px] tracking-[0.16em] text-[#8c8c8c] uppercase">
          Portfolio value
        </p>
        <button
          type="button"
          onClick={toggle}
          aria-label={hidden ? "Show balance" : "Hide balance"}
          className="icon-hit grid size-5 place-items-center text-[#8c8c8c]"
        >
          <CircleHelp className="size-3.5" strokeWidth={1.6} />
        </button>
      </div>

      {state.status === "loading" ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-[#8c8c8c]">
          <LoaderCircle className="size-4 animate-spin" strokeWidth={1.6} />
        </div>
      ) : state.status === "offline" ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={toggle}
            className="icon-hit wallet-tabular block h-auto min-h-0 w-full text-[42px] font-normal leading-none tracking-[0.02em] text-[#f7f4ef] uppercase"
          >
            {hidden ? "••••" : "0.00"}
          </button>
          <p className="mt-3 font-[var(--font-landing-sans),sans-serif] text-sm tracking-normal text-[#8c8c8c] normal-case">
            {state.message}
          </p>
          <Link
            href="/wallet"
            data-sound="nav"
            className="mt-2 inline-flex text-[11px] tracking-[0.14em] text-[#ffc14a] uppercase"
          >
            Fund on testnet
          </Link>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={toggle}
            className="icon-hit wallet-tabular mt-2 block h-auto min-h-0 w-full text-[42px] font-normal leading-none tracking-[0.02em] text-[#f7f4ef] uppercase"
          >
            {hidden ? "••••" : `${whole}.${fraction || "00"}`}
          </button>

          <button
            type="button"
            onClick={() => onRefresh()}
            className="icon-hit mx-auto mt-2.5 flex h-auto min-h-0 items-center justify-center gap-1 text-[11px] tracking-[0.14em] text-[#ffc14a] uppercase"
          >
            <TrendingUp className="size-3.5" strokeWidth={2.2} />
            {state.synced ? "Shielded · Testnet" : state.syncLabel}
            <ChevronRight className="size-3.5" strokeWidth={2} />
          </button>
        </>
      )}

      <QuickActionsRow />
    </section>
  );
}
