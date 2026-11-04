import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZcashTransactionBackend } from "@/features/payments/backend";
import { parseZecToZatoshis } from "@/features/payments/amount";
import { compareSummaries, percentile95, summarize } from "@/features/payments/benchmark";
import { runSimulatedEvaluation } from "@/features/payments/evaluation";
import { experimentalProbe } from "@/features/payments/experimental-adapter";
import { deriveLifecycle } from "@/features/payments/lifecycle";
import { LiveWalletBackend } from "@/features/payments/live-backend";
import { PaymentOrchestrator } from "@/features/payments/orchestrator";
import { parsePaymentUri } from "@/features/payments/payment-request";
import { createIdFactory, createVirtualRuntime } from "@/features/payments/runtime";
import {
  DEMO_RECIPIENT,
  SimulatedZcashBackend,
} from "@/features/payments/simulated-backend";
import type { Trial } from "@/features/payments/types";

const OTHER_RECIPIENT =
  "utest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

function harness(options?: { preparationTtlMs?: number }) {
  const runtime = createVirtualRuntime();
  const backend = new SimulatedZcashBackend(runtime, options);
  const orchestrator = new PaymentOrchestrator(backend, runtime, createIdFactory());
  return { runtime, backend, orchestrator };
}

async function preparedPayment(amount = "0.1") {
  const setup = harness();
  const draft = setup.orchestrator.createDraft(
    { recipient: DEMO_RECIPIENT, amountZec: amount },
    "baseline",
  );
  const prepared = await setup.orchestrator.prepare(draft);
  return { ...setup, prepared };
}

const LIVE_TXID =
  "f".repeat(64);

type WalletCall = { url: string; method: string; body: unknown };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubWalletFetch(
  responses: Array<unknown | Error | Response>,
): WalletCall[] {
  const calls: WalletCall[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : null,
      });
      const next = responses.shift();
      if (next === undefined) {
        throw new Error(`Unexpected wallet request: ${String(input)}`);
      }
      if (next instanceof Error) {
        throw next;
      }
      return next instanceof Response ? next : jsonResponse(next);
    },
  );
  return calls;
}

function readinessPayload(overrides?: Record<string, unknown>) {
  return {
    sync: "synced",
    spendableZatoshis: "125000000",
    network: "testnet",
    measurement: { status: "measured", durationMs: 12, kind: "observed" },
    note: "Synced to the testnet tip.",
    canSubmit: true,
    blocker: null,
    ...overrides,
  };
}

function quotePayload(overrides?: Record<string, unknown>) {
  return {
    feeZatoshis: "10000",
    note: "Quoted by the wallet service.",
    measurement: { status: "measured", durationMs: 25, kind: "observed" },
    quoteId: "quote_1",
    recipient: DEMO_RECIPIENT,
    amountZatoshis: "10000000",
    expiresAtMs: 1_800_000,
    ...overrides,
  };
}

const SEND_ACCEPTED = {
  outcome: "accepted",
  evidence: {
    source: "backend",
    reference: LIVE_TXID,
    acceptedForBroadcast: true,
    note: "Accepted by lightwalletd.",
  },
  measurement: { status: "measured", durationMs: 40, kind: "observed" },
  txids: [LIVE_TXID],
};

function liveHarness() {
  const runtime = createVirtualRuntime();
  const backend = new LiveWalletBackend();
  const orchestrator = new PaymentOrchestrator(backend, runtime, createIdFactory());
  return { runtime, backend, orchestrator };
}

function liveDraft(orchestrator: PaymentOrchestrator) {
  return orchestrator.createDraft(
    { recipient: DEMO_RECIPIENT, amountZec: "0.1" },
    "baseline",
  );
}

