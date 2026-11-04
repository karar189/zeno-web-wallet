"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Eye, LockKeyhole, ScanLine, X } from "lucide-react";
import { walletServiceUrl } from "@/features/faucet/client";
import { formatZatoshis } from "@/features/payments/amount";
type Report = {
  network: "testnet";
  mode: "view_only";
  detectedZatoshis: string;
  scannedHeight: number;
  tipHeight: number;
  complete: boolean;
  canSpend: false;
};
export function AuditorWorkspace() {
  const [key, setKey] = useState("");
  const [birthday, setBirthday] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  function clear() {
    setKey("");
    setBirthday("");
    setApproved(false);
    setReport(null);
    setError(null);
  }
  async function scan(event: FormEvent) {
    event.preventDefault();
    if (busy || !approved) return;
    setReport(null);
    setError(null);
    if (!key.trim().startsWith("uviewtest1") || key.trim().length > 2048) {
      setError(
        "Use a testnet unified full viewing key, not a seed or spending key.",
      );
      return;
    }
    if (
      !/^\d+$/.test(birthday) ||
      !Number.isSafeInteger(Number(birthday)) ||
      Number(birthday) <= 0 ||
      Number(birthday) > 4294967295
    ) {
      setError("Enter the account's exact positive birthday height.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${walletServiceUrl()}/api/wallet/audit/scan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ufvk: key.trim(),
            birthdayHeight: Number(birthday),
            approved: true,
          }),
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(95000),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? "The scan could not finish.");
      if (
        result.mode !== "view_only" ||
        result.canSpend !== false ||
        result.network !== "testnet" ||
        typeof result.detectedZatoshis !== "string" ||
        !/^\d+$/.test(result.detectedZatoshis)
      )
        throw new Error("The scanner returned an unreadable result.");
      setReport(result);
      setKey("");
      setApproved(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Start the local wallet service and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page">
      <div className="page-intro">
        <span className="eyebrow">Auditor / read-only testnet scanner</span>
        <h1>
          Visibility granted.
          <br />
          <span>Spending excluded.</span>
        </h1>
        <p>
          Inspect an account using its viewing key. The scanner opens a separate
          in-memory database and never opens the spending wallet.
        </p>
      </div>
      <div className="route-layout">
        <form
          className="surface swap-form"
          onSubmit={(event) => void scan(event)}
        >
          <div className="section-heading">
            <h2>Scan a shared account</h2>
            <Eye size={20} />
          </div>
          <fieldset disabled={busy} className="contents">
            <label className="field-label">
              Testnet full viewing key
              <textarea
                autoComplete="off"
                spellCheck={false}
                rows={4}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setReport(null);
                }}
                placeholder="uviewtest1…"
                className="rounded-lg border border-[#383c54] p-3 font-mono text-xs"
              />
              <small>
                A viewing key is sensitive. Use the dedicated account exported
                from Auditor access. No recovery phrase is needed.
              </small>
            </label>
            <label className="field-label">
              Account birthday height
              <input
                inputMode="numeric"
                value={birthday}
                onChange={(e) => {
                  setBirthday(e.target.value);
                  setReport(null);
                }}
                placeholder="From the account export screen"
              />
              <small>
                Use the original birthday. This prototype supports at most 2,000
                blocks of history. A later birthday can omit funds.
              </small>
            </label>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              <span>
                Send this viewing key to my local wallet service for an
                in-memory scan. The service will use its configured testnet
                lightwallet server to fetch chain data.
              </span>
            </label>
          </fieldset>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-action" disabled={busy || !approved}>
            {busy ? "Scanning encrypted notes…" : "Scan with viewing key"}
            <ScanLine size={17} />
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={clear}
          >
            Clear viewing key and result
          </button>
          <p className="form-footnote">
            No key is written to browser storage or the audit database on disk.
            Scan results are account-level, not proof of a single payment.
          </p>
        </form>
        <div className="space-y-5">
          <section className="privacy-preview">
            <span className="eyebrow">Read access has a scope</span>
            <h2>Share an account deliberately.</h2>
            <div className="visibility-row">
              <Eye size={18} />
              <div>
                <strong>Account-wide visibility</strong>
                <p>
                  The holder can inspect activity covered by the viewing key,
                  including future activity. This access cannot reliably be
                  revoked. An exported dedicated-account key excludes your
                  primary account.
                </p>
              </div>
            </div>
            <div className="visibility-row">
              <LockKeyhole size={18} />
              <div>
                <strong>No spending authority</strong>
                <p>
                  The scanner imports the key as ViewOnly. It has no seed,
                  spending key, transaction proposal, or signing path. It does
                  not report spendable funds.
                </p>
              </div>
            </div>
            <Link className="text-link mt-4" href="/settings/disclosure">
              Create or export a dedicated account ↗
            </Link>
          </section>
          {report && (
            <section className="surface quote-result" aria-live="polite">
              <div className="section-heading">
                <span className="eyebrow">Observed / independent scan</span>
                <button aria-label="Clear audit result" onClick={clear}>
                  <X size={17} />
                </button>
              </div>
              <h2>
                {formatZatoshis(BigInt(report.detectedZatoshis))}{" "}
                <span>ZEC detected</span>
              </h2>
              <p>
                {report.complete
                  ? "Scanned through the tip observed at scan start."
                  : "Partial scan. This amount is not a complete account balance."}
              </p>
              <dl>
                <div>
                  <dt>Fully scanned height</dt>
                  <dd>{report.scannedHeight.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Tip at scan start</dt>
                  <dd>{report.tipHeight.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Spending capability</dt>
                  <dd>None</dd>
                </div>
              </dl>
              <p className="form-footnote">
                The viewing key was cleared from the form. The scan database was
                discarded after the response. This is not an audit attestation
                or proof of complete financial records.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
