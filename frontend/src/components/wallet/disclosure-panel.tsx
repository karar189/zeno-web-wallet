"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createDisclosureAccount,
  exportDisclosureKey,
  getDisclosureStatus,
  requestDisclosureExport,
} from "@/features/disclosure/client";
import {
  DISCLOSURE_IRREVERSIBLE_WARNING,
  DISCLOSURE_PRIMARY_WARNING,
  DISCLOSURE_SCOPE_WARNING,
  DISCLOSURE_SENDER_WARNING,
  DISCLOSURE_SERVICE_SPEND_WARNING,
} from "@/features/disclosure/copy";
import type {
  DisclosureExportRequest,
  DisclosureKey,
  DisclosureStatus,
  DisclosureSyncState,
  TransactionDisclosureCapability,
} from "@/features/disclosure/types";
import { formatZatoshis } from "@/features/payments/amount";
import { playSound } from "@/lib/sound";
import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SYNC_LABEL: Record<DisclosureSyncState, string> = {
  synced: "Synced",
  syncing: "Syncing",
  stale: "Stale",
  unknown: "Unknown",
};

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The wallet service did not answer.";
}

function formatZat(value: string | null): string {
  if (value === null) {
    return "Unavailable";
  }
  return `${formatZatoshis(BigInt(value))} ZEC`;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cream/10 bg-cream/5 px-3 py-2.5">
      <dt className="text-[9px] tracking-[0.16em] text-cream/40 uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] text-cream/85">{value}</dd>
    </div>
  );
}

function ScopeNotes() {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-brass/25 bg-brass/10 p-4">
        <div className="flex items-center gap-2">
          <Eye className="size-4 text-brass" strokeWidth={1.6} />
          <p className="text-[10px] tracking-[0.22em] text-brass uppercase">
            What the auditor can see
          </p>
        </div>
        <p className="mt-2 text-[12px] leading-6 text-cream/75">
          {DISCLOSURE_SCOPE_WARNING}
        </p>
      </div>
      <div className="rounded-2xl border border-cream/12 bg-cream/5 p-4">
        <div className="flex items-center gap-2">
          <LockKeyhole className="size-4 text-cream/60" strokeWidth={1.6} />
          <p className="text-[10px] tracking-[0.22em] text-cream/55 uppercase">
            What it cannot do
          </p>
        </div>
        <p className="mt-2 text-[12px] leading-6 text-cream/65">
          {DISCLOSURE_PRIMARY_WARNING}
        </p>
        <p className="mt-2 text-[12px] leading-6 text-cream/65">
          {DISCLOSURE_SENDER_WARNING}
        </p>
      </div>
      <div className="rounded-2xl border border-[#c45c4a]/35 bg-[#c45c4a]/10 p-4 sm:col-span-2">
        <p className="text-[10px] tracking-[0.22em] text-[#e7a598] uppercase">
          Sharing is effectively permanent
        </p>
        <p className="mt-2 text-[12px] leading-6 text-cream/75">
          {DISCLOSURE_IRREVERSIBLE_WARNING}
        </p>
      </div>
    </div>
  );
}

function TransactionDisclosureNote({
  capability,
}: {
  capability: TransactionDisclosureCapability;
}) {
  return (
    <div className="rounded-2xl border border-cream/12 bg-cream/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CircleAlert className="size-4 text-brass" strokeWidth={1.6} />
        <p className="text-[10px] tracking-[0.22em] text-cream/55 uppercase">
          Transaction-specific disclosure
        </p>
        <Badge variant="outline">
          {capability.implemented ? "Available" : "Not implemented"}
        </Badge>
      </div>
      <p className="mt-2 text-[12px] leading-6 text-cream/65">
        {capability.reason}
      </p>
      <ul className="mt-2 space-y-1 text-[12px] leading-5 text-cream/55">
        <li>
          Sapling ZIP 311:{" "}
          {capability.saplingZip311 ? "implemented" : "not implemented"}.
        </li>
        <li>
          Orchard:{" "}
          {capability.orchard
            ? "implemented"
            : "no standardized transaction-specific disclosure implementation"}.
        </li>
      </ul>
      <p className="mt-2 text-[11px] leading-5 text-cream/40">
        This panel does not create, sign, or claim a per-transaction proof.
        Account-level viewing-key access is broader than a single payment.
      </p>
    </div>
  );
}

