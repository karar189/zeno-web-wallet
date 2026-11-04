import type {
  ConstructInput,
  QuoteInput,
  SubmitInput,
  ZcashTransactionBackend,
} from "@/features/payments/backend";
import type {
  ConfirmationEvidence,
  ConstructResult,
  DetectionEvidence,
  FeeQuote,
  PreparationMode,
  Readiness,
  SubmitResult,
  SyncState,
} from "@/features/payments/types";
import { SIMULATED_HONESTY_NOTES } from "@/features/payments/types";
import {
  createIdFactory,
  type Runtime,
} from "@/features/payments/runtime";

export const DEMO_SPENDABLE_ZATOSHIS = BigInt(125_000_000);
export const DEMO_FEE_ZATOSHIS = BigInt(10_000);
export const DEMO_RECIPIENT =
  "ztestsapling1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

export const SIMULATED_SCHEDULE = {
  baseline: {
    readiness: 900,
    preflight: 500,
    construction: 700,
    broadcast: 400,
  },
  optimizedWarm: {
    readiness: 40,
    preflight: 60,
    construction: 180,
    broadcast: 400,
  },
  confirmation: 600,
  detection: 500,
} as const;

const PROOF_UNAVAILABLE = {
  status: "unavailable" as const,
  reason: "This backend does not generate a zero-knowledge proof.",
};

const SIGNING_UNAVAILABLE = {
  status: "unavailable" as const,
  reason: "This backend has no key material and does not sign.",
};

type SubmitFailure = "rejected" | "indeterminate";

export class SimulatedZcashBackend implements ZcashTransactionBackend {
  readonly id = "zcash-simulated";
  readonly kind = "simulated" as const;
  readonly canSubmit = true;
  readonly label = "Simulated Zcash backend";
  readonly blocker = null;
  readonly honestyNotes = SIMULATED_HONESTY_NOTES;
  submitCount = 0;
  private warm = false;
  private forcedSync: SyncState | null = null;
  private failSubmit: SubmitFailure | null = null;
  private failConfirm = false;
  private readonly preparationIds = createIdFactory("prep");
  private readonly accepted = new Set<string>();

  constructor(
    private readonly runtime: Runtime,
    private readonly options?: { preparationTtlMs?: number },
  ) {}

  get isWarm(): boolean {
    return this.warm;
  }

  reset(): void {
    this.warm = false;
    this.forcedSync = null;
    this.failSubmit = null;
    this.failConfirm = false;
    this.accepted.clear();
  }

  clearWarmth(): void {
    this.warm = false;
  }

  forceSync(sync: SyncState | null): void {
    this.forcedSync = sync;
  }

  failNextSubmit(mode: SubmitFailure | null): void {
    this.failSubmit = mode;
  }

  failNextConfirm(fail: boolean): void {
    this.failConfirm = fail;
  }

  async warmUp(): Promise<Readiness> {
    const readiness = await this.getReadiness("optimized");
    this.warm = true;
    return readiness;
  }

  async getReadiness(mode: PreparationMode): Promise<Readiness> {
    if (this.forcedSync) {
      const synced = this.forcedSync === "synced";
      return {
        sync: this.forcedSync,
        spendableZatoshis: synced ? DEMO_SPENDABLE_ZATOSHIS : null,
        network: "testnet",
        measurement: {
          status: "measured",
          durationMs: 0,
          kind: "simulated",
        },
        note: "Forced synchronization state. This is not a chain observation.",
      };
    }

    const durationMs = this.delay(mode, "readiness");
    await this.runtime.sleep(durationMs);
    return {
      sync: "synced",
      spendableZatoshis: DEMO_SPENDABLE_ZATOSHIS,
      network: "testnet",
      measurement: { status: "measured", durationMs, kind: "simulated" },
      note: "Simulated wallet. The balance is a fixture.",
    };
  }