describe("payment requests", () => {
  it("accepts a testnet shielded request without changing the recipient or amount", () => {
    const uri = `zcash:${DEMO_RECIPIENT}?amount=0.10`;
    const parsed = parsePaymentUri(uri);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.request.recipient).toBe(DEMO_RECIPIENT);
    expect(parsed.request.amountZec).toBe("0.10");
    expect(parsed.request.network).toBe("testnet");
  });

  it("rejects malformed, mainnet, and conflicting requests", () => {
    expect(parsePaymentUri("https://example.test").ok).toBe(false);
    expect(parsePaymentUri(`zcash:${DEMO_RECIPIENT}?amount=0.1&amount=0.2`).ok).toBe(false);
    expect(parsePaymentUri(`zcash:${DEMO_RECIPIENT}?address=${OTHER_RECIPIENT}`).ok).toBe(false);
    expect(parsePaymentUri("zcash:zs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq").ok).toBe(false);
    expect(parsePaymentUri("zcash:t1aaaaaaaaaaaaaaaaaaaa?amount=1").ok).toBe(false);
    expect(parseZecToZatoshis("1e-3").ok).toBe(false);
    expect(parseZecToZatoshis("0").ok).toBe(false);
    expect(parseZecToZatoshis("0.000000001").ok).toBe(false);
  });

  it("accepts transparent testnet recipients as an opt-in pool", () => {
    const transparent = `tm${"1".repeat(33)}`;
    const parsed = parsePaymentUri(`zcash:${transparent}?amount=0.05`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.pool).toBe("transparent");
    expect(parsed.request.recipient).toBe(transparent);
  });
});

describe("payment orchestrator", () => {
  it("prepares without authorizing or submitting", async () => {
    const { backend, prepared } = await preparedPayment();
    expect(prepared.phase).toBe("awaiting_approval");
    expect(prepared.authorization).toBeNull();
    expect(prepared.submission).toBeNull();
    expect(backend.submitCount).toBe(0);
    expect(deriveLifecycle(prepared).state).toBe("awaiting_approval");
    expect(prepared.stages.proof).toMatchObject({ status: "unavailable" });
    expect(prepared.stages.signing).toMatchObject({ status: "unavailable" });
  });

  it("keeps submission, confirmation, and detection as separate evidence", async () => {
    const { orchestrator, prepared } = await preparedPayment();
    const submitted = await orchestrator.authorizeAndSubmit(prepared);
    expect(deriveLifecycle(submitted)).toMatchObject({
      state: "submitted",
      confirmation: "not_confirmed",
      detection: "not_detected",
    });

    const confirmed = await orchestrator.confirm(submitted);
    expect(deriveLifecycle(confirmed)).toMatchObject({
      state: "confirmed",
      submission: "submitted",
      detection: "not_detected",
    });
    expect(confirmed.stages.confirmation).toMatchObject({
      status: "measured",
      durationMs: 600,
      kind: "simulated",
    });

    const received = await orchestrator.detect(confirmed);
    expect(deriveLifecycle(received)).toMatchObject({
      state: "received",
      confirmation: "confirmed",
      detection: "detected",
    });
  });

  it("does not treat recipient detection as confirmation", async () => {
    const { orchestrator, prepared } = await preparedPayment();
    const submitted = await orchestrator.authorizeAndSubmit(prepared);
    const detected = await orchestrator.detect(submitted);
    expect(deriveLifecycle(detected)).toMatchObject({
      state: "received",
      confirmation: "not_confirmed",
      detection: "detected",
    });
  });

  it("submits once when authorization is repeated", async () => {
    const { backend, orchestrator, prepared } = await preparedPayment();
    const [first, second] = await Promise.all([
      orchestrator.authorizeAndSubmit(prepared),
      orchestrator.authorizeAndSubmit(prepared),
    ]);
    expect(backend.submitCount).toBe(1);
    expect(first.submission?.reference).toBe(second.submission?.reference);
    expect(first.submission?.reference.startsWith("sim_")).toBe(true);
  });

  it("blocks insufficient funds, stale state, and expired preparation before broadcast", async () => {
    const insufficient = await preparedPayment("1.25");
    expect(insufficient.prepared.failure?.code).toBe("insufficient_funds");
    expect(insufficient.backend.submitCount).toBe(0);

    const stale = await preparedPayment();
    stale.backend.forceSync("stale");
    const blocked = await stale.orchestrator.authorizeAndSubmit(stale.prepared);
    expect(blocked.submission).toBeNull();
    expect(stale.backend.submitCount).toBe(0);
    expect(deriveLifecycle(blocked).state).toBe("not_ready");

    const expired = harness({ preparationTtlMs: 0 });
    const draft = expired.orchestrator.createDraft(
      { recipient: DEMO_RECIPIENT, amountZec: "0.1" },
      "baseline",
    );
    const prepared = await expired.orchestrator.prepare(draft);
    const rejected = await expired.orchestrator.authorizeAndSubmit(prepared);
    expect(rejected.submission).toBeNull();
    expect(expired.backend.submitCount).toBe(0);
    expect(rejected.failure?.code).toBe("stale_wallet");
  });

  it("does not retry an indeterminate submission", async () => {
    const { backend, orchestrator, prepared } = await preparedPayment();
    backend.failNextSubmit("indeterminate");
    const unknown = await orchestrator.authorizeAndSubmit(prepared);
    expect(deriveLifecycle(unknown).state).toBe("unknown");
    expect(unknown.submission).toBeNull();
    await orchestrator.authorizeAndSubmit(unknown);
    expect(backend.submitCount).toBe(1);
  });

  it("does not let a failed confirmation check become a confirmation", async () => {
    const { backend, orchestrator, prepared } = await preparedPayment();
    const submitted = await orchestrator.authorizeAndSubmit(prepared);
    backend.failNextConfirm(true);
    const checked = await orchestrator.confirm(submitted);
    expect(deriveLifecycle(checked)).toMatchObject({
      state: "submitted",
      confirmation: "unknown",
    });
  });

  it("does not prepare through a backend that cannot submit", async () => {
    let submits = 0;
    const backend: ZcashTransactionBackend = {
      id: "blocked",
      kind: "live",
      canSubmit: false,
      label: "Blocked wallet service",
      blocker: "The wallet service has no synced spendable balance.",
      honestyNotes: [],
      getReadiness: async () => {
        throw new Error("readiness must not be checked");
      },
      quoteFee: async () => {
        throw new Error("a quote must not be requested");
      },
      construct: async () => {
        throw new Error("construction must not run");
      },
      submit: async () => {
        submits += 1;
        throw new Error("submit must not run");
      },
      confirm: async () => ({
        source: "unavailable",
        met: false,
        criterion: "unused",
        note: "unused",
      }),
      detect: async () => ({
        source: "unavailable",
        detected: false,
        note: "unused",
      }),
    };
    const orchestrator = new PaymentOrchestrator(
      backend,
      createVirtualRuntime(),
      createIdFactory(),
    );
    const draft = orchestrator.createDraft(
      { recipient: DEMO_RECIPIENT, amountZec: "0.1" },
      "baseline",
    );
    const result = await orchestrator.prepare(draft);
    expect(result.failure?.code).toBe("backend_unavailable");
    expect(result.failure?.message).toBe(backend.blocker);
    expect(result.submission).toBeNull();
    expect(result.stages.wallet_readiness).toMatchObject({
      status: "unavailable",
    });
    expect(submits).toBe(0);
  });
});

