"use client";

import { useBalancePrivacy } from "@/components/dashboard/home/use-balance-privacy";
import { Button } from "@/components/ui/button";
import {
  WalletServiceError,
  getFaucetClaimStatus,
  getFaucetInfo,
  getWalletAddress,
  getWalletReadiness,
  submitFaucetClaim,
  catchUpWallet,
  syncAndRead,
} from "@/features/faucet/client";
import {
  clearStoredClaim,
  newClaimRequestId,
  readStoredClaim,
  writeStoredClaim,
} from "@/features/faucet/storage";
import {
  deriveFundingView,
  formatCooldown,
  formatTaz,
  formatZatAmount,
} from "@/features/faucet/state";
import type {
  ClaimReport,
  FaucetError,
  FaucetInfo,
  FundingPhase,
  StoredClaim,
  WalletAddress,
  WalletReadiness,
} from "@/features/faucet/types";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { playSound } from "@/lib/sound";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleHelp,
  Copy,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const WATCH_WINDOW_MS = 20 * 60_000;
const POLL_INTERVAL_MS = 15_000;
const SYNC_EVERY_TICKS = 3;

const INFRASTRUCTURE_STATUS_CODES = new Set([
  "faucet_unconfigured",
  "faucet_unreachable",
  "faucet_invalid_response",
  "wallet_unavailable",
  "wallet_service_unreachable",
  "status_rejected",
]);

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The wallet service did not answer.";
}

function isInfrastructureStatusError(error: WalletServiceError): boolean {
  return (
    INFRASTRUCTURE_STATUS_CODES.has(error.code) || error.status === 503
  );
}

function withReport(record: StoredClaim, report: ClaimReport): StoredClaim {
  return {
    ...record,
    report,
    submissionError: null,
    submissionAmbiguous: report.ambiguous,
    lastCheckedAtMs: Date.now(),
    lastFaucetState: report.state,
  };
}

function zecParts(value: bigint | null): { hero: string; compact: string } {
  const raw = formatTaz(value).replace(/ TAZ$/, "");
  if (raw === "Unavailable") {
    return { hero: "—", compact: "—" };
  }
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const shown = trimmed ? trimmed.slice(0, 4) : "";
  return {
    hero: shown ? `${whole}.${shown}` : `${whole}.00`,
    compact: shown ? `${whole}.${shown} ZEC` : `${whole} ZEC`,
  };
}

function shortAddress(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Testnet";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function assetStatus(phase: FundingPhase, tracking: boolean): { label: string; className: string } {
  if (phase === "failed") {
    return { label: "Unavailable", className: "text-[#E7A598]" };
  }
  if (phase === "submitted") {
    return { label: "Requested", className: "text-[#E4C27A]" };
  }
  if (phase === "waiting") {
    return { label: "Waiting", className: "text-[#E4C27A]" };
  }
  if (phase === "detected") {
    return { label: "Confirming", className: "text-[#C4B5FD]" };
  }
  if (tracking && phase === "spendable") {
    return { label: "Received", className: "text-[#C4B5FD]" };
  }
  return { label: "Shielded", className: "text-[#C4B5FD]" };
}

const HERO_BARS = [28, 42, 24, 50, 34, 64, 46, 80];

