"use client";

import {
  isSoundEnabled,
  playSound,
  setSoundEnabled,
  subscribeSound,
} from "@/lib/sound";
import { cn } from "@/lib/utils";
import { ChevronRight, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { TeeSync } from "@/features/instant-sync/client";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { useTransport } from "@/features/transport/use-transport";

function SettingsRow({
  label,
  detail,
  children,
  className,
}: {
  label: string;
  detail?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-[rgba(244,241,234,0.22)] px-5 py-4 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[12px] tracking-[0.08em] text-[#f7f4ef] uppercase">
          {label}
        </p>
        {detail ? (
          <p className="mt-1.5 font-[var(--font-landing-sans),sans-serif] text-xs leading-relaxed tracking-normal text-[#8c8c8c] normal-case">
            {detail}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SettingsLink({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail?: string;
}) {
  return (
    <Link
      href={href}
      data-sound="nav"
      className="flex items-center justify-between gap-3 border-b border-[rgba(244,241,234,0.22)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[#100e0c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#ffc14a]"
    >
      <div className="min-w-0">
        <p className="text-[12px] tracking-[0.08em] text-[#f7f4ef] uppercase">
          {label}
        </p>
        {detail ? (
          <p className="mt-1.5 font-[var(--font-landing-sans),sans-serif] text-xs leading-relaxed tracking-normal text-[#8c8c8c] normal-case">
            {detail}
          </p>
        ) : null}
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#ffc14a]" strokeWidth={1.6} />
    </Link>
  );
}

function SoundSetting() {
  const enabled = useSyncExternalStore(subscribeSound, isSoundEnabled, () => true);

  return (
    <SettingsRow
      label="Interface sounds"
      detail="Short taps when you press buttons and tabs."
    >
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "Disable interface sounds" : "Enable interface sounds"}
        onClick={() => {
          const next = !isSoundEnabled();
          setSoundEnabled(next);
          if (next) {
            playSound("success");
          }
        }}
        className={cn(
          "relative h-7 w-12 shrink-0 border transition-colors",
          enabled
            ? "border-[#ffc14a] bg-[#ffc14a]/20"
            : "border-[rgba(244,241,234,0.22)] bg-[#050505]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 grid size-6 place-items-center bg-[#0a0a0a] text-[#f7f4ef]/80 transition-[left]",
            enabled ? "left-[1.35rem] text-[#ffc14a]" : "left-0.5",
          )}
        >
          {enabled ? (
            <Volume2 className="size-3.5" strokeWidth={1.6} />
          ) : (
            <VolumeX className="size-3.5" strokeWidth={1.6} />
          )}
        </span>
      </button>
    </SettingsRow>
  );
}

const walletBackend =
  process.env.NEXT_PUBLIC_WALLET_BACKEND === "live" ? "Live wallet service" : "Simulated";

export function SettingsScreen() {
  const { network } = usePreferredNetwork();
  const walletUrl = (
    (network === "mainnet"
      ? process.env.NEXT_PUBLIC_MAINNET_WALLET_URL
      : process.env.NEXT_PUBLIC_WALLET_URL) ??
    (network === "mainnet" ? "http://127.0.0.1:8788" : "http://127.0.0.1:8787")
  ).replace(/\/$/, "");
  return (
    <div className="workspace-page">
      <div className="page-intro">
        <span className="eyebrow">Workspace / settings</span>
        <h1>
          Controls.
          <br />
          <span>Kept local.</span>
        </h1>
        <p>Preferences stay on this device. Nothing here leaves without your say.</p>
      </div>

      <div className="space-y-0 border border-[rgba(244,241,234,0.22)]">
        <section className="border-b border-[rgba(244,241,234,0.22)] bg-[#0a0a0a]">
          <p className="settings-section-label px-5 pt-5 pb-2">Preferences</p>
          <SoundSetting />
        </section>

        <section className="border-b border-[rgba(244,241,234,0.22)] bg-[#0a0a0a]">
          <p className="settings-section-label px-5 pt-5 pb-2">Wallet</p>
          <SettingsRow
            label="Network"
            detail={
              network === "mainnet"
                ? "The header menu is on mainnet. This wallet spends real ZEC. The faucet stays on testnet."
                : "The header menu is on testnet. Funds have no value."
            }
          >
            <span className="settings-chip">
              {network === "mainnet" ? "Mainnet vault" : "Testnet vault"}
            </span>
          </SettingsRow>
          <InstantSyncSetting />
          <SettingsRow label="Connection" detail={walletUrl}>
            <span className="settings-chip max-w-[9rem] truncate">{walletBackend}</span>
          </SettingsRow>
          <NetworkPrivacySetting />
          <SettingsLink
            href="/settings/disclosure"
            label="Auditor view"
            detail="Selective disclosure for viewing keys."
          />
          <SettingsLink
            href="/settings/backup-wallet"
            label="Local backup wallet"
            detail="Browser seed vault (separate from testnet funding)."
          />
        </section>

        <section className="bg-[#0a0a0a]">
          <p className="settings-section-label px-5 pt-5 pb-2">Advanced</p>
          <SettingsLink href="/pay/lab" label="Payment lab" detail="Benchmarks and staging metrics." />
          <SettingsLink href="/activity" label="Activity" detail="Settlement history when available." />
        </section>
      </div>

      <p className="mt-8 text-center text-[10px] tracking-[0.16em] text-[#8c8c8c] uppercase">
        Zeno Wallet · privacy-first desk
      </p>
    </div>
  );
}

function InstantSyncSetting() {
  const enabled = useSyncExternalStore(
    TeeSync.subscribe,
    () => TeeSync.enabled(),
    () => false,
  );
  const available = useSyncExternalStore(
    TeeSync.subscribe,
    () => TeeSync.available(),
    () => false,
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setNote(null);
    try {
      if (enabled) {
        TeeSync.setEnabled(false);
        await TeeSync.forget();
        setNote("Off. The server copy of your viewing key was deleted.");
      } else {
        TeeSync.setEnabled(true);
        await TeeSync.ensureRegistered();
        setNote("On. The first server sync can take a few minutes; the wallet keeps syncing locally meanwhile.");
      }
      playSound("tap");
    } catch (error) {
      setNote(
        `${error instanceof Error ? error.message : "Instant Sync could not register."} It will retry the next time the wallet is unlocked.`,
      );
      playSound("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsRow
      label="Instant Sync"
      detail={
        note ??
        (available
          ? TeeSync.requiresAttestation()
            ? `Instant Sync encrypts your viewing key (never your spending key) to an AWS Nitro Enclave. Before sending, this app verifies the enclave's attestation against the published reproducible build${TeeSync.attestedPcr0() ? ` (PCR0 ${TeeSync.attestedPcr0()!.slice(0, 12)}…)` : ""}, so the server operator cannot read it. Testnet beta.`
            : "Instant Sync shares your viewing key (never your spending key) with our sync server. This server is not attested: its operator can read the key. Testnet beta."
          : "Instant Sync is testnet only and needs NEXT_PUBLIC_INSTANT_SYNC_URL.")
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Instant Sync"
        disabled={busy || (!available && !enabled)}
        onClick={() => void toggle()}
        className={cn(
          "settings-chip min-w-[4.5rem] text-center disabled:opacity-40",
          enabled && "border-[#7ddc8b] text-[#7ddc8b]",
        )}
      >
        {busy ? "…" : enabled ? "On" : "Off"}
      </button>
    </SettingsRow>
  );
}

function NetworkPrivacySetting() {
  const { transport } = useTransport();
  const chip =
    transport.kind === "mixnet"
      ? transport.name
      : transport.kind === "proxy-down"
        ? "Proxy down"
        : transport.kind === "direct"
          ? "Direct"
          : "Unknown";
  const detail =
    transport.kind === "mixnet"
      ? `Lightwalletd and faucet traffic goes through ${transport.name} (SOCKS5 at ${transport.proxy}). The lightwallet server sees the exit, not your IP. Name lookups, swap quotes and Instant Sync still connect directly.`
      : transport.kind === "proxy-down"
        ? `The wallet service is set to use ${transport.name} at ${transport.proxy}, but nothing is listening. It will not fall back to a direct connection: start nym-socks5-client to sync and send again.`
        : transport.kind === "direct"
          ? "Lightwalletd sees your IP address. To hide it, run nym-socks5-client (default port 1080) and restart the wallet service with WALLET_SOCKS5_PROXY=socks5h://127.0.0.1:1080."
          : "Start the live wallet service to see how it reaches lightwalletd.";
  return (
    <SettingsRow label="Network privacy" detail={detail}>
      <span
        className={cn(
          "settings-chip max-w-[9rem] truncate",
          transport.kind === "mixnet" && "border-[#7ddc8b] text-[#7ddc8b]",
          transport.kind === "proxy-down" && "border-[#E7A598] text-[#E7A598]",
        )}
      >
        {chip}
      </span>
    </SettingsRow>
  );
}