describe("live wallet backend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prepares from the server quote and sends the exact bound values", async () => {
    const calls = stubWalletFetch([
      readinessPayload(),
      readinessPayload(), // POST /sync: one pass even when synced
      quotePayload(),
      readinessPayload(),
      readinessPayload(), // POST /sync before send
      SEND_ACCEPTED,
    ]);
    const { orchestrator, backend } = liveHarness();
    const prepared = await orchestrator.prepare(liveDraft(orchestrator));

    expect(prepared.phase).toBe("awaiting_approval");
    expect(prepared.dataSource).toBe("live");
    expect(prepared.preparation).toEqual({
      preparationId: "quote_1",
      recipient: DEMO_RECIPIENT,
      amountZatoshis: "10000000",
      feeZatoshis: "10000",
      network: "testnet",
      expiresAtMs: 1_800_000,
    });
    expect(backend.submitCount).toBe(0);
    expect(calls[0]).toMatchObject({ method: "GET", body: null });
    expect(calls[0]?.url).toMatch(/\/api\/wallet\/readiness$/);
    expect(calls[1]).toMatchObject({ method: "POST" });
    expect(calls[1]?.url).toMatch(/\/api\/wallet\/sync$/);
    expect(calls[2]?.url).toMatch(/\/api\/wallet\/quote$/);
    expect(calls[2]?.method).toBe("POST");
    expect(calls[2]?.body).toEqual({
      recipient: DEMO_RECIPIENT,
      amountZatoshis: "10000000",
    });

    const submitted = await orchestrator.authorizeAndSubmit(prepared);
    expect(backend.submitCount).toBe(1);
    expect(submitted.submission?.reference).toBe(LIVE_TXID);
    expect(submitted.submission?.txids).toEqual([LIVE_TXID]);
    expect(calls).toHaveLength(6);
    expect(calls[5]?.url).toMatch(/\/api\/wallet\/send$/);
    expect(calls[5]?.method).toBe("POST");
    expect(calls[5]?.body).toEqual({
      quoteId: "quote_1",
      approved: true,
      recipient: DEMO_RECIPIENT,
      amountZatoshis: "10000000",
      feeZatoshis: "10000",
    });
  });

  it("authorizes a quote that reserved the spendable notes", async () => {
    const calls = stubWalletFetch([
      readinessPayload(),
      readinessPayload(), // POST /sync: one pass even when synced
      quotePayload(),
      readinessPayload({
        spendableZatoshis: "0",
        canSubmit: false,
        blocker:
          "Spendable balance is zero zatoshi because 100000000 zatoshi is locked by an open quote. Complete or let that quote expire before sending.",
        note: "Spendable balance is zero zatoshi because 100000000 zatoshi is locked by an open quote.",
      }),
      readinessPayload({
        spendableZatoshis: "0",
        canSubmit: false,
        blocker:
          "Spendable balance is zero zatoshi because 100000000 zatoshi is locked by an open quote. Complete or let that quote expire before sending.",
        note: "Spendable balance is zero zatoshi because 100000000 zatoshi is locked by an open quote.",
      }),
      SEND_ACCEPTED,
    ]);
    const { orchestrator, backend } = liveHarness();
    const prepared = await orchestrator.prepare(liveDraft(orchestrator));
    const submitted = await orchestrator.authorizeAndSubmit(prepared);

    expect(prepared.phase).toBe("awaiting_approval");
    expect(backend.submitCount).toBe(1);
    expect(submitted.submission?.acceptedForBroadcast).toBe(true);
    expect(calls[5]?.url).toMatch(/\/api\/wallet\/send$/);
  });

  it("refuses a quote whose amount does not match the request", async () => {
    const calls = stubWalletFetch([
      readinessPayload(),
      readinessPayload(), // POST /sync: one pass even when synced
      quotePayload({ amountZatoshis: "20000000" }),
    ]);
    const { orchestrator } = liveHarness();
    const result = await orchestrator.prepare(liveDraft(orchestrator));

    expect(result.failure?.code).toBe("invalid_request");
    expect(result.preparation).toBeNull();
    expect(result.submission).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it("refuses to prepare when the wallet service returns no quote id", async () => {
    stubWalletFetch([
      readinessPayload(),
      readinessPayload(), // POST /sync: one pass even when synced
      quotePayload({ quoteId: null, feeZatoshis: null }),
    ]);
    const { orchestrator } = liveHarness();
    const result = await orchestrator.prepare(liveDraft(orchestrator));

    expect(result.failure?.code).toBe("not_ready");
    expect(result.preparation).toBeNull();
  });

  it("scans to the testnet tip before preparing when the wallet is behind", async () => {
    const calls = stubWalletFetch([
      readinessPayload({
        sync: "syncing",
        canSubmit: false,
        blocker:
          "The wallet is 650 blocks behind the testnet tip. Sync again before sending.",
      }),
      readinessPayload(),
      quotePayload(),
    ]);
    const { orchestrator } = liveHarness();
    const prepared = await orchestrator.prepare(liveDraft(orchestrator));

    expect(prepared.phase).toBe("awaiting_approval");
    expect(prepared.failure).toBeNull();
    expect(calls[0]?.url).toMatch(/\/api\/wallet\/readiness$/);
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toMatch(/\/api\/wallet\/sync$/);
    expect(calls[2]?.url).toMatch(/\/api\/wallet\/quote$/);
  });

  it("blocks preparation when the service reports it cannot submit", async () => {
    const notReady = readinessPayload({
      canSubmit: false,
      blocker: "The wallet has not finished scanning.",
    });
    stubWalletFetch([notReady, notReady]);
    const { orchestrator } = liveHarness();
    const result = await orchestrator.prepare(liveDraft(orchestrator));

    expect(result.failure?.code).toBe("not_ready");
    expect(result.failure?.message).toBe("The wallet has not finished scanning.");
    expect(result.preparation).toBeNull();
  });

  it("treats a transport failure during send as indeterminate and never retries", async () => {
    const calls = stubWalletFetch([
      readinessPayload(),
      readinessPayload(), // POST /sync: one pass even when synced
      quotePayload(),
      readinessPayload(),
      readinessPayload(), // POST /sync before send
      new TypeError("fetch failed"),
    ]);
    const { orchestrator, backend } = liveHarness();
    const prepared = await orchestrator.prepare(liveDraft(orchestrator));
    const unknown = await orchestrator.authorizeAndSubmit(prepared);

    expect(unknown.statusConfidence).toBe("unknown");
    expect(unknown.submission).toBeNull();
    expect(unknown.failure?.code).toBe("rpc_failure");
    expect(backend.submitCount).toBe(1);

    await orchestrator.authorizeAndSubmit(unknown);
    expect(backend.submitCount).toBe(1);
    expect(calls).toHaveLength(6);
  });

  it("treats an explicit wallet-service refusal as rejected", async () => {
    stubWalletFetch([
      readinessPayload(),
      readinessPayload(), // POST /sync: one pass even when synced
      quotePayload(),
      readinessPayload(),
      readinessPayload(), // POST /sync before send
      jsonResponse({ message: "The quote was already used." }, 409),
    ]);
    const { orchestrator, backend } = liveHarness();
    const prepared = await orchestrator.prepare(liveDraft(orchestrator));
    const rejected = await orchestrator.authorizeAndSubmit(prepared);

    expect(rejected.phase).toBe("draft");
    expect(rejected.failure?.code).toBe("rejected");
    expect(rejected.failure?.message).toBe("The quote was already used.");
    expect(rejected.preparation).toBeNull();
    expect(backend.submitCount).toBe(1);
  });
});