function KeyBlock({
  label,
  hint,
  value,
  copied,
  onCopy,
}: {
  label: string;
  hint: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-cream/12 bg-ink-2 p-3">
      <p className="text-[9px] tracking-[0.18em] text-cream/45 uppercase">
        {label}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-cream/50">{hint}</p>
      <p className="mt-2 font-mono text-[10px] leading-5 break-all text-cream/85 select-all">
        {value}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        sound="copy"
        className="mt-2"
        onClick={onCopy}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function DisclosurePanel() {
  const [status, setStatus] = useState<DisclosureStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "request" | "export" | null>(
    null,
  );
  const [createAck, setCreateAck] = useState(false);
  const [exportAck, setExportAck] = useState(false);
  const [exportRequest, setExportRequest] =
    useState<DisclosureExportRequest | null>(null);
  const [exported, setExported] = useState<DisclosureKey | null>(null);
  const [copied, setCopied] = useState<"address" | "ufvk" | "uivk" | null>(
    null,
  );
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDisclosureStatus()
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(describeError(caught));
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
  }, []);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
      }
    },
    [],
  );

  async function copyText(
    value: string,
    key: "address" | "ufvk" | "uivk",
  ) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      playSound("copy");
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
      }
      copyTimer.current = window.setTimeout(() => setCopied(null), 4000);
    } catch {
      setError(
        "The browser blocked clipboard access. Select the text and copy it manually.",
      );
      playSound("error");
    }
  }

  async function createAccount() {
    if (!createAck || busy !== null) {
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const next = await createDisclosureAccount();
      setStatus(next);
      setCreateAck(false);
      playSound("success");
    } catch (caught) {
      setError(describeError(caught));
      playSound("error");
    } finally {
      setBusy(null);
    }
  }

  async function requestExport() {
    if (!exportAck || busy !== null) {
      return;
    }
    setBusy("request");
    setError(null);
    try {
      const next = await requestDisclosureExport();
      setExportRequest(next);
      setExported(null);
      playSound("step");
    } catch (caught) {
      setError(describeError(caught));
      playSound("error");
    } finally {
      setBusy(null);
    }
  }

  async function revealKey() {
    if (!exportRequest || !exportAck || busy !== null) {
      return;
    }
    setBusy("export");
    setError(null);
    try {
      const next = await exportDisclosureKey(exportRequest.exportId);
      setExported(next);
      setExportRequest(null);
      playSound("success");
    } catch (caught) {
      setExportRequest(null);
      setExportAck(false);
      setError(
        `${describeError(caught)} An export request is single-use, so request a new one if the key was not shown.`,
      );
      playSound("error");
    } finally {
      setBusy(null);
    }
  }

  function discardKey() {
    setExported(null);
    setExportRequest(null);
    setExportAck(false);
    setCopied(null);
    playSound("lock");
  }

  return (
    <section
      id="disclosure"
      className="glass scroll-mt-6 overflow-hidden rounded-2xl p-4 @sm:rounded-3xl @sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-20 size-64 rounded-full border border-brass/15"
      />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[10px] tracking-[0.3em] text-brass uppercase">
              Selective disclosure
            </p>
            <h2 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-cream @sm:text-2xl">
              Auditor view
            </h2>
            <p className="mt-3 text-sm leading-6 text-cream/70">
              Give an auditor a viewing key for one dedicated account, not the
              primary wallet. The key cannot spend, and the primary account
              stays private.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Zcash Testnet</Badge>
            <Badge variant="outline">Viewing key only</Badge>
            <Badge
              variant={status?.created ? "default" : "secondary"}
            >
              {status?.created ? "Account ready" : "Not created"}
            </Badge>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex gap-2 rounded-xl border border-[#c45c4a]/40 bg-[#c45c4a]/10 p-3 text-[12px] leading-5 text-[#e7a598]"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
            <p>{error}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 flex items-center gap-3 text-sm text-cream/60">
            <LoaderCircle className="size-4 animate-spin" />
            Checking the wallet service for a disclosure account…
          </div>
        ) : null}

        {!loading && status ? (
          <>
            <ScopeNotes />

            {!status.created ? (
              <div className="mt-5 rounded-2xl border border-brass/25 bg-brass/10 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck
                    className="size-4 text-brass"
                    strokeWidth={1.6}
                  />
                  <p className="text-[10px] tracking-[0.22em] text-brass uppercase">
                    Step 1 · Create the dedicated account
                  </p>
                </div>
                <p className="mt-2 text-[12px] leading-6 text-cream/75">
                  The wallet service derives a second ZIP 32 account from the
                  same local seed. It has its own shielded address and its own
                  viewing key. The primary account is not included in any
                  export.
                </p>
                <p className="mt-2 text-[12px] leading-6 text-cream/65">
                  {DISCLOSURE_SERVICE_SPEND_WARNING}
                </p>
                <label className="mt-4 flex cursor-pointer items-start gap-3 text-[12px] leading-5 text-cream/70">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[#e4c27a]"
                    checked={createAck}
                    disabled={busy !== null}
                    onChange={(event) => setCreateAck(event.target.checked)}
                  />
                  <span>
                    I understand this creates a second account under the same
                    seed. Its viewing key will cover only this account, and a
                    shared key cannot be reliably revoked.
                  </span>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4"
                  disabled={!createAck || busy !== null}
                  onClick={() => void createAccount()}
                >
                  {busy === "create" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  {busy === "create"
                    ? "Creating account…"
                    : "Create disclosure account"}
                </Button>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-1 gap-4">
                  <div className="rounded-2xl border border-cream/12 bg-ink-2 p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] tracking-[0.24em] text-cream/50 uppercase">
                        Disclosure account address
                      </p>
                      <Badge variant="secondary">
                        Account #{status.accountIndex ?? 1}
                      </Badge>
                    </div>
                    <p className="mt-3 font-mono text-[11px] leading-5 break-all text-cream/80 select-all">
                      {status.address ??
                        "The wallet service did not report an address."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      sound="copy"
                      className="mt-3"
                      disabled={!status.address}
                      onClick={() =>
                        void copyText(status.address ?? "", "address")
                      }
                    >
                      {copied === "address" ? <Check /> : <Copy />}
                      {copied === "address" ? "Copied address" : "Copy address"}
                    </Button>
                    <p className="mt-3 text-[11px] leading-5 text-cream/45">
                      Funding this address is optional. It is separate from the
                      Fund my wallet address, and activity on the primary
                      account is not visible through this account&apos;s
                      viewing key.
                    </p>
                  </div>
                  <dl className="grid grid-cols-2 gap-3">
                    <InfoCell
                      label="Sync"
                      value={SYNC_LABEL[status.sync]}
                    />
                    <InfoCell
                      label="Birthday height"
                      value={
                        status.birthdayHeight === null
                          ? "Unavailable"
                          : String(status.birthdayHeight)
                      }
                    />
                    <InfoCell
                      label="Detected"
                      value={formatZat(status.detectedZatoshis)}
                    />
                    <InfoCell
                      label="Spendable by this service"
                      value={formatZat(status.spendableZatoshis)}
                    />
                  </dl>
                </div>
                <p className="text-[12px] leading-6 text-cream/55">
                  {status.note}
                </p>

                {exported ? (
                  <div className="rounded-2xl border border-amber-300/30 bg-amber-300/5 p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <KeyRound
                          className="size-4 text-amber-200"
                          strokeWidth={1.6}
                        />
                        <p className="text-[10px] tracking-[0.22em] text-amber-200 uppercase">
                          Viewing key revealed once
                        </p>
                      </div>
                      <Badge variant="secondary">
                        Account #{exported.accountIndex}
                      </Badge>
                    </div>
                    <p className="mt-2 text-[12px] leading-6 text-cream/70">
                      This export is single-use. The service will not show this
                      key again for this request, and this browser does not
                      store it. Hide it or reload the page and the key is gone
                      from this screen.
                    </p>
                    <KeyBlock
                      label="Unified Full Viewing Key (UFVK)"
                      hint="Covers incoming activity and outgoing notes created by this account, including recipient addresses, amounts, and memos."
                      value={exported.ufvk}
                      copied={copied === "ufvk"}
                      onCopy={() => void copyText(exported.ufvk, "ufvk")}
                    />
                    <KeyBlock
                      label="Unified Incoming Viewing Key (UIVK)"
                      hint="Incoming activity only. Share this instead of the UFVK when the auditor does not need outgoing history."
                      value={exported.uivk}
                      copied={copied === "uivk"}
                      onCopy={() => void copyText(exported.uivk, "uivk")}
                    />
                    <p className="mt-3 text-[11px] leading-5 text-cream/50">
                      {exported.warning}
                    </p>
                    <Button
                      type="button"
                      variant="destructive"
                      className="mt-4"
                      onClick={discardKey}
                    >
                      <LockKeyhole />
                      Hide and discard from this page
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-cream/12 bg-cream/5 p-4 sm:p-5">
                    <p className="text-[10px] tracking-[0.22em] text-cream/55 uppercase">
                      Step 2 · Export the viewing key
                    </p>
                    <p className="mt-2 text-[12px] leading-6 text-cream/70">
                      The export returns the dedicated account&apos;s UFVK and
                      its derived UIVK. Nothing is released until you confirm
                      the warning and reveal the key.
                    </p>
                    <label className="mt-4 flex cursor-pointer items-start gap-3 text-[12px] leading-5 text-cream/70">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-[#e4c27a]"
                        checked={exportAck}
                        disabled={busy !== null}
                        onChange={(event) =>
                          setExportAck(event.target.checked)
                        }
                      />
                      <span>
                        I understand the auditor will see this account&apos;s
                        incoming and outgoing history, cannot spend, and that
                        sharing the key cannot be reliably revoked.
                      </span>
                    </label>

                    {exportRequest ? (
                      <div className="mt-4 rounded-xl border border-brass/30 bg-brass/10 p-4">
                        <p className="text-[10px] tracking-[0.18em] text-brass uppercase">
                          Export request ready
                        </p>
                        <p className="mt-1 font-mono text-[11px] break-all text-cream/75">
                          {exportRequest.exportId}
                        </p>
                        <p className="mt-2 text-[11px] leading-5 text-cream/55">
                          No key has been released. This request is single-use
                          and expires about two minutes after it was created.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={!exportAck || busy !== null}
                            onClick={() => void revealKey()}
                          >
                            {busy === "export" ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <KeyRound />
                            )}
                            {busy === "export"
                              ? "Revealing…"
                              : "Reveal viewing key once"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={discardKey}
                          >
                            Cancel request
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        className="mt-4"
                        disabled={!exportAck || busy !== null}
                        onClick={() => void requestExport()}
                      >
                        {busy === "request" ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <KeyRound />
                        )}
                        {busy === "request"
                          ? "Preparing export…"
                          : "Request one-time export"}
                      </Button>
                    )}
                  </div>
                )}

                <TransactionDisclosureNote
                  capability={status.transactionDisclosure}
                />
              </div>
            )}
          </>
        ) : null}

        {!loading && !status && !error ? (
          <p className="mt-5 text-sm text-cream/55">
            The disclosure status is unavailable. Start the wallet service and
            reload this page.
          </p>
        ) : null}
      </div>
    </section>
  );
}
