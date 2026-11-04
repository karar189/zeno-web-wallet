"use client";

import { ActivityPlaceholder } from "@/components/activity/activity-placeholder";
import { TradeTokenStrip } from "@/components/trade/trade-token-strip";
import { WalletPopup, type WalletPopupView } from "@/components/wallet/wallet-popup";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { ArrowLeftRight, ArrowUpRight, Eye, KeyRound, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TOOLS = [
  { href: "/swap", label: "Swap", note: "ZEC → USDC quotes", icon: ArrowLeftRight },
  { href: "/audit", label: "Auditor", note: "Scan a viewing key", icon: Eye },
  { href: "/settings/backup-wallet", label: "Backup", note: "Recovery phrase", icon: KeyRound },
  { href: "/settings", label: "Settings", note: "Network & privacy", icon: Settings },
] as const;

type Tab = "activity" | "markets";

/**
 * Overview = the same wallet core as the extension popup, plus room for
 * activity, markets, and tools. Like MetaMask's expanded view.
 */
export function WalletHomeDashboard() {
  const { mainnetPreview } = usePreferredNetwork();
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<WalletPopupView>("home");
  const [tab, setTab] = useState<Tab>("activity");

  // Deep links like /dashboard?wallet=1&view=receive open the embedded panel on Receive.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("wallet") !== "1") return;
    // Syncing from the URL once on mount; same pattern AppShell uses for the header popup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.get("view") === "receive") setView("receive");
    params.delete("wallet");
    params.delete("view");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router]);

  return (
    <div className="workspace-page overview-v2">
      <div className="overview-v2-wallet">
        <WalletPopup
          open
          embedded
          onOpenChange={() => setView("home")}
          view={view}
          onViewChange={setView}
        />
      </div>

      <div className="overview-v2-side">
        <section className="overview-v2-panel">
          <div className="overview-v2-tabs" role="tablist" aria-label="Overview">
            {(["activity", "markets"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "is-active" : ""}
                onClick={() => setTab(key)}
              >
                {key === "activity" ? "Activity" : "Markets"}
              </button>
            ))}
            {tab === "activity" && !mainnetPreview ? (
              <Link href="/activity" className="overview-v2-more">
                View all <ArrowUpRight size={13} />
              </Link>
            ) : null}
          </div>
          <div className="overview-v2-tabpanel" role="tabpanel">
            {tab === "activity" ? (
              mainnetPreview ? (
                <p className="overview-v2-empty">
                  Testnet payment history stays on testnet.
                </p>
              ) : (
                <ActivityPlaceholder compact />
              )
            ) : (
              <TradeTokenStrip zecBalance={null} />
            )}
          </div>
        </section>

        <nav className="overview-v2-tools" aria-label="Tools">
          {TOOLS.map(({ href, label, note, icon: Icon }) => (
            <Link key={href} href={href} className="overview-v2-tool">
              <Icon size={18} />
              <span>
                <strong>{label}</strong>
                <small>{note}</small>
              </span>
              <ArrowUpRight size={14} className="overview-v2-tool-arrow" />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
