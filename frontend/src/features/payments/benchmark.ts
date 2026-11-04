import type {
  StageMeasurement,
  StageName,
  Trial,
  TrialOutcome,
} from "@/features/payments/types";
import { STAGE_NAMES } from "@/features/payments/types";

const P95_MINIMUM = 20;

export type StageSummary = {
  measuredSamples: number;
  medianMs: number | null;
  p95Ms: number | null;
  p95Note: string | null;
  unavailableReason: string | null;
};

export type Summary = {
  mode: "baseline" | "optimized";
  coldStart: boolean;
  measurementKind: "simulated" | "observed";
  successful: number;
  failed: number;
  incomplete: number;
  eligible: number;
  successRate: number | null;
  stages: Record<StageName, StageSummary>;
  failures: Array<{ id: string; failureCode: string | null }>;
};

export type StageComparison = {
  stage: StageName;
  baselineMedianMs: number | null;
  optimizedMedianMs: number | null;
  deltaMs: number | null;
  baselineP95Ms: number | null;
  optimizedP95Ms: number | null;
  note: string | null;
};

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function percentile95(values: number[]): number | null {
  if (values.length < P95_MINIMUM) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[index] ?? null;
}

export function summarize(
  trials: Trial[],
  filter: { mode: "baseline" | "optimized"; coldStart: boolean },
): Summary | { error: string } {
  const selected = trials.filter(
    (trial) => trial.mode === filter.mode && trial.coldStart === filter.coldStart,
  );
  const kinds = new Set(selected.map((trial) => trial.measurementKind));
  if (kinds.size > 1) {
    return { error: "Refusing to mix simulated and observed trials." };
  }
  if (selected.length === 0) {
    return { error: "No trials match this comparison." };
  }

  const successful = selected.filter((trial) => trial.outcome === "success");
  const failed = selected.filter((trial) => trial.outcome === "failed");
  const incomplete = selected.filter((trial) => trial.outcome === "incomplete");
  const eligible = successful.length + failed.length;

  return {
    mode: filter.mode,
    coldStart: filter.coldStart,
    measurementKind: selected[0].measurementKind,
    successful: successful.length,
    failed: failed.length,
    incomplete: incomplete.length,
    eligible,
    successRate: eligible === 0 ? null : successful.length / eligible,
    stages: summarizeStages(successful),
    failures: failed.map((trial) => ({
      id: trial.id,
      failureCode: trial.failureCode,
    })),
  };
}

export function compareSummaries(baseline: Summary, optimized: Summary): StageComparison[] {
  if (baseline.measurementKind !== optimized.measurementKind) {
    return [];
  }

  return STAGE_NAMES.map((stage) => {
    const base = baseline.stages[stage];
    const next = optimized.stages[stage];
    const deltaMs =
      base.medianMs === null || next.medianMs === null ? null : next.medianMs - base.medianMs;
    return {
      stage,
      baselineMedianMs: base.medianMs,
      optimizedMedianMs: next.medianMs,
      deltaMs,
      baselineP95Ms: base.p95Ms,
      optimizedP95Ms: next.p95Ms,
      note: stageNote(stage, base, next, deltaMs),
    };
  });
}

function summarizeStages(trials: Trial[]): Record<StageName, StageSummary> {
  return STAGE_NAMES.reduce(
    (summaries, stage) => {
      const measurements = trials.map((trial) => trial.stages[stage]).filter(isMeasurement);
      const measured = measurements.filter(
        (measurement): measurement is Extract<StageMeasurement, { status: "measured" }> =>
          measurement.status === "measured",
      );
      const unavailable = measurements.find((measurement) => measurement.status === "unavailable");
      const durations = measured.map((measurement) => measurement.durationMs);
      summaries[stage] = {
        measuredSamples: measured.length,
        medianMs: median(durations),
        p95Ms: percentile95(durations),
        p95Note:
          measured.length > 0 && measured.length < P95_MINIMUM
            ? "Need at least 20 measured samples for a p95."
            : null,
        unavailableReason:
          measured.length === 0 && unavailable?.status === "unavailable"
            ? unavailable.reason
            : null,
      };
      return summaries;
    },
    {} as Record<StageName, StageSummary>,
  );
}

function isMeasurement(
  measurement: StageMeasurement | undefined,
): measurement is StageMeasurement {
  return measurement !== undefined;
}

function stageNote(
  stage: StageName,
  baseline: StageSummary,
  optimized: StageSummary,
  delta: number | null,
): string | null {
  if (baseline.unavailableReason && optimized.unavailableReason) {
    return "Unavailable. The timing was not inferred.";
  }
  if (stage === "confirmation" || stage === "recipient_detection") {
    return delta === 0
      ? "Unchanged. This optimization does not change Zcash block inclusion."
      : "Confirmation and detection are reported separately from preparation.";
  }
  if (stage === "construction" && delta !== null && delta < 0) {
    return "Shorter construction here is a simulated warm-cache schedule, not a measured prover speedup.";
  }
  return null;
}

export function outcomeOf(record: {
  submission: { acceptedForBroadcast: true } | null;
  failure: { code: Trial["failureCode"] } | null;
  phase: string;
}): TrialOutcome {
  if (record.submission?.acceptedForBroadcast) {
    return "success";
  }
  if (record.failure) {
    return "failed";
  }
  if (record.phase === "awaiting_approval" || record.phase === "preparing" || record.phase === "draft") {
    return "incomplete";
  }
  return "incomplete";
}
