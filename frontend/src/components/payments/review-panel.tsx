"use client";

import Link from "next/link";
import { useState } from "react";
import { PrivacyPreview } from "@/components/privacy/privacy-preview";
import {
  DEFAULT_REQUIREMENTS,
  assessRequirements,
} from "@/features/guard/policy";
import { useRouter } from "next/navigation";
import { formatZatoshis } from "@/features/payments/amount";
import { deriveLifecycle } from "@/features/payments/lifecycle";
import { classifyTestnetRecipient } from "@/features/payments/payment-request";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HonestyNotes } from "@/components/payments/honesty-notes";
import { playSound } from "@/lib/sound";
import { usePaymentStore } from "@/stores/payment-store";
import { useTransport } from "@/features/transport/use-transport";

export function ReviewPanel() {
  const router = useRouter();
  const [requirements, setRequirements] = useState(DEFAULT_REQUIREMENTS);
  const {
    authorize,
    backendKind,
    busy,
    record,
    keepTracking,
    setKeepTracking,
    notice,
  } = usePaymentStore();
  const { transport } = useTransport();
  const board = record ? deriveLifecycle(record) : null;
  const pool = record
    ? classifyTestnetRecipient(record.request.recipient)
    : null;

  const facts = {
    receiver: !pool?.ok
      ? ("unknown" as const)
      : pool.pool === "transparent"
        ? ("transparent" as const)
        : ("shielded" as const),
    provider: false,
    verified:
      Boolean(pool?.ok) &&
      (backendKind !== "live" || Boolean(record?.preparation)),
    network: transport.kind,
  };
  const blockers = assessRequirements(facts, requirements);

  async function onAuthorize() {
    await authorize(requirements);
    const next = usePaymentStore.getState().record;
    playSound(next?.failure ? "error" : "success");
    router.push("/pay/status");
  }

  if (!record || !board || board.state !== "awaiting_approval") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing is waiting for approval</CardTitle>
          <CardDescription>
            {record?.failure
              ? `${record.failure.message} ${record.failure.recovery}`
              : "Prepare a payment from the send screen. Preparation never sends funds."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/pay/send"
            data-sound="nav"
          >
            Back to send
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review payment</CardTitle>
        <CardDescription>
          Check the Zcash name (if used), resolved recipient, and amount. The
          payment is sent only after you authorize it.
        </CardDescription>
      </CardHeader>
      <CardContent className="review-grid">
        <div className="review-summary space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Ready for review</Badge>
            <Badge variant="secondary">
              {backendKind === "live"
                ? "Testnet wallet service"
                : "Simulated backend"}
            </Badge>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {record.request.zcashName ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground text-xs">Zcash name</dt>
                <dd className="text-sm font-medium">{record.request.zcashName}</dd>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs">
                {record.request.zcashName ? "Resolved address" : "Recipient"}
              </dt>
              <dd className="font-mono text-sm break-all">
                {record.request.recipient}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Amount</dt>
              <dd className="text-sm font-medium">
                {record.request.amountZec} ZEC
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Fee</dt>
              <dd className="text-sm font-medium">
                {record.feeZatoshis
                  ? `${formatZatoshis(BigInt(record.feeZatoshis))} ZEC`
                  : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Network</dt>
              <dd className="text-sm font-medium">testnet</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Privacy mode</dt>
              <dd className="text-sm font-medium">
                {!pool?.ok
                  ? "Unsupported"
                  : pool.pool === "transparent"
                    ? "Transparent (public) output"
                    : `${pool.pool} shielded request`}
              </dd>
            </div>
          </dl>
          {pool?.ok && pool.pool === "transparent" ? (
            <p className="text-sm text-[#E7A598]" role="status">
              This send creates a public on-chain output. Uncheck “shielded
              receiver required” below before you can approve.
            </p>
          ) : null}
          <p className="text-muted-foreground text-sm">
            {record.feeNote}{" "}
            {backendKind === "live"
              ? "The wallet service builds and signs the transaction during send. This page does not measure proof or signing time."
              : "This demo does not construct a Sapling or Orchard proof."}{" "}
            {backendKind === "live"
              ? "Shielded unified recipients are checked for a shielded receiver; transparent tm/t2 sends require an explicit privacy opt-out."
              : "A unified address can contain more than one receiver, and this check does not decode receivers."}
          </p>
        </div>
        <div className="review-controls space-y-5">
          <PrivacyPreview
            facts={facts}
            requirements={requirements}
            onChange={setRequirements}
            simulated={backendKind === "simulated"}
            transport={transport}
          />
          <label className="consent-row">
            <input
              type="checkbox"
              checked={keepTracking}
              onChange={(e) => setKeepTracking(e.target.checked)}
            />
            <span>
              Keep a tracking receipt in this tab across refreshes. It contains
              the recipient, amount, and transaction reference in unencrypted
              session storage. Clear it from Activity when finished; browser
              session restore may retain it.
            </span>
          </label>
          {notice && (
            <p role="alert" className="inline-error">
              {notice}
            </p>
          )}
          <HonestyNotes />
          <div className="flex flex-wrap gap-2">
            <Button
              sound="none"
              onClick={() => void onAuthorize()}
              disabled={busy !== null || blockers.length > 0}
            >
              {busy === "Submitting"
                ? "Submitting…"
                : backendKind === "simulated"
                  ? "Run simulated payment"
                  : "Authorize and send testnet ZEC"}
            </Button>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/pay/send"
              data-sound="nav"
            >
              Back
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
