import { describe, expect, it } from "vitest";
import { decodeTracking, trackingSnapshot } from "./recovery";
import { PaymentOrchestrator } from "./orchestrator";
import { SimulatedZcashBackend } from "./simulated-backend";
import { createVirtualRuntime, createIdFactory } from "./runtime";
const runtime = createVirtualRuntime();
const orchestrator = new PaymentOrchestrator(
  new SimulatedZcashBackend(runtime),
  runtime,
  createIdFactory(),
);
const draft = orchestrator.createDraft(
  { recipient: `utest1${"q".repeat(30)}`, amountZec: "0.1" },
  "optimized",
);
describe("tracking recovery", () => {
  it("marks interruptions unknown and discards approval", () => {
    const record = trackingSnapshot({
      ...draft,
      phase: "submitting",
      authorization: {
        approvedAtMs: 1,
        recipient: draft.request.recipient,
        amountZatoshis: "10000000",
        network: "testnet",
      },
    });
    expect(record.statusConfidence).toBe("unknown");
    expect(record.authorization).toBeNull();
    expect(record.preparation).toBeNull();
  });
  it("does not restore approvals or other backend modes", () => {
    expect(
      decodeTracking(
        JSON.stringify({
          version: 1,
          records: [{ ...draft, phase: "awaiting_approval" }],
        }),
        "simulated",
      ),
    ).toEqual([]);
    expect(
      decodeTracking(
        JSON.stringify({
          version: 1,
          records: [{ ...draft, phase: "submitting" }],
        }),
        "live",
      ),
    ).toEqual([]);
  });
  it("restores interrupted tracking and tolerates corrupt storage", () => {
    expect(
      decodeTracking(
        JSON.stringify({
          version: 1,
          records: [{ ...draft, phase: "submitting" }],
        }),
        "simulated",
      )[0].statusConfidence,
    ).toBe("unknown");
    expect(decodeTracking("broken", "live")).toEqual([]);
  });
  it("cannot resubmit a recovered interrupted record", async () => {
    const backend = new SimulatedZcashBackend(runtime);
    const engine = new PaymentOrchestrator(backend, runtime, createIdFactory());
    const recovered = trackingSnapshot({ ...draft, phase: "submitting" });
    expect(await engine.authorizeAndSubmit(recovered)).toBe(recovered);
    expect(backend.submitCount).toBe(0);
  });
});
