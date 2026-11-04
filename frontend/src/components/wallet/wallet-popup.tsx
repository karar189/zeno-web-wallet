"use client";

import { PaymentQr } from "@/components/payments/payment-qr";
import { AccountGate } from "@/components/session/account-gate";
import {
  catchUpWallet,
  getFaucetInfo,
  getWalletAddress,
  getWalletReadiness,
  submitFaucetClaim,
  WalletServiceError,
} from "@/features/faucet/client";
import { newClaimRequestId } from "@/features/faucet/storage";
import type { WalletAddress, WalletReadiness } from "@/features/faucet/types";
import { formatZatoshis } from "@/features/payments/amount";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import {
  encodePaymentUri,
  validatePaymentRequest,
} from "@/features/payments/payment-request";
import { logoutLiveWallet } from "@/features/session/store";
import { useWalletSession } from "@/features/session/use-wallet-session";
import {
  CipherLoading,
  CipherReveal,
} from "@/components/ui/cipher-loading";
import { playSound } from "@/lib/sound";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Copy,
  Lock,
  RefreshCw,
  Share,
  Shield,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  instantShieldedSpendable,
  TeeSync,
  type InstantState,
} from "@/features/instant-sync/client";

function formatZat(value: string | null | undefined): string {
  if (value === null || value === undefined || !/^\d+$/.test(value)) {
    return "—";
  }
  return formatZatoshis(BigInt(value));
}

function shortAddress(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export type WalletPopupView = "home" | "receive";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view?: WalletPopupView;
  onViewChange?: (view: WalletPopupView) => void;
  /** Embedded: always open, no dropdown layer or close button (dashboard, extension popup). */
  embedded?: boolean;
  /** Extra header action, e.g. "expand view" in the extension popup. */
  headerAction?: React.ReactNode;
};

