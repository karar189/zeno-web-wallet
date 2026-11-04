"use client";

import { formatZatoshis } from "@/features/payments/amount";
import { catchUpWallet, getWalletReadiness } from "@/features/faucet/client";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import {
  validatePaymentRequest,
  parsePaymentUri,
} from "@/features/payments/payment-request";
import { resolveZcashNameClient } from "@/features/zns/client";
import {
  looksLikeZcashName,
  parseZcashNameInput,
} from "@/features/zns/parse";
import type { ResolvedZcashName } from "@/features/zns/client";
import { playSound } from "@/lib/sound";
import { usePaymentStore } from "@/stores/payment-store";
import {
  ArrowRight,
  ShieldCheck,
  LockKeyhole,
  AtSign,
  LoaderCircle,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type NameLookup =
  | { status: "idle" }
  | { status: "resolving"; display: string }
  | { status: "resolved"; record: ResolvedZcashName }
  | { status: "not_found"; display: string }
  | { status: "error"; display: string; reason: string };

export function SendForm() {
  const request = useSearchParams().get("request");
  return <SendFormFields key={request ?? "manual"} request={request} />;
}

function fieldsFromRequest(request: string | null): {
  recipient: string;
  amount: string;
  error: string | null;
} {
  if (!request) {
    return { recipient: "", amount: "", error: null };
  }
  const parsed = parsePaymentUri(request);
  if (!parsed.ok) {
    return { recipient: "", amount: "", error: parsed.reason };
  }
  return {
    recipient: parsed.request.recipient,
    amount: parsed.request.amountZec ?? "",
    error: null,
  };
}

function SendFormFields({ request }: { request: string | null }) {
  const router = useRouter();
  const { busy, notice, preparePayment } = usePaymentStore();
  const initial = fieldsFromRequest(request);
  const [recipient, setRecipient] = useState(initial.recipient);
  const [amount, setAmount] = useState(initial.amount);
  const [error, setError] = useState<string | null>(initial.error);
  const [spendable, setSpendable] = useState<string | null>(null);
  const [syncingChain, setSyncingChain] = useState(false);
  const [nameLookup, setNameLookup] = useState<NameLookup>({ status: "idle" });
  const simulated = usePaymentStore((state) => state.backendKind === "simulated");
  const { mainnetPreview, network } = usePreferredNetwork();

  useEffect(() => {
    let cancelled = false;
    if (mainnetPreview) {
      setSpendable(null);
      setSyncingChain(false);
      return () => {
        cancelled = true;
      };
    }
    const read = simulated ? getWalletReadiness() : catchUpWallet();
    if (!simulated) {
      setSyncingChain(true);
    }
    void read
      .then((readiness) => {
        if (cancelled || readiness.spendableZatoshis === null) {
          return;
        }
        if (!/^\d+$/.test(readiness.spendableZatoshis)) {
          return;
        }
        setSpendable(formatZatoshis(BigInt(readiness.spendableZatoshis)));
      })
      .catch(() => {
        if (!cancelled) {
          setSpendable(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSyncingChain(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [simulated, mainnetPreview, network]);

  useEffect(() => {
    const parsed = parseZcashNameInput(recipient);
    if (!parsed) {
      setNameLookup({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      setNameLookup({ status: "resolving", display: parsed.display });
      void resolveZcashNameClient({
        query: parsed.display,
        network: "testnet",
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) {
            return;
          }
          if (!result.ok) {
            setNameLookup({
              status: "error",
              display: parsed.display,
              reason: result.reason,
            });
            return;
          }
          if (!result.found) {
            setNameLookup({ status: "not_found", display: result.display });
            return;
          }
          setNameLookup({ status: "resolved", record: result });
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          setNameLookup({
            status: "error",
            display: parsed.display,
            reason:
              reason instanceof Error
                ? reason.message
                : "Name lookup failed.",
          });
        });
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [recipient]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mainnetPreview) {
      setError(
        "Mainnet preview is chrome only. Switch back to Zcash testnet to prepare a payment.",
      );
      playSound("error");
      return;
    }

    const nameInput = looksLikeZcashName(recipient);
    if (nameInput) {
      if (nameLookup.status === "resolving") {
        setError("Wait for the Zcash name to finish resolving.");
        playSound("error");
        return;
      }
      if (nameLookup.status !== "resolved") {
        setError(
          nameLookup.status === "not_found"
            ? `${nameLookup.display} is not registered on the testnet name indexer.`
            : nameLookup.status === "error"
              ? nameLookup.reason
              : "Resolve a Zcash name before preparing this payment.",
        );
        playSound("error");
        return;
      }
    }

    const payoutAddress =
      nameLookup.status === "resolved" && nameInput
        ? nameLookup.record.address
        : recipient;
    const zcashName =
      nameLookup.status === "resolved" && nameInput
        ? nameLookup.record.display
        : null;

    const validated = validatePaymentRequest({
      recipient: payoutAddress,
      amountZec: amount,
    });
    if (!validated.ok) {
      setError(validated.reason);
      playSound("error");
      return;
    }
    if (validated.request.amountZec === null) {
      setError("Enter an amount before preparing this payment.");
      playSound("error");
      return;
    }
    if (
      validated.request.recipient !== payoutAddress.trim() ||
      validated.request.amountZec !== amount.trim()
    ) {
      setError("The payment details could not be kept exactly as entered.");
      playSound("error");
      return;
    }

    setError(null);
    const next = await preparePayment({
      recipient: validated.request.recipient,
      amountZec: validated.request.amountZec,
      zcashName,
    });
    if (next === "review") {
      playSound("step");
      router.push("/pay/review");
      return;
    }
    const state = usePaymentStore.getState();
    if (state.notice) {
      playSound("error");
      return;
    }
    playSound("error");
    setError(
      state.record?.failure
        ? `${state.record.failure.message} ${state.record.failure.recovery}`
        : "The payment could not be prepared.",
    );
  }

  const nameBusy = nameLookup.status === "resolving";

  return (
    <div className="workspace-page">
      <div className="page-intro">
        <span className="eyebrow">
          Shielded payments /{" "}
          {network === "mainnet" ? "Zcash mainnet" : "Zcash testnet"}
        </span>
        <h1>
          A private payment.
          <br />
          <span>On your terms.</span>
        </h1>
        <p>
          {network === "mainnet"
            ? "Prepare the payment, inspect it, then approve. This spends real ZEC."
            : "Type a Zcash name or address, inspect privacy boundaries, then approve. Preparation never sends funds."}
        </p>
      </div>
      <div className="route-layout">
        <form
          className="surface swap-form"
          onSubmit={(event) => void onSubmit(event)}
        >
          <div className="section-heading">
            <h2>Send ZEC</h2>
            <span className="network-pill">
              {simulated
                ? "Simulation"
                : network === "mainnet"
                  ? "Mainnet"
                  : "Testnet"}
            </span>
          </div>
          <label className="field-label">
            Recipient
            <input
              name="recipient"
              autoComplete="off"
              spellCheck={false}
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                setError(null);
              }}
              placeholder={
                network === "mainnet"
                  ? "u1…, zs1…, or t1… (public)"
                  : "david.zcash, utest1…, or tm… (opt-in)"
              }
            />
            <small>
              {network === "mainnet"
                ? "Paste a mainnet address. Transparent t1 / t3 recipients are public."
                : "Pay by Zcash name (`alice.zcash`) via the public ZNS indexer, or paste a testnet address. Transparent `tm…` / `t2…` recipients need an explicit privacy opt-out on review."}
            </small>
          </label>
          <NameResolveStatus lookup={nameLookup} />
          <label className="amount-field">
            <span>Amount to send</span>
            <div>
              <input
                name="amount"
                aria-label="Amount in ZEC"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
              <strong>ZEC</strong>
            </div>
            <small>
              {spendable && !simulated
                ? `${spendable} ZEC spendable · network fee additional`
                : simulated
                  ? "Simulated funds · no monetary value"
                  : "Balance will be checked during preparation"}
            </small>
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="inline-error" role="alert">
              {notice}
            </p>
          )}
          <button
            type="submit"
            disabled={
              busy !== null || syncingChain || mainnetPreview || nameBusy
            }
            className="primary-action"
          >
            {mainnetPreview
              ? "Switch to testnet to prepare"
              : syncingChain
                ? "Syncing with testnet…"
                : nameBusy
                  ? "Resolving name…"
                  : busy === "Preparing"
                    ? "Preparing payment…"
                    : "Prepare and review"}
            <ArrowRight size={17} />
          </button>
          <p className="form-footnote">
            {mainnetPreview
              ? "Mainnet preview never quotes or broadcasts. Use the header network menu to return to testnet."
              : "You will review the name (if used), recipient, exact fee, and privacy requirements before approving."}
          </p>
        </form>
        <div className="space-y-5">
          <section className="privacy-preview">
            <div className="section-heading">
              <span className="eyebrow">A deliberate boundary</span>
              <ShieldCheck size={20} />
            </div>
            <h2>Shielded, from the start.</h2>
            <div className="visibility-row">
              <AtSign size={18} />
              <div>
                <strong>Pay by Zcash name</strong>
                <p>
                  Names like `david.zcash` resolve through the Zcash Names
                  indexer into a shielded unified address, then continue into
                  the same privacy review as a pasted address.
                </p>
              </div>
            </div>
            <div className="visibility-row">
              <LockKeyhole size={18} />
              <div>
                <strong>Transparent is opt-in</strong>
                <p>
                  Shielded recipients stay the default. A transparent
                  {network === "mainnet" ? " mainnet" : " testnet"} send is
                  public on-chain and requires unchecking the shielded
                  requirement on review before approval.
                </p>
              </div>
            </div>
            <div className="visibility-row">
              <ShieldCheck size={18} />
              <div>
                <strong>Approval belongs to you</strong>
                <p>
                  Review is separate from preparation. A broadcast
                  acknowledgment is separate from a mined confirmation. An
                  uncertain outcome is never automatically retried.
                </p>
              </div>
            </div>
          </section>
          <div className="boundary-note">
            <ShieldCheck size={20} />
            <div>
              <strong>
                {simulated
                  ? "You are using a simulated wallet"
                  : network === "mainnet"
                    ? "Mainnet payment"
                    : "Testnet payment"}
              </strong>
              <p>
                {simulated
                  ? "No proof, signature, or broadcast is produced. On review, disable the verified-receiver requirement to explore a simulated send."
                  : network === "mainnet"
                    ? "This spends real ZEC. Review the recipient and fee before you approve."
                    : "This is a real network flow using coins with no monetary value."}
              </p>
              <Link href="/dashboard?wallet=1&view=receive">
                Create a receive request ↗
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NameResolveStatus({ lookup }: { lookup: NameLookup }) {
  if (lookup.status === "idle") {
    return null;
  }

  if (lookup.status === "resolving") {
    return (
      <div className="name-resolve" role="status" aria-live="polite">
        <LoaderCircle size={16} className="name-resolve-spin" />
        <div>
          <strong>Resolving {lookup.display}</strong>
          <p>Asking the Zcash Names testnet indexer…</p>
        </div>
      </div>
    );
  }

  if (lookup.status === "resolved") {
    const short = `${lookup.record.address.slice(0, 18)}…${lookup.record.address.slice(-10)}`;
    return (
      <div className="name-resolve resolved" role="status" aria-live="polite">
        <CircleCheck size={16} />
        <div>
          <strong>{lookup.record.display}</strong>
          <p className="mono">{short}</p>
          <p>
            Resolved via ZNS · height {lookup.record.height.toLocaleString()} ·
            continues to privacy review on prepare
          </p>
        </div>
      </div>
    );
  }

  if (lookup.status === "not_found") {
    return (
      <div className="name-resolve missing" role="status" aria-live="polite">
        <CircleAlert size={16} />
        <div>
          <strong>{lookup.display} is not registered</strong>
          <p>
            No testnet binding was returned. Try another name such as
            `david.zcash`, or paste a testnet address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="name-resolve missing" role="alert">
      <CircleAlert size={16} />
      <div>
        <strong>Could not resolve {lookup.display}</strong>
        <p>{lookup.reason}</p>
      </div>
    </div>
  );
}
