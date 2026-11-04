"use client";

import { Check, Circle, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChainLinks } from "@/components/payments/chain-links";
import { deriveLifecycle } from "@/features/payments/lifecycle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { playSound } from "@/lib/sound";
import { usePaymentStore } from "@/stores/payment-store";

const rowLabel = {
  submission: "Submission",
  confirmation: "Confirmation",
  detection: "Recipient detection",
} as const;

const DONE = new Set(["submitted", "confirmed", "detected"]);
const POLL_MS = 15_000;

type StepStatus = "done" | "active" | "pending" | "problem";

/** Steps run in order: the first one that is not done is the active one. */
function stepStatuses(values: readonly string[], state: string): StepStatus[] {
  const halted = state === "failed" || state === "unknown" || state === "not_ready";
  let activeFound = false;
  return values.map((value) => {
    if (DONE.has(value)) return "done";
    if (value === "unknown") return "problem";
    if (activeFound) return "pending";
    activeFound = true;
    return halted ? "problem" : "active";
  });
}

function StepIcon({ status }: { status: StepStatus }) {
  const base = "size-4 shrink-0";
  switch (status) {
    case "done":
      return <Check aria-label="Done" className={`${base} text-[#7ddc8b]`} strokeWidth={2.5} />;
    case "active":
      return (
        <LoaderCircle
          aria-label="In progress"
          className={`${base} text-[#f5c25b] motion-safe:animate-spin`}
          strokeWidth={2.5}
        />
      );
    case "problem":
      return <TriangleAlert aria-label="Needs attention" className={`${base} text-[#f08a5d]`} />;
    default:
      return <Circle aria-label="Waiting" className={`${base} text-muted-foreground opacity-50`} />;
  }
}

export function ProgressPanel() {
  const { busy, record, track } = usePaymentStore();
  const board = record ? deriveLifecycle(record) : null;
  const lifecycleState = board?.state ?? null;
  const previousState = useRef<string | null>(null);

  useEffect(() => {
    void track();
  }, [record?.id, record?.submission?.reference, track]);

  useEffect(() => {
    if (lifecycleState === null) {
      return;
    }
    if (previousState.current === null) {
      previousState.current = lifecycleState;
      return;
    }
    if (previousState.current === lifecycleState) {
      return;
    }
    previousState.current = lifecycleState;
    playSound(
      lifecycleState === "received"
        ? "success"
        : lifecycleState === "failed" || lifecycleState === "unknown"
          ? "error"
          : "step",
    );
  }, [lifecycleState]);

  const statuses = board
    ? stepStatuses([board.submission, board.confirmation, board.detection], board.state)
    : [];
  // Keep checking on its own while a submitted payment is still waiting on a step.
  const waiting = Boolean(record?.submission?.acceptedForBroadcast) && statuses.includes("active");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void track(), POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, track]);

  if (!record || !board) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No payment in progress</CardTitle>
          <CardDescription>Authorize a payment to see its status.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/pay/send"
            data-sound="nav"
          >
            Go to send
          </Link>
        </CardContent>
      </Card>
    );
  }

  const rows = [
    ["submission", board.submission],
    ["confirmation", board.confirmation],
    ["detection", board.detection],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{board.message}</CardTitle>
        <CardDescription>{board.evidence}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {board.simulated ? (
          <p className="rounded-lg border px-3 py-2 text-sm">
            Simulated status. No Zcash transaction was broadcast, and no block was observed.
          </p>
        ) : null}
        <Badge variant="outline">{board.state}</Badge>
        {busy ? <p className="text-muted-foreground text-sm">{busy}</p> : null}
        <ol className="space-y-3">
          {rows.map(([key, value], index) => (
            <li key={key} className="flex items-start gap-3">
              <span className="text-muted-foreground w-6 text-sm">{index + 1}</span>
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  {rowLabel[key]}
                  <StepIcon status={statuses[index]} />
                </p>
                <p className="text-muted-foreground text-sm">{value.replaceAll("_", " ")}</p>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <p className="text-muted-foreground text-xs">Reference</p>
          <p className="font-mono text-sm break-all">
            {record.submission?.reference ?? "No broadcast reference"}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {record.submission?.note ?? (record.statusConfidence === "unknown" ? "Submission outcome unknown. Check the wallet before retrying." : "No broadcast evidence is available.")}
          </p>
        </div>
        <ChainLinks submission={record.submission} chain={record.chain} />
        {record.failure ? (
          <p className="text-sm">
            {record.failure.message} {record.failure.recovery}
          </p>
        ) : null}
        {record.submission ? (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void track()}
          >
            {record.detection?.detected && record.confirmation?.met
              ? "Refresh status"
              : "Check status again"}
          </Button>
        ) : null}
        {record.confirmation?.note ? (
          <p className="text-muted-foreground text-sm">{record.confirmation.note}</p>
        ) : null}
        {record.detection?.note ? (
          <p className="text-muted-foreground text-sm">{record.detection.note}</p>
        ) : null}
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard" data-sound="nav">
          Done
        </Link>
      </CardContent>
    </Card>
  );
}