export function WalletPopup({
  open,
  onOpenChange,
  view: controlledView,
  onViewChange,
  embedded = false,
  headerAction,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const session = useWalletSession();
  const simulated = process.env.NEXT_PUBLIC_WALLET_BACKEND !== "live";
  const unlocked = session.status === "ready" && !session.session.locked;
  const [uncontrolledView, setUncontrolledView] =
    useState<WalletPopupView>("home");
  const view = controlledView ?? uncontrolledView;
  const setView = onViewChange ?? setUncontrolledView;

  useEffect(() => {
    if (!open && !onViewChange) {
      setUncontrolledView("home");
    }
  }, [open, onViewChange]);

  useEffect(() => {
    if (!open || embedded) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (view !== "home") {
          setView("home");
          return;
        }
        onOpenChange(false);
      }
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (panelRef.current?.contains(target)) {
        return;
      }
      const trigger = document.getElementById("wallet-popup-trigger");
      if (trigger?.contains(target)) {
        return;
      }
      onOpenChange(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, onOpenChange, view, embedded]);

  if (!open && !embedded) {
    return null;
  }

  const title =
    view === "receive"
      ? "Receive"
      : simulated
        ? "Wallet"
        : unlocked
          ? "Wallet"
          : "Unlock";

  return (
    <div
      className={embedded ? "wallet-popup-embed" : "wallet-popup-layer"}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={embedded ? "wallet-popup is-embedded" : "wallet-popup"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={titleId}
      >
        <header className="wallet-popup-head">
          <div className="wallet-popup-head-main">
            {view !== "home" ? (
              <button
                type="button"
                className="wallet-popup-icon-btn"
                aria-label="Back"
                onClick={() => setView("home")}
              >
                <ChevronLeft size={16} />
              </button>
            ) : null}
            <div>
              <p className="wallet-popup-eyebrow">Zeno</p>
              <h2 id={titleId}>{title}</h2>
            </div>
          </div>
          {headerAction}
          {embedded ? null : (
            <button
              type="button"
              className="wallet-popup-icon-btn"
              aria-label="Close wallet"
              onClick={() => onOpenChange(false)}
            >
              <X size={16} />
            </button>
          )}
        </header>

        <div className="wallet-popup-body">
          {simulated ? (
            <SimulatedBody onClose={() => onOpenChange(false)} />
          ) : session.status === "loading" ? (
            <p className="wallet-popup-muted">Checking local wallet…</p>
          ) : session.status === "unreachable" ? (
            <p className="wallet-popup-muted">
              Start the local wallet service on loopback, then open this panel
              again.
            </p>
          ) : unlocked ? (
            view === "receive" ? (
              <ReceiveBody />
            ) : (
              <HomeBody
                onClose={() => onOpenChange(false)}
                onReceive={() => setView("receive")}
              />
            )
          ) : (
            <div className="wallet-popup-gate">
              <AccountGate dense />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SimulatedBody({ onClose }: { onClose: () => void }) {
  return (
    <div className="wallet-popup-stack">
      <p className="wallet-popup-muted">
        Simulated mode. Payments run locally without a live vault. Switch to
        live when the wallet service is running.
      </p>
      <Link className="wallet-popup-primary" href="/pay/send" onClick={onClose}>
        Continue to payments
      </Link>
    </div>
  );
}

function HomeBody({
  onClose,
  onReceive,
}: {
  onClose: () => void;
  onReceive: () => void;
}) {
  const { mainnetPreview, network } = usePreferredNetwork();
  const [readiness, setReadiness] = useState<WalletReadiness | null>(null);
  const [address, setAddress] = useState<WalletAddress | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<"shielded" | "transparent" | null>(null);
  // Instant Sync: cached server state shown until local sync finishes; local always wins.
  const openedAt = useRef(0);
  const [instant, setInstant] = useState<InstantState | null>(null);
  const [renderedIn, setRenderedIn] = useState<{ ms: number; source: "instant" | "local" } | null>(null);

  function markRendered(source: "instant" | "local") {
    const ms = performance.now() - openedAt.current;
    setRenderedIn((prev) => prev ?? { ms, source });
  }

  useEffect(() => {
    openedAt.current = performance.now();
    if (mainnetPreview || !TeeSync.available()) return;
    let cancelled = false;
    void TeeSync.ensureRegistered().catch((error: unknown) =>
      console.warn("[instant-sync] register skipped:", error instanceof Error ? error.message : error),
    );
    void TeeSync.getState().then((state) => {
      if (cancelled || !state?.balance || state.status !== "ready") return;
      setInstant(state);
      markRendered("instant");
    });
    return () => {
      cancelled = true;
    };
  }, [mainnetPreview, network]);

  // Reconcile once local sync lands. Spending only ever uses the local numbers.
  useEffect(() => {
    if (!instant?.balance || !readiness?.spendableZatoshis || !/^\d+$/.test(readiness.spendableZatoshis)) return;
    const server = instantShieldedSpendable(instant.balance);
    const local = BigInt(readiness.spendableZatoshis);
    if (server !== local) {
      console.warn(
        `[instant-sync] server shielded spendable ${server} zat != local ${local} zat; showing local.`,
      );
    }
  }, [instant, readiness]);

  async function refresh() {
    if (mainnetPreview) {
      setReadiness(null);
      setAddress(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const [next, addr] = await Promise.all([
        catchUpWallet().catch(() => getWalletReadiness()),
        getWalletAddress().catch(() => null),
      ]);
      setReadiness(next);
      setAddress(addr);
      markRendered("local");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not refresh the wallet.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mainnetPreview) {
      setReadiness(null);
      setAddress(null);
      setNotice(
        "Mainnet preview · testnet balances and addresses are hidden.",
      );
      setBusy(false);
      return;
    }
    void refresh();
  }, [mainnetPreview, network]);

  async function copy(
    value: string | null | undefined,
    kind: "shielded" | "transparent",
  ) {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      playSound("copy");
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setNotice("Clipboard access failed.");
      playSound("error");
    }
  }

  async function requestFaucet() {
    if (mainnetPreview) {
      setNotice(
        "Mainnet preview refuses faucet claims. Switch back to Zcash testnet.",
      );
      playSound("error");
      return;
    }
    setActionBusy("faucet");
    setNotice(null);
    try {
      const info = await getFaucetInfo();
      if (
        typeof info.captchaMode === "string" &&
        info.captchaMode.toLowerCase() !== "none"
      ) {
        setNotice(
          "Faucet needs a browser captcha. Open Fauzec with your shielded address.",
        );
        playSound("error");
        return;
      }
      const requestId = newClaimRequestId();
      const report = await submitFaucetClaim(requestId);
      setNotice(report.note || "Faucet claim submitted. Sync after it confirms.");
      playSound("success");
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof WalletServiceError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Faucet claim failed.",
      );
      playSound("error");
    } finally {
      setActionBusy(null);
    }
  }

  async function lock() {
    setActionBusy("lock");
    try {
      await logoutLiveWallet();
      playSound("tap");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not lock.");
      playSound("error");
    } finally {
      setActionBusy(null);
    }
  }

  const instantBalance = !mainnetPreview && !readiness ? instant?.balance ?? null : null;
  const balancesLoading =
    !mainnetPreview && !instantBalance && (busy || readiness === null);
  const shielded = mainnetPreview
    ? "—"
    : instantBalance
      ? formatZat(instantShieldedSpendable(instantBalance).toString())
      : formatZat(readiness?.spendableZatoshis);
  const transparent = mainnetPreview
    ? "—"
    : instantBalance
      ? formatZat(instantBalance.transparent_spendable)
      : formatZat(readiness?.transparentSpendableZatoshis);
  const ironwood = !mainnetPreview && instant?.balance ? formatZat(instant.balance.ironwood_spendable) : null;

  return (
    <div className="wallet-popup-stack">
      <div className="wallet-popup-balance">
        <div className="wallet-popup-balance-row">
          <span>Shielded</span>
          <button
            type="button"
            className="wallet-popup-icon-btn"
            aria-label="Refresh balances"
            disabled={busy || mainnetPreview}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
        <p className="wallet-popup-amount">
          {balancesLoading ? (
            <CipherLoading
              label="Decrypting shielded balance"
              text="0.00000000"
              length={10}
            />
          ) : (
            <CipherReveal text={shielded} />
          )}{" "}
          <span className="wallet-popup-unit">ZEC</span>
        </p>
        <p className="wallet-popup-sub">
          {mainnetPreview
            ? "Mainnet preview · no live vault connected"
            : balancesLoading ? (
                <>
                  Transparent{" "}
                  <CipherLoading
                    label="Decrypting transparent balance"
                    text="0.0000"
                    length={6}
                  />{" "}
                  ZEC · syncing
                </>
              ) : (
                <>
                  Transparent <CipherReveal text={transparent} /> ZEC ·{" "}
                  {instantBalance ? "verifying locally…" : readiness?.sync ?? "…"}
                </>
              )}
        </p>
        {ironwood ? (
          <p className="wallet-popup-ironwood">
            <span>Ironwood</span>
            <strong>{ironwood} ZEC</strong>
          </p>
        ) : null}
        {renderedIn ? (
          <p
            className={`wallet-popup-sync-badge${renderedIn.source === "instant" ? " is-instant" : ""}`}
            title={
              instant?.stalenessMs != null
                ? `Server state was ${Math.round(instant.stalenessMs / 1000)}s old`
                : undefined
            }
          >
            Synced in {(renderedIn.ms / 1000).toFixed(1)}s · {renderedIn.source}
          </p>
        ) : null}
      </div>

      <div className="wallet-popup-addrs">
        <button
          type="button"
          className="wallet-popup-addr"
          onClick={() => void copy(address?.address, "shielded")}
          disabled={!address?.address || mainnetPreview}
        >
          <span>
            <strong>Shielded</strong>
            <em>
              {mainnetPreview
                ? "Hidden in mainnet preview"
                : address?.address
                  ? (
                      <CipherReveal text={shortAddress(address.address)} />
                    )
                  : busy
                    ? (
                        <CipherLoading
                          label="Decrypting shielded address"
                          text="utest1······"
                          length={12}
                        />
                      )
                    : "—"}
            </em>
          </span>
          {copied === "shielded" ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          type="button"
          className="wallet-popup-addr public"
          onClick={() =>
            void copy(address?.transparentAddress, "transparent")
          }
          disabled={!address?.transparentAddress || mainnetPreview}
        >
          <span>
            <strong>Transparent · public</strong>
            <em>
              {mainnetPreview
                ? "Hidden in mainnet preview"
                : address?.transparentAddress
                  ? (
                      <CipherReveal
                        text={shortAddress(address.transparentAddress)}
                      />
                    )
                  : busy
                    ? (
                        <CipherLoading
                          label="Decrypting transparent address"
                          text="tm··········"
                          length={12}
                        />
                      )
                    : "Unavailable — refresh after unlock"}
            </em>
          </span>
          {!mainnetPreview && address?.transparentAddress ? (
            copied === "transparent" ? (
              <Check size={14} />
            ) : (
              <Copy size={14} />
            )
          ) : null}
        </button>
      </div>
      {!mainnetPreview && !address?.transparentAddress && address?.note ? (
        <p className="wallet-popup-muted">{address.note}</p>
      ) : null}

      <div className="wallet-popup-actions">
        <Link
          href="/pay/send"
          className={`wallet-popup-action ${mainnetPreview ? "pointer-events-none opacity-40" : ""}`}
          aria-disabled={mainnetPreview}
          onClick={(event) => {
            if (mainnetPreview) {
              event.preventDefault();
              return;
            }
            onClose();
          }}
        >
          <ArrowUpRight size={16} />
          Send
        </Link>
        <button
          type="button"
          className="wallet-popup-action"
          disabled={mainnetPreview}
          onClick={() => {
            if (mainnetPreview) {
              return;
            }
            playSound("tap");
            onReceive();
          }}
        >
          <ArrowDownLeft size={16} />
          Receive
        </button>
        <button
          type="button"
          className="wallet-popup-action"
          disabled={actionBusy !== null || mainnetPreview}
          onClick={() => void requestFaucet()}
        >
          <Shield size={16} />
          {actionBusy === "faucet" ? "…" : "Faucet"}
        </button>
        <Link href="/swap" className="wallet-popup-action" onClick={onClose}>
          <ArrowLeftRight size={16} />
          Swap
        </Link>
      </div>

      {address?.transparentAddress && !mainnetPreview ? (
        <Link
          className="wallet-popup-white"
          href={`/pay/send?request=${encodeURIComponent(`zcash:${address.transparentAddress}`)}`}
          onClick={onClose}
        >
          Unshield to my transparent address
        </Link>
      ) : null}

      {notice ? (
        <p className="wallet-popup-notice" role="status">
          {notice}
        </p>
      ) : (
        <p className="wallet-popup-muted">
          {mainnetPreview
            ? "Mainnet preview · faucet and send stay on testnet."
            : "Testnet only. Transparent sends need an explicit privacy opt-out on review."}
        </p>
      )}

      <button
        type="button"
        className="wallet-popup-lock"
        disabled={actionBusy !== null}
        onClick={() => void lock()}
      >
        <Lock size={14} />
        {actionBusy === "lock" ? "Locking…" : "Lock wallet"}
      </button>
    </div>
  );
}

function ReceiveBody() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { mainnetPreview, network } = usePreferredNetwork();
  const [address, setAddress] = useState<string | null>(null);
  const [transparentAddress, setTransparentAddress] = useState<string | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<"shielded" | "transparent" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (mainnetPreview) {
      setAddress(null);
      setTransparentAddress(null);
      setLoading(false);
      setError("Mainnet preview hides testnet receive addresses.");
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    void getWalletAddress()
      .then((result) => {
        if (!cancelled) {
          setAddress(result.address);
          setTransparentAddress(result.transparentAddress ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAddress(null);
          setTransparentAddress(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mainnetPreview, network]);

  const request = useMemo(() => {
    if (!address) {
      return null;
    }
    const validated = validatePaymentRequest({
      recipient: address,
      amountZec: amount.trim().length === 0 ? null : amount.trim(),
    });
    if (!validated.ok) {
      return { ok: false as const, reason: validated.reason };
    }
    return {
      ok: true as const,
      uri: encodePaymentUri(validated.request),
      address,
    };
  }, [address, amount]);

  async function copyValue(value: string, kind: "shielded" | "transparent") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setError(null);
      playSound("copy");
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Clipboard access failed.");
      playSound("error");
    }
  }

  async function share() {
    if (!request?.ok) {
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: "Receive ZEC", text: request.uri });
        return;
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
      }
    }
    await copyValue(request.address, "shielded");
  }

  return (
    <div className="wallet-popup-stack">
      <p className="wallet-popup-muted">
        Share your shielded testnet address. Faucet funding uses this address.
      </p>

      <label className="wallet-popup-amount-field">
        Amount optional
        <input
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="ZEC"
        />
      </label>

      <div className="wallet-popup-qr">
        {loading ? (
          <p className="wallet-popup-muted">
            <CipherLoading
              label="Decrypting receive address"
              text="Decrypting QR"
              length={14}
            />
          </p>
        ) : request?.ok ? (
          <PaymentQr value={request.uri} canvasRef={canvasRef} size={220} />
        ) : (
          <p className="wallet-popup-muted">
            {request?.reason ?? "Address unavailable."}
          </p>
        )}
      </div>

      <button
        type="button"
        className="wallet-popup-addr"
        disabled={!address}
        onClick={() => address && void copyValue(address, "shielded")}
      >
        <span>
          <strong>Shielded (default)</strong>
          <em>
            {address
              ? (
                  <CipherReveal text={shortAddress(address)} />
                )
              : loading
                ? (
                    <CipherLoading
                      label="Decrypting shielded address"
                      text="utest1······"
                      length={12}
                    />
                  )
                : "—"}
          </em>
        </span>
        {copied === "shielded" ? <Check size={14} /> : <Copy size={14} />}
      </button>

      <button
        type="button"
        className="wallet-popup-addr public"
        disabled={!transparentAddress}
        onClick={() =>
          transparentAddress && void copyValue(transparentAddress, "transparent")
        }
      >
        <span>
          <strong>Transparent · public</strong>
          <em>
            {transparentAddress
              ? (
                  <CipherReveal text={shortAddress(transparentAddress)} />
                )
              : loading
                ? (
                    <CipherLoading
                      label="Decrypting transparent address"
                      text="tm··········"
                      length={12}
                    />
                  )
                : "Unavailable — refresh after unlock"}
          </em>
        </span>
        {transparentAddress ? (
          copied === "transparent" ? (
            <Check size={14} />
          ) : (
            <Copy size={14} />
          )
        ) : null}
      </button>

      {error ? <p className="wallet-popup-notice">{error}</p> : null}

      <button
        type="button"
        className="wallet-popup-primary"
        disabled={!request?.ok}
        onClick={() => void share()}
      >
        <Share size={14} />
        Share receive request
      </button>
    </div>
  );
}
