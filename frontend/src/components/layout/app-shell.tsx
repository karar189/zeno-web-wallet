"use client";
import { ZenoMark } from "@/components/brand/zeno-mark";
import { LandingCursor } from "@/components/landing/landing-cursor";
import { NetworkSwitcher } from "@/components/layout/network-switcher";
import {
  WalletPopup,
  type WalletPopupView,
} from "@/components/wallet/wallet-popup";
import { catchUpWallet } from "@/features/faucet/client";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { refreshWalletSession } from "@/features/session/store";
import { useWalletSession } from "@/features/session/use-wallet-session";
import { usePaymentStore } from "@/stores/payment-store";
import { isPopupMode, staysInPopup, subscribePopupMode } from "@/features/popup/mode";
import {
  ArrowLeftRight,
  ChevronDown,
  Eye,
  House,
  List,
  Settings,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";

const navigation = [
  { href: "/dashboard", label: "Wallet", icon: House },
  { href: "/pay/send", label: "Send", icon: Wallet },
  { href: "/swap", label: "Swap", icon: ArrowLeftRight },
  { href: "/activity", label: "Activity", icon: List },
];
const tools = [{ href: "/audit", label: "Auditor", icon: Eye }];

export function AppShell({
  children,
  activePath,
}: {
  children: React.ReactNode;
  activePath: string;
  chrome?: "app" | "focus";
}) {
  const session = useWalletSession();
  const simulated = process.env.NEXT_PUBLIC_WALLET_BACKEND !== "live";
  const { network, mainnet } = usePreferredNetwork();
  const pathname = usePathname();
  const router = useRouter();
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletView, setWalletView] = useState<WalletPopupView>("home");

  useEffect(() => {
    void refreshWalletSession();
  }, []);

  useEffect(() => {
    if (activePath === "/dashboard") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("wallet") !== "1") {
      return;
    }
    const view = params.get("view");
    setWalletView(view === "receive" ? "receive" : "home");
    setWalletOpen(true);
    params.delete("wallet");
    params.delete("view");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router, activePath]);

  const walletScope =
    session.status === "ready"
      ? session.vaults.find((v) => v.hasSession)?.walletId
      : null;
  const unlocked = session.status === "ready" && !session.session.locked;

  useEffect(() => {
    void usePaymentStore.getState().restoreTracking();
  }, [walletScope]);

  useEffect(() => {
    if (simulated || !unlocked) {
      return;
    }
    let cancelled = false;
    const run = () => {
      if (cancelled || document.visibilityState === "hidden") {
        return;
      }
      void catchUpWallet().catch(() => undefined);
    };
    run();
    const timer = window.setInterval(run, 120_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [simulated, unlocked, network]);

  const popupMode = useSyncExternalStore(subscribePopupMode, isPopupMode, () => false);

  if (popupMode) {
    const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href || !href.startsWith("/") || staysInPopup(href)) return;
      event.preventDefault();
      event.stopPropagation();
      window.open(href, "_blank", "noopener");
    };
    const locked =
      !simulated && session.status === "ready" && session.session.locked;
    return (
      <div className="zeno-app popup-app popup-shell" data-network={network} onClickCapture={onClickCapture}>
        <div className="popup-app-bar">
          <Link href="/popup" className="popup-back">
            <ChevronDown size={15} className="popup-back-icon" /> Wallet
          </Link>
          <span className="popup-shell-title">
            {activePath.startsWith("/pay") ? "Send" : "Zeno"}
          </span>
        </div>
        <main id="main-content" className="popup-shell-main">
          {locked ? (
            <div className="wallet-locked-banner" role="status">
              <div>
                <strong>Wallet locked</strong>
                <p>Go back to the wallet to unlock.</p>
              </div>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    );
  }

  const walletLabel =
    session.status === "ready" && !session.session.locked
      ? "Wallet"
      : "Open wallet";

  return (
    <div className="desk zeno-app" data-network={network}>
      <LandingCursor />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="app-sidebar">
        <Link href="/dashboard" className="brand">
          <span>
            <ZenoMark />
          </span>
        </Link>
        <nav aria-label="Primary">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.href.startsWith("/pay")
              ? activePath.startsWith("/pay")
              : activePath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "nav-item active" : "nav-item"}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {active && <span className="active-dot" />}
              </Link>
            );
          })}
        </nav>
        <p className="sidebar-label">Tools</p>
        <nav aria-label="Tools">
          {tools.map((item) => {
            const Icon = item.icon;
            const active = activePath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "nav-item active" : "nav-item"}
              >
                <Icon size={19} />
                <span>{item.label}</span>
                {active && <span className="active-dot" />}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link
            className={
              activePath.startsWith("/settings")
                ? "nav-item active"
                : "nav-item"
            }
            aria-current={
              activePath.startsWith("/settings") ? "page" : undefined
            }
            href="/settings"
          >
            <Settings size={19} /> Settings
          </Link>
        </div>
      </aside>
      <div className="app-body">
        <header className="workspace-header">
          <Link href="/dashboard" className="mobile-brand">
            <ZenoMark />
          </Link>
          <span className="header-context">
            {[...navigation, ...tools].find((item) => item.href === activePath)?.label ??
              (activePath.startsWith("/pay")
                ? "Send"
                : activePath.startsWith("/settings")
                  ? "Settings"
                  : "Wallet")}
          </span>
          <div className="header-status">
            <NetworkSwitcher simulated={simulated} />
            <div className="wallet-launcher" hidden={activePath === "/dashboard"}>
              <button
                id="wallet-popup-trigger"
                type="button"
                className={
                  walletOpen
                    ? "wallet-launcher-btn open"
                    : "wallet-launcher-btn"
                }
                aria-haspopup="dialog"
                aria-expanded={walletOpen}
                onClick={() => setWalletOpen((current) => !current)}
              >
                <Wallet size={15} />
                <span>{walletLabel}</span>
                <ChevronDown
                  size={14}
                  className={walletOpen ? "wallet-chevron open" : "wallet-chevron"}
                />
              </button>
              <WalletPopup
                open={walletOpen}
                onOpenChange={(open) => {
                  setWalletOpen(open);
                  if (!open) {
                    setWalletView("home");
                  }
                }}
                view={walletView}
                onViewChange={setWalletView}
              />
            </div>
            <Link
              href="/settings"
              className="mobile-settings"
              aria-label="Wallet settings"
            >
              <Settings size={19} />
            </Link>
          </div>
        </header>
        <main id="main-content" className="workspace-main">
          {mainnet ? (
            <div className="network-preview-banner" role="status">
              <div>
                <strong>Zcash mainnet</strong>
                <p>
                  This wallet spends real ZEC. The faucet stays on testnet. A
                  swap deposit is a public transparent payment.
                </p>
              </div>
            </div>
          ) : null}
          {!simulated && session.status === "loading" ? (
            <div className="surface session-state" role="status">
              Checking your local wallet…
            </div>
          ) : !simulated &&
            session.status === "ready" &&
            session.session.locked &&
            activePath !== "/dashboard" ? (
            <>
              <div className="wallet-locked-banner" role="status">
                <div>
                  <strong>Wallet locked</strong>
                  <p>Unlock to sync, fund, or send.</p>
                </div>
                <button
                  type="button"
                  className="wallet-launcher-btn"
                  onClick={() => setWalletOpen(true)}
                >
                  <Wallet size={15} />
                  Open wallet
                </button>
              </div>
              {children}
            </>
          ) : (
            children
          )}
        </main>
        <footer className="workspace-footer">
          <span>Zeno Wallet</span>
          <span>
            {simulated
              ? "Simulation · no transactions broadcast"
              : mainnet
                ? "Mainnet · real ZEC"
                : "Testnet funds have no monetary value"}
          </span>
        </footer>
      </div>
    </div>
  );
}