  async quoteFee(input: QuoteInput): Promise<FeeQuote> {
    const durationMs = this.delay(input.mode, "preflight");
    await this.runtime.sleep(durationMs);
    return {
      feeZatoshis: DEMO_FEE_ZATOSHIS,
      note: "Fixture fee. It was not quoted from the Zcash network.",
      measurement: { status: "measured", durationMs, kind: "simulated" },
      quoteId: this.preparationIds(),
      recipient: input.recipient,
      amountZatoshis: input.amountZatoshis.toString(),
      expiresAtMs: this.runtime.now() + this.quoteTtlMs(),
    };
  }

  async construct(input: ConstructInput): Promise<ConstructResult> {
    const durationMs = this.delay(input.mode, "construction");
    await this.runtime.sleep(durationMs);
    return {
      preparation: {
        preparationId: input.quoteId ?? this.preparationIds(),
        recipient: input.recipient,
        amountZatoshis: input.amountZatoshis.toString(),
        feeZatoshis: input.feeZatoshis.toString(),
        network: "testnet",
        expiresAtMs: input.expiresAtMs ?? this.runtime.now() + this.quoteTtlMs(),
      },
      measurements: {
        construction: { status: "measured", durationMs, kind: "simulated" },
        proof: PROOF_UNAVAILABLE,
        signing: SIGNING_UNAVAILABLE,
      },
    };
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    this.submitCount += 1;
    const failure = this.failSubmit;
    this.failSubmit = null;
    const durationMs = this.delay("baseline", "broadcast");
    await this.runtime.sleep(durationMs);
    const measurement = {
      status: "measured" as const,
      durationMs,
      kind: "simulated" as const,
    };

    if (failure === "rejected") {
      return {
        outcome: "rejected",
        message: "The simulated backend rejected the payment before acceptance.",
        measurement,
      };
    }

    if (failure === "indeterminate") {
      return {
        outcome: "indeterminate",
        message: "The simulated status check could not tell whether the payment was accepted.",
        measurement,
      };
    }

    if (input.preparation.recipient !== input.authorization.recipient) {
      return {
        outcome: "rejected",
        message: "Authorization did not match the prepared recipient.",
        measurement,
      };
    }

    if (input.preparation.amountZatoshis !== input.authorization.amountZatoshis) {
      return {
        outcome: "rejected",
        message: "Authorization did not match the prepared amount.",
        measurement,
      };
    }

    const reference = `sim_${input.preparation.preparationId}`;
    this.accepted.add(reference);
    return {
      outcome: "accepted",
      measurement,
      evidence: {
        source: "simulated",
        reference,
        acceptedForBroadcast: true,
        note: "Simulated acceptance. This reference is not a Zcash transaction id.",
      },
    };
  }

  async confirm(reference: string): Promise<ConfirmationEvidence> {
    if (this.failConfirm) {
      this.failConfirm = false;
      throw new Error("Simulated confirmation check failed.");
    }

    await this.runtime.sleep(SIMULATED_SCHEDULE.confirmation);
    if (!this.accepted.has(reference)) {
      return {
        source: "unavailable",
        met: false,
        criterion: "unknown_reference",
        note: "No acceptance record exists for this reference.",
      };
    }

    return {
      source: "simulated",
      met: true,
      criterion: "simulated_local_acceptance",
      note: "Local simulation only. No Zcash block was observed.",
    };
  }

  async detect(reference: string): Promise<DetectionEvidence> {
    await this.runtime.sleep(SIMULATED_SCHEDULE.detection);
    if (!this.accepted.has(reference)) {
      return {
        source: "unavailable",
        detected: false,
        note: "No acceptance record exists for this reference.",
      };
    }

    return {
      source: "simulated",
      detected: true,
      note: "Simulated detection. No recipient wallet was scanned.",
    };
  }

  private quoteTtlMs(): number {
    return this.options?.preparationTtlMs ?? 60_000;
  }

  private delay(
    mode: PreparationMode,
    stage: "readiness" | "preflight" | "construction" | "broadcast",
  ): number {
    if (mode === "optimized" && this.warm) {
      return SIMULATED_SCHEDULE.optimizedWarm[stage];
    }
    return SIMULATED_SCHEDULE.baseline[stage];
  }
}
