"use client";

import { useState } from "react";
import { runSimulatedEvaluation, type EvaluationReport } from "@/features/payments/evaluation";
import { createVirtualRuntime } from "@/features/payments/runtime";
import { STAGE_NAMES, type StageName } from "@/features/payments/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STAGE_LABELS: Record<StageName, string> = {
  wallet_readiness: "Wallet readiness",
  preflight: "Preflight",
  construction: "Transaction construction",
  proof: "Proof generation",
  signing: "Signing",
  broadcast: "Broadcast submission",
  confirmation: "Block confirmation",
  recipient_detection: "Recipient detection",
};

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value.toString()} ms`;
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100).toString()}%`;
}

export function PerformanceLab() {
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const next = await runSimulatedEvaluation(createVirtualRuntime());
      setReport(next);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Simulated evaluation</CardTitle>
          <CardDescription>
            Compares the baseline schedule with warm optimized preparation. These numbers are not
            Zcash testnet measurements.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => void run()} disabled={running}>
            {running ? "Running…" : "Run simulated evaluation"}
          </Button>
          {report ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">Network</dt>
                <dd className="text-sm">{report.conditions.network}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Software</dt>
                <dd className="text-sm">{report.conditions.softwareVersion}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Device</dt>
                <dd className="text-sm">{report.conditions.device}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Warm-up</dt>
                <dd className="text-sm">{report.warmUpDurationMs} ms, reported separately</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground text-xs">Conditions</dt>
                <dd className="text-sm">{report.conditions.note}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">
              Each mode records successful, failed, and incomplete trials. p95 appears only with at
              least 20 measured samples.
            </p>
          )}
        </CardContent>
      </Card>

      {report ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryCard title="Baseline" summary={report.baseline} />
            <SummaryCard title="Optimized cold start" summary={report.optimizedCold} />
            <SummaryCard title="Optimized warm start" summary={report.optimizedWarm} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Stage comparison</CardTitle>
              <CardDescription>
                Change is optimized warm median minus baseline median. Negative means the simulated
                warm path was shorter. Confirmation is not expected to change.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">
                  Baseline and optimized warm medians for each payment stage
                </caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Stage</th>
                    <th className="py-2 pr-3 font-medium">Baseline</th>
                    <th className="py-2 pr-3 font-medium">Optimized warm</th>
                    <th className="py-2 pr-3 font-medium">Change</th>
                    <th className="py-2 font-medium">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGE_NAMES.map((stage) => {
                    const row = report.comparison.find((item) => item.stage === stage);
                    return (
                      <tr key={stage} className="border-t align-top">
                        <th className="py-2 pr-3 font-medium">{STAGE_LABELS[stage]}</th>
                        <td className="py-2 pr-3">{formatMs(row?.baselineMedianMs ?? null)}</td>
                        <td className="py-2 pr-3">{formatMs(row?.optimizedMedianMs ?? null)}</td>
                        <td className="py-2 pr-3">
                          {formatMs(row?.deltaMs ?? null)}
                          {row?.note ? (
                            <span className="text-muted-foreground mt-1 block text-xs">{row.note}</span>
                          ) : null}
                        </td>
                        <td className="text-muted-foreground py-2">
                          {row?.baselineP95Ms === null ? "Not enough samples" : formatMs(row?.baselineP95Ms ?? null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Failed and incomplete trials</CardTitle>
              <CardDescription>These trials stay in the report.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Baseline failed {report.baseline.failed}, incomplete {report.baseline.incomplete}.
                {report.baseline.failures[0]
                  ? ` First failure: ${report.baseline.failures[0].failureCode ?? "unknown"}.`
                  : ""}
              </p>
              <p>
                Optimized warm failed {report.optimizedWarm.failed}, incomplete{" "}
                {report.optimizedWarm.incomplete}. Optimized cold start is reported separately and
                is not averaged into the warm result.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Experimental probe</CardTitle>
              <CardDescription>{report.experimental.finding}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Not on the payment path</Badge>
                <Badge variant="outline">Not Project Tachyon</Badge>
                <Badge variant="secondary">Simulated</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {report.experimental.name}. Proof timing:{" "}
                {report.experimental.stages.proof.status === "unavailable"
                  ? report.experimental.stages.proof.reason
                  : "measured"}
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({
  title,
  summary,
}: {
  title: string;
  summary: EvaluationReport["baseline"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {summary.measurementKind} · {summary.coldStart ? "cold start" : "warm start"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>Samples in this group: {summary.successful + summary.failed + summary.incomplete}</p>
        <p>Eligible: {summary.eligible}</p>
        <p>Success rate: {formatRate(summary.successRate)}</p>
      </CardContent>
    </Card>
  );
}