export function FundWalletPanel() {
  const { mainnet } = usePreferredNetwork();
  const [readiness, setReadiness] = useState<WalletReadiness | null>(null);
  const [address, setAddress] = useState<WalletAddress | null>(null);
  const [info, setInfo] = useState<FaucetInfo | null>(null);
  const [claim, setClaim] = useState<StoredClaim | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [now, setNow] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const { hidden } = useBalancePrivacy();

  const claimRef = useRef<StoredClaim | null>(claim);
  const refreshingRef = useRef(false);
  const submittingRef = useRef(false);
  const tickRef = useRef(0);
  const bootedRef = useRef(false);
  const lastPhaseRef = useRef<FundingPhase | null>(null);
  const refreshRef = useRef<
    (options: { sync: boolean; quiet: boolean }) => Promise<void>
  >(async () => undefined);

  const walletAddress = address?.address ?? info?.walletAddress ?? null;
  const clock = now;
  const view = deriveFundingView({
    readiness,
    claim,
    info,
    address: walletAddress,
    now: clock,
  });
  const watchExpired =
    claim !== null && clock > 0 && clock - claim.createdAtMs > WATCH_WINDOW_MS;
  const paused = autoPaused || watchExpired;

  useEffect(() => {
    claimRef.current = claim;
  }, [claim]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const [readinessResult, addressResult, infoResult] = await Promise.allSettled([
        getWalletReadiness(),
        getWalletAddress(),
        getFaucetInfo(),
      ]);
      if (cancelled) {
        return;
      }
      const problems: string[] = [];
      let resolvedAddress: string | null = null;
      let nextReadiness =
        readinessResult.status === "fulfilled" ? readinessResult.value : null;
      if (nextReadiness) {
        try {
          const synced = await catchUpWallet();
          if (cancelled) {
            return;
          }
          nextReadiness = synced;
        } catch (error) {
          problems.push(
            `Wallet sync: ${error instanceof Error ? error.message : "The wallet sync did not finish."}`,
          );
        }
      }
      if (nextReadiness) {
        setReadiness(nextReadiness);
      } else if (readinessResult.status === "rejected") {
        problems.push(describeError(readinessResult.reason));
      }
      if (addressResult.status === "fulfilled") {
        setAddress(addressResult.value);
        resolvedAddress = addressResult.value.address;
      } else {
        problems.push(describeError(addressResult.reason));
      }
      if (infoResult.status === "fulfilled") {
        setInfo(infoResult.value);
        resolvedAddress = resolvedAddress ?? infoResult.value.walletAddress;
      } else {
        problems.push(describeError(infoResult.reason));
      }

      const stored = readStoredClaim();
      if (stored) {
        if (resolvedAddress && stored.address !== resolvedAddress) {
          clearStoredClaim();
          setNotice(
            "The saved funding record belonged to a different receiving address, so it was cleared.",
          );
        } else {
          setClaim(stored);
        }
      }
      setUiError(problems.length > 0 ? [...new Set(problems)].join(" ") : null);
      setLoading(false);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!claim || view.phase === "spendable" || paused || submitting) {
      return;
    }
    const timer = window.setInterval(() => {
      const current = claimRef.current;
      if (!current) {
        return;
      }
      if (Date.now() - current.createdAtMs > WATCH_WINDOW_MS) {
        setAutoPaused(true);
        return;
      }
      tickRef.current += 1;
      void refreshRef.current({
        sync: tickRef.current % SYNC_EVERY_TICKS === 0,
        quiet: true,
      });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [claim, view.phase, paused, submitting]);

  useEffect(() => {
    const previous = lastPhaseRef.current;
    lastPhaseRef.current = view.phase;
    if (previous === null || previous === view.phase) {
      return;
    }
    if (view.phase === "spendable") {
      playSound("success");
    } else if (view.phase === "detected") {
      playSound("step");
    } else if (view.phase === "failed") {
      playSound("error");
    }
  }, [view.phase]);

  async function refreshClaim(options: { sync: boolean; quiet: boolean }) {
    if (refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    if (!options.quiet) {
      setRefreshing(true);
      setUiError(null);
    }
    const current = claimRef.current;
    const shouldFetchStatus =
      current?.mode === "faucet" &&
      current.requestId !== null &&
      current.report?.state !== "confirmed" &&
      current.report?.state !== "failed" &&
      !submittingRef.current;
    const statusRequest =
      shouldFetchStatus && current?.requestId
        ? getFaucetClaimStatus(current.requestId)
        : Promise.resolve(null);
    const balanceRequest = options.sync
      ? syncAndRead()
      : getWalletReadiness().then((value) => ({
          readiness: value,
          synced: true,
          syncError: null,
        }));
    try {
      const [balanceResult, statusResult] = await Promise.allSettled([
        balanceRequest,
        statusRequest,
      ]);
      if (balanceResult.status === "fulfilled") {
        setReadiness(balanceResult.value.readiness);
        const external = claimRef.current;
        if (external?.mode === "external") {
          persist({ ...external, lastCheckedAtMs: Date.now() });
        }
        if (!options.quiet && balanceResult.value.syncError) {
          setUiError(`Wallet sync: ${balanceResult.value.syncError}`);
        }
      } else if (!options.quiet) {
        setUiError(describeError(balanceResult.reason));
      }

      if (statusResult.status === "fulfilled" && statusResult.value) {
        const latest = claimRef.current;
        if (
          latest &&
          latest.requestId === statusResult.value.requestId
        ) {
          persist(withReport(latest, statusResult.value));
        }
      } else if (statusResult.status === "rejected") {
        const reason = statusResult.reason;
        if (
          reason instanceof WalletServiceError &&
          reason.report &&
          !isInfrastructureStatusError(reason)
        ) {
          const latest = claimRef.current;
          if (latest) {
            persist(withReport(latest, reason.report));
          }
        } else if (!options.quiet) {
          setUiError(`Faucet status: ${describeError(reason)}`);
        }
      }
    } finally {
      refreshingRef.current = false;
      if (!options.quiet) {
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    refreshRef.current = refreshClaim;
  });

  useEffect(() => {
    if (loading || bootedRef.current) {
      return;
    }
    bootedRef.current = true;
    if (claimRef.current) {
      void refreshRef.current({ sync: false, quiet: true });
    }
  }, [loading]);

  function persist(record: StoredClaim) {
    try {
      writeStoredClaim(record);
    } catch (error) {
      setUiError(
        `The funding record could not be updated in this browser. Keep this tab open and do not submit another claim. ${describeError(error)}`,
      );
    }
    setClaim(record);
  }

  function beginExternalWatch(): StoredClaim | null {
    if (
      !walletAddress ||
      !readiness ||
      readiness.detectedZatoshis === null ||
      readiness.spendableZatoshis === null
    ) {
      setUiError(
        "A numeric wallet balance and receiving address are required before watching for funds.",
      );
      return null;
    }
    if (claim) {
      if (!view.canDismiss) {
        return null;
      }
      clearStoredClaim();
    }
    const record: StoredClaim = {
      version: 1,
      mode: "external",
      requestId: null,
      address: walletAddress,
      createdAtMs: Date.now(),
      baselineDetectedZatoshis: readiness.detectedZatoshis,
      baselineSpendableZatoshis: readiness.spendableZatoshis,
      report: null,
      submissionError: null,
      submissionAmbiguous: false,
      lastCheckedAtMs: null,
      lastFaucetState: null,
      websiteUrl: view.websiteUrl ?? "",
    };
    try {
      writeStoredClaim(record);
    } catch (error) {
      setUiError(
        `The balance watch could not be saved in this browser. ${describeError(error)}`,
      );
      return null;
    }
    setClaim(record);
    setAutoPaused(false);
    tickRef.current = 0;
    return record;
  }

  async function startClaim() {
    if (mainnet) {
      setUiError(
        "Faucet is testnet-only. Switch the header network menu back to Zcash testnet.",
      );
      playSound("error");
      return;
    }
    if (submittingRef.current || !view.canStartClaim) {
      return;
    }
    if (
      !walletAddress ||
      readiness?.detectedZatoshis === null ||
      readiness?.detectedZatoshis === undefined ||
      readiness.spendableZatoshis === null ||
      readiness.spendableZatoshis === undefined
    ) {
      setUiError(
        "A numeric wallet balance is required before requesting funds, so no claim was submitted.",
      );
      return;
    }
    if (view.captchaRequired) {
      if (!view.websiteUrl) {
        setUiError(
          "The faucet website URL is not available, so the captcha fallback cannot open. Refresh the faucet details first.",
        );
        return;
      }
      submittingRef.current = true;
      const record = beginExternalWatch();
      if (!record) {
        submittingRef.current = false;
        return;
      }
      setUiError(null);
      setNotice(
        "Fauzec requires a browser captcha, so no API claim was sent. A balance watch is active. Complete the claim on Fauzec with this shielded address; use Copy address if it is not already on your clipboard.",
      );
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(record.address).catch(() => undefined);
      }
      window.open(view.websiteUrl, "_blank", "noopener,noreferrer");
      submittingRef.current = false;
      return;
    }
    const requestId = newClaimRequestId();
    const record: StoredClaim = {
      version: 1,
      mode: "faucet",
      requestId,
      address: walletAddress,
      createdAtMs: Date.now(),
      baselineDetectedZatoshis: readiness.detectedZatoshis,
      baselineSpendableZatoshis: readiness.spendableZatoshis,
      report: null,
      submissionError: null,
      submissionAmbiguous: false,
      lastCheckedAtMs: null,
      lastFaucetState: null,
      websiteUrl: view.websiteUrl ?? "",
    };
    setUiError(null);
    setNotice(null);
    setAutoPaused(false);
    tickRef.current = 0;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      writeStoredClaim(record);
    } catch (error) {
      submittingRef.current = false;
      setSubmitting(false);
      setUiError(
        `This browser could not save the claim record, so no claim was submitted. ${describeError(error)}`,
      );
      return;
    }
    setClaim(record);
    try {
      const report = await submitFaucetClaim(requestId);
      persist(withReport(record, report));
      if (report.ambiguous) {
        setNotice(
          "Fauzec did not return a final state. The request id stays saved and is checked instead of submitting another claim.",
        );
      }
      if (report.error) {
        playSound("error");
      }
    } catch (error) {
      if (error instanceof WalletServiceError && error.report) {
        persist(withReport(record, error.report));
        playSound("error");
      } else {
        const message = describeError(error);
        const submissionError: FaucetError = {
          code:
            error instanceof WalletServiceError
              ? error.code
              : "wallet_service_unreachable",
          message,
          retryable: true,
        };
        persist({
          ...record,
          submissionError,
          submissionAmbiguous: true,
          lastCheckedAtMs: Date.now(),
        });
        setNotice(
          "The claim request did not get a definite answer. The same request id is kept; do not submit another claim until its status is checked.",
        );
        playSound("error");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function checkNow() {
    await refreshClaim({ sync: true, quiet: false });
  }

  async function refreshOverview() {
    if (refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    setRefreshing(true);
    setUiError(null);
    try {
      const [readinessResult, addressResult, infoResult] = await Promise.allSettled([
        syncAndRead(),
        getWalletAddress(),
        getFaucetInfo(),
      ]);
      const problems: string[] = [];
      if (readinessResult.status === "fulfilled") {
        setReadiness(readinessResult.value.readiness);
        if (readinessResult.value.syncError) {
          problems.push(`Wallet sync: ${readinessResult.value.syncError}`);
        }
      } else {
        problems.push(describeError(readinessResult.reason));
      }
      if (addressResult.status === "fulfilled") {
        setAddress(addressResult.value);
        const activeClaim = claimRef.current;
        if (activeClaim && activeClaim.address !== addressResult.value.address) {
          clearStoredClaim();
          setClaim(null);
          setAutoPaused(false);
          setNotice(
            "The wallet's receiving address changed, so the previous funding record was cleared. Funds already received stay in the wallet.",
          );
        }
      } else {
        problems.push(describeError(addressResult.reason));
      }
      if (infoResult.status === "fulfilled") {
        setInfo(infoResult.value);
      } else {
        problems.push(describeError(infoResult.reason));
      }
      if (problems.length > 0) {
        setUiError([...new Set(problems)].join(" "));
      }
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  function startExternalWatch() {
    if (!view.canWatchExternal) {
      return;
    }
    const record = beginExternalWatch();
    if (!record) {
      return;
    }
    setNotice(
      "Watching the wallet for a balance change. Complete the claim on Fauzec with this address. This does not verify that a Fauzec claim exists; only the wallet service decides what is detected and spendable.",
    );
    playSound("step");
  }

  function dismissClaim() {
    if (!view.canDismiss) {
      return;
    }
    clearStoredClaim();
    setClaim(null);
    setAutoPaused(false);
    setNotice(
      "The claim record was dismissed. The wallet balance and any received funds are unchanged.",
    );
  }

  function retryClaim() {
    if (!view.canRetry) {
      return;
    }
    clearStoredClaim();
    setClaim(null);
    setAutoPaused(false);
    setNotice(
      "The failed claim was cleared. A new Fund my wallet request will use a new request id. Check Fauzec's cooldown before claiming again.",
    );
  }

  async function copyText(value: string, key: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is not available.");
      }
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 2200);
    } catch {
      setUiError(
        "Clipboard access failed. Select the text and copy it manually.",
      );
      playSound("error");
    }
  }

  if (mainnet) {
    return (
      <div className="surface activity-empty">
        <CircleAlert className="size-6 text-[#ffc14a]" strokeWidth={1.6} />
        <div>
          <h2>No mainnet faucet</h2>
          <p>
            Faucet is testnet-only. Receive real ZEC on the Receive page, or
            switch the header network menu back to Zcash testnet to claim test
            funds.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-[#8B928E]">
        <LoaderCircle className="size-4 animate-spin" strokeWidth={1.6} />
        Loading wallet
      </div>
    );
  }

  const cooldownActive = view.cooldownUntilMs !== null && view.cooldownUntilMs > clock;
  const spendable = zecParts(view.spendable);
  const detected = zecParts(view.detected);
  const spendableText = hidden ? "••••" : spendable.hero;
  const detectedText = hidden ? "••••" : detected.compact;
  const cardSpendable = hidden ? "••••" : spendable.compact;
  const status = assetStatus(view.phase, claim !== null);
  const networkName = titleCase(readiness?.network || info?.network || "testnet");
  const syncLabel = titleCase(readiness?.sync || "shielded");
  const drip = formatZatAmount(info?.dripZat ?? null)?.replace(/ TAZ$/, " ZEC") ?? null;
  const showFaucetLink = Boolean(view.websiteUrl) && view.phase === "failed";
  const showWatch =
    view.canWatchExternal && !view.canStartClaim && claim?.mode !== "external";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="wallet-page-title">Wallet</h1>
        <button
          type="button"
          aria-label="About this wallet"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
          className="icon-hit grid size-8 place-items-center rounded-full bg-[#1A1F1C] text-[#D0D4D1]"
        >
          <CircleHelp className="size-4" strokeWidth={1.7} />
        </button>
      </div>

      {helpOpen ? (
        <p className="mt-3 text-[13px] leading-5 text-[#8B928E]">
          Testnet ZEC is requested to this shielded address. Spendable updates when the wallet
          detects the note. The faucet never receives your seed.
        </p>
      ) : null}

      <section className="relative mt-5 overflow-hidden rounded-[22px] border border-white/[0.06] bg-[#140E22] px-5 pt-5 pb-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_18%_-10%,rgba(139,92,246,0.46),transparent_58%),radial-gradient(70%_80%_at_90%_120%,rgba(76,29,149,0.5),transparent_62%)]"
        />
        <div className="relative pr-16">
          <p className="text-[13px] text-white/55">Spendable</p>
          <p className="wallet-tabular mt-2 text-[40px] font-semibold leading-none tracking-tight text-white">
            {spendableText}
            {hidden ? null : (
              <span className="ml-1.5 text-[16px] font-medium text-white/70">ZEC</span>
            )}
          </p>
          <p className="mt-5 text-[12px] text-white/45">Detected</p>
          <p className="wallet-tabular mt-1 text-[15px] font-medium text-[#C4B5FD]">{detectedText}</p>
        </div>
        <div aria-hidden="true" className="absolute right-4 bottom-5 flex h-14 items-end gap-[5px]">
          {HERO_BARS.map((height, index) => (
            <span
              key={index}
              className="w-[5px] rounded-full bg-gradient-to-t from-[#5B21B6] to-[#C4B5FD]"
              style={{ height: `${height}%`, opacity: 0.35 + index * 0.08 }}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label={claim ? "Check funding" : "Refresh balance"}
          disabled={refreshing || submitting}
          onClick={() => void (claim ? checkNow() : refreshOverview())}
          className="icon-hit absolute top-4 right-4 grid size-8 place-items-center rounded-full text-white/50"
        >
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} strokeWidth={1.7} />
        </button>
      </section>

      <div className="mt-8 flex items-center gap-2">
        <h2 className="text-[18px] font-semibold tracking-tight text-white">Assets</h2>
        <span className="grid h-5 min-w-5 place-items-center rounded-md bg-white/[0.08] px-1.5 text-[12px] font-medium text-[#C9CFCB]">
          1
        </span>
      </div>

      <article className="mt-3 rounded-[22px] border border-white/[0.06] bg-[#121614] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 overflow-hidden rounded-full">
              <Image
                src="/logos/zcash-coingecko.png"
                alt=""
                width={36}
                height={36}
                className="size-9 scale-[1.35] object-cover"
              />
            </span>
            <p className="truncate text-[15px] font-semibold text-white">
              Zcash <span className="font-medium text-[#8B928E]">ZEC</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#8B928E]">Status</p>
            <p className={`text-[13px] font-medium ${status.className}`}>{status.label}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[12px] text-[#8B928E]">Spendable</p>
            <p className="wallet-tabular mt-1 text-[18px] font-semibold tracking-tight text-white">
              {cardSpendable}
            </p>
            <p className="wallet-tabular mt-1 text-[12px] text-[#6F7773]">Detected {detectedText}</p>
          </div>
          <div>
            <p className="text-[12px] text-[#8B928E]">Network</p>
            <p className="mt-1 text-[18px] font-semibold tracking-tight text-[#C4B5FD]">{networkName}</p>
            <p className="mt-1 text-[12px] text-[#6F7773]">{syncLabel}</p>
          </div>
        </div>
      </article>

      <h2 className="mt-8 text-[18px] font-semibold tracking-tight text-white">Add funds</h2>
      {drip ? <p className="mt-1 text-[12px] text-[#8B928E]">{drip} from the testnet faucet</p> : null}

      <Button
        type="button"
        size="lg"
        sound="step"
        onClick={() => void startClaim()}
        disabled={!view.canStartClaim || submitting}
        className="mt-3 h-12 w-full rounded-2xl"
      >
        {submitting ? "Requesting…" : "Get testnet ZEC"}
      </Button>

      {view.canCheckNow ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => void checkNow()}
          disabled={refreshing || submitting}
          className="mt-2 h-11 w-full rounded-2xl"
        >
          {refreshing ? "Checking…" : "Check now"}
        </Button>
      ) : null}

      <button
        type="button"
        disabled={!walletAddress}
        onClick={() => void copyText(walletAddress ?? "", "address")}
        className="icon-hit mt-3 flex h-auto min-h-0 w-full items-center justify-between rounded-2xl border border-white/[0.06] bg-[#121614] px-4 py-3.5 text-left disabled:opacity-50"
      >
        <span className="min-w-0">
          <span className="block text-[11px] text-[#8B928E]">Shielded address</span>
          <span className="mt-0.5 block truncate font-mono text-[13px] text-white">
            {walletAddress ? shortAddress(walletAddress) : "Address unavailable"}
          </span>
        </span>
        {copiedKey === "address" ? (
          <Check className="size-4 shrink-0 text-[#3DDC97]" strokeWidth={1.8} />
        ) : (
          <Copy className="size-4 shrink-0 text-[#8B928E]" strokeWidth={1.7} />
        )}
      </button>

      {cooldownActive ? (
        <p className="mt-3 text-[12px] text-[#E4C27A]">
          Next request in {formatCooldown(view.cooldownUntilMs, clock)}
        </p>
      ) : null}

      {showFaucetLink || showWatch || view.canRetry || (view.canDismiss && !view.canRetry) ? (
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {showFaucetLink && view.websiteUrl ? (
          <a
            href={view.websiteUrl}
            target="_blank"
            rel="noreferrer noopener"
            data-sound="nav"
            className="inline-flex items-center gap-1 text-[13px] text-[#C9CFCB]"
          >
            Faucet site
            <ArrowUpRight className="size-3.5" strokeWidth={1.7} />
          </a>
        ) : null}
        {showWatch ? (
          <button type="button" onClick={startExternalWatch} className="icon-hit h-auto min-h-0 text-[13px] text-[#C9CFCB]">
            Watch for incoming ZEC
          </button>
        ) : null}
        {view.canRetry ? (
          <button type="button" onClick={retryClaim} className="icon-hit h-auto min-h-0 text-[13px] text-[#C9CFCB]">
            Try again
          </button>
        ) : null}
        {view.canDismiss && !view.canRetry ? (
          <button type="button" onClick={dismissClaim} className="icon-hit h-auto min-h-0 text-[13px] text-[#8B928E]">
            Clear
          </button>
        ) : null}
      </div>
      ) : null}

      {view.phase === "failed" && view.failureMessage ? (
        <div role="alert" className="mt-4 rounded-2xl border border-[#c45c4a]/40 bg-[#c45c4a]/10 px-4 py-3">
          <p className="text-[13px] leading-5 text-[#F0D2CB]">{view.failureMessage}</p>
        </div>
      ) : null}

      {notice ? <p className="mt-4 text-[13px] leading-5 text-[#C9CFCB]">{notice}</p> : null}

      {uiError ? (
        <div role="alert" className="mt-4 flex gap-2 text-[13px] leading-5 text-[#E7A598]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
          <p>{uiError}</p>
        </div>
      ) : null}

      {claim && view.phase !== "spendable" && paused ? (
        <p className="mt-4 text-[13px] leading-5 text-[#8B928E]">
          Automatic checks paused. Use Check now to look again.
        </p>
      ) : null}
    </div>
  );
}