describe("benchmarks", () => {
  it("reports simulated baseline and warm optimized trials without inventing p95 or proof time", async () => {
    const report = await runSimulatedEvaluation(createVirtualRuntime());
    expect(report.conditions.note).toMatch(/not observed testnet/i);
    expect(report.warmUpDurationMs).toBe(900);
    expect(report.baseline.stages.wallet_readiness.medianMs).toBe(900);
    expect(report.optimizedWarm.stages.wallet_readiness.medianMs).toBe(40);
    expect(report.optimizedCold.stages.wallet_readiness.medianMs).toBe(900);
    expect(report.baseline.stages.confirmation.medianMs).toBe(600);
    expect(report.optimizedWarm.stages.confirmation.medianMs).toBe(600);
    expect(report.baseline.stages.proof).toMatchObject({
      medianMs: null,
      p95Ms: null,
      unavailableReason: expect.stringContaining("proof"),
    });
    expect(report.baseline.successRate).toBeCloseTo(5 / 6);
    expect(report.baseline.failed).toBe(1);
    expect(report.baseline.incomplete).toBe(1);
    expect(report.baseline.failures[0]?.failureCode).toBe("insufficient_funds");
    expect(report.optimizedWarm.successful).toBe(5);
    expect(report.comparison.find((stage) => stage.stage === "confirmation")?.deltaMs).toBe(0);
    expect(report.experimental.onPaymentPath).toBe(false);
    expect(report.experimental.claimsProjectTachyon).toBe(false);
    expect(experimentalProbe.describe()).toMatch(/not an integration of Project Tachyon/i);
  });

  it("withholds p95 below 20 samples and refuses mixed measurement kinds", () => {
    expect(percentile95(Array.from({ length: 19 }, () => 10))).toBeNull();
    expect(percentile95(Array.from({ length: 20 }, () => 10))).toBe(10);

    const simulated: Trial = {
      id: "sim",
      mode: "baseline",
      measurementKind: "simulated",
      coldStart: true,
      outcome: "success",
      failureCode: null,
      stages: {},
    };
    const observed: Trial = { ...simulated, id: "live", measurementKind: "observed" };
    expect(summarize([simulated, observed], { mode: "baseline", coldStart: true })).toEqual({
      error: "Refusing to mix simulated and observed trials.",
    });

    const experimental: Trial = { ...simulated, id: "exp", mode: "experimental" };
    const onlySimulated = summarize([simulated, experimental], {
      mode: "baseline",
      coldStart: true,
    });
    expect(onlySimulated).toMatchObject({ successful: 1 });

    if ("error" in onlySimulated) {
      return;
    }
    const other = {
      ...onlySimulated,
      measurementKind: "observed" as const,
    };
    expect(compareSummaries(onlySimulated, other)).toEqual([]);
  });
});
