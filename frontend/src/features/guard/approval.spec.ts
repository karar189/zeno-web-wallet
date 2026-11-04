import { afterEach, describe, expect, it } from "vitest";
import { usePaymentStore } from "@/stores/payment-store";
import { PaymentOrchestrator } from "@/features/payments/orchestrator";
import {
  createIdFactory,
  createVirtualRuntime,
} from "@/features/payments/runtime";
import { SimulatedZcashBackend } from "@/features/payments/simulated-backend";
const initial = usePaymentStore.getState();
afterEach(() => usePaymentStore.setState(initial, true));
function draft() {
  const runtime = createVirtualRuntime();
  return new PaymentOrchestrator(
    new SimulatedZcashBackend(runtime),
    runtime,
    createIdFactory(),
  ).createDraft(
    { recipient: `utest1${"q".repeat(35)}`, amountZec: "0.1" },
    "optimized",
  );
}
describe("approval and recovery enforcement", () => {
  it("enforces privacy requirements even when approval is called directly", async () => {
    const record = draft();
    usePaymentStore.setState({ record });
    await usePaymentStore.getState().authorize();
    expect(usePaymentStore.getState().notice).toContain("not been verified");
    expect(usePaymentStore.getState().record).toBe(record);
  });
  it("blocks fresh preparation while an outcome remains unknown", async () => {
    usePaymentStore.setState({
      activity: [
        { ...draft(), statusConfidence: "unknown", phase: "tracking" },
      ],
    });
    expect(
      await usePaymentStore
        .getState()
        .preparePayment({ recipient: "unused", amountZec: "1" }),
    ).toBe("stay");
    expect(usePaymentStore.getState().notice).toContain("unknown outcome");
  });
  it("refuses concurrent approval requests", async () => {
    const record = draft();
    usePaymentStore.setState({ record, busy: "Submitting" });
    await usePaymentStore
      .getState()
      .authorize({ shieldedOnly: false, noSwapProvider: false });
    expect(usePaymentStore.getState().record).toBe(record);
  });
});
