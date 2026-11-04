"use client";

import { networkLabel } from "@/features/network/preference";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { refreshWalletSession } from "@/features/session/store";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type Props = {
  simulated?: boolean;
};

export function NetworkSwitcher({ simulated = false }: Props) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { network, setNetwork } = usePreferredNetwork();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  function select(next: "testnet" | "mainnet") {
    setNetwork(next);
    setOpen(false);
    void refreshWalletSession();
  }

  const label = simulated ? "Simulated wallet" : networkLabel(network);

  return (
    <div className="network-switcher" ref={rootRef}>
      <button
        type="button"
        className={
          open
            ? "network-pill network-switcher-btn open"
            : "network-pill network-switcher-btn"
        }
        data-network={network}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="status-dot" />
        <span>{label}</span>
        <ChevronDown
          size={12}
          className={open ? "network-chevron open" : "network-chevron"}
        />
      </button>
      {open ? (
        <div className="network-menu" id={menuId} role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={network === "testnet"}
            className={
              network === "testnet" ? "network-option active" : "network-option"
            }
            onClick={() => select("testnet")}
          >
            <strong>Zcash testnet</strong>
            <span>Live vault and faucet. Funds have no value.</span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={network === "mainnet"}
            className={
              network === "mainnet" ? "network-option active" : "network-option"
            }
            onClick={() => select("mainnet")}
          >
            <strong>Zcash mainnet</strong>
            <span>Live vault. Sends and receives real ZEC. No faucet.</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
