import { compareSummaries, summarize, type Summary } from "@/features/payments/benchmark";
import { experimentalProbe, type ExperimentalResult } from "@/features/payments/experimental-adapter";
import { deriveLifecycle } from "@/features/payments/lifecycle";
import { PaymentOrchestrator } from "@/features/payments/orchestrator";
import { createIdFactory, type Runtime } from "@/features/payments/runtime";
import {
  DEMO_RECIPIENT,
  SimulatedZcashBackend,
} from "@/features/payments/simulated-backend";
import type { PreparationMode, Trial, TrialConditions } from "@/features/payments/types";

export type EvaluationReport = {
  conditions: TrialConditions;
  warmUpDurationMs: number;
  trials: Trial[];
  baseline: Summary;
  optimizedCold: Summary;
  optimizedWarm: Summary;
  comparison: ReturnType<typeof compareSummaries>;
  experimental: ExperimentalResult;
};

const CONDITIONS: TrialConditions = {
  network: "testnet",
  device: "local demo",
  softwareVersion: "shielded-payments-0.1.0-simulated",
  note: "Virtual clock. Delays are the simulated backend schedule, not observed testnet latency.",
};

export async function runSimulatedEvaluation(runtime: Runtime): Promise<EvaluationReport> {
  const backend = new SimulatedZcashBackend(runtime);
  const orchestrator = new PaymentOrchestrator(backend, runtime, createIdFactory("trial"));
  const trials: Trial[] = [];

  for (let index = 0; index < 5; index += 1) {
    trials.push(await runSuccessTrial(orchestrator, backend, "baseline"));
  }
  trials.push(await runFailureTrial(orchestrator, "baseline"));
  trials.push(await runIncompleteTrial(orchestrator, "baseline"));
  trials.push(await runSuccessTrial(orchestrator, backend, "optimized"));
  const warmStarted = runtime.now();
  await backend.warmUp();
  const warmUpDurationMs = runtime.now() - warmStarted;
  for (let index = 0; index < 5; index += 1) {
    trials.push(await runSuccessTrial(orchestrator, backend, "optimized"));
  }

  const baseline = summarize(trials, { mode: "baseline", coldStart: true });
  const optimizedCold = summarize(trials, { mode: "optimized", coldStart: true });
  const optimizedWarm = summarize(trials, { mode: "optimized", coldStart: false });
  if ("error" in baseline || "error" in optimizedCold || "error" in optimizedWarm) {
    throw new Error("Simulated evaluation produced an invalid summary.");
  }

  return {
    conditions: CONDITIONS,
    warmUpDurationMs,
    trials,
    baseline,
    optimizedCold,
    optimizedWarm,
    comparison: compareSummaries(baseline, optimizedWarm),
    experimental: experimentalProbe.run(),
  };
}

async function runSuccessTrial(
  orchestrator: PaymentOrchestrator,
  backend: SimulatedZcashBackend,
  mode: PreparationMode,
): Promise<Trial> {
  const coldStart = !(mode === "optimized" && backend.isWarm);
  const draft = orchestrator.createDraft(
    { recipient: DEMO_RECIPIENT, amountZec: "0.1" },
    mode,
  );
  const prepared = await orchestrator.prepare(draft);
  const submitted = await orchestrator.authorizeAndSubmit(prepared);
  const confirmed = await orchestrator.confirm(submitted);
  const detected = await orchestrator.detect(confirmed);
  const board = deriveLifecycle(detected);
  return {
    id: detected.id,
    mode,
    measurementKind: "simulated",
    coldStart,
    outcome: board.state === "received" ? "success" : "failed",
    failureCode: detected.failure?.code ?? null,
    stages: detected.stages,
  };
}

async function runFailureTrial(
  orchestrator: PaymentOrchestrator,
  mode: PreparationMode,
): Promise<Trial> {
  const draft = orchestrator.createDraft(
    { recipient: DEMO_RECIPIENT, amountZec: "2" },
    mode,
  );
  const prepared = await orchestrator.prepare(draft);
  return {
    id: prepared.id,
    mode,
    measurementKind: "simulated",
    coldStart: true,
    outcome: "failed",
    failureCode: prepared.failure?.code ?? null,
    stages: prepared.stages,
  };
}

async function runIncompleteTrial(
  orchestrator: PaymentOrchestrator,
  mode: PreparationMode,
): Promise<Trial> {
  const draft = orchestrator.createDraft(
    { recipient: DEMO_RECIPIENT, amountZec: "0.05" },
    mode,
  );
  const prepared = await orchestrator.prepare(draft);
  return {
    id: prepared.id,
    mode,
    measurementKind: "simulated",
    coldStart: true,
    outcome: prepared.authorization === null && prepared.submission === null ? "incomplete" : "failed",
    failureCode: null,
    stages: prepared.stages,
  };
}
