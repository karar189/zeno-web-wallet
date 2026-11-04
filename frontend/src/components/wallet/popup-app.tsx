"use client";

import { NetworkSwitcher } from "@/components/layout/network-switcher";
import { WalletPopup } from "@/components/wallet/wallet-popup";
import { refreshWalletSession } from "@/features/session/store";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { Maximize2 } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import type { WalletPopupView } from "@/components/wallet/wallet-popup";
import { enablePopupMode, staysInPopup } from "@/features/popup/mode";

/**
 * The wallet as an extension popup. Internal links open the full dashboard in a
 * new tab ("expand view"), the way MetaMask hands off to its expanded page.
 */
export function PopupApp() {
  const simulated = process.env.NEXT_PUBLIC_WALLET_BACKEND !== "live";
  const { network } = usePreferredNetwork();
  const [view, setView] = useState<WalletPopupView>("home");

  useEffect(() => {
    enablePopupMode();
    void refreshWalletSession();
  }, []);

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || !href || !href.startsWith("/")) return;
    if (staysInPopup(href) && !anchor.hasAttribute("data-expand")) return; // send/review/status run in the popup
    event.preventDefault();
    event.stopPropagation();
    if (href.startsWith("/pay/receive") || href.includes("view=receive")) {
      setView("receive");
      return;
    }
    event.stopPropagation();
    window.open(href, "_blank", "noopener");
  }

  return (
    <div className="zeno-app popup-app" data-network={network} onClickCapture={onClickCapture}>
      <div className="popup-app-bar">
        <NetworkSwitcher simulated={simulated} />
        <a
          href="/dashboard"
          data-expand
          className="wallet-popup-icon-btn"
          aria-label="Expand view in a new tab"
          title="Expand view"
        >
          <Maximize2 size={15} />
        </a>
      </div>
      <WalletPopup
        open
        embedded
        onOpenChange={() => setView("home")}
        view={view}
        onViewChange={setView}
      />
    </div>
  );
}
