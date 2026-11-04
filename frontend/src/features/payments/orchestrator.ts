import { parseZecToZatoshis } from "@/features/payments/amount";
import type { ZcashTransactionBackend } from "@/features/payments/backend";
import { validatePaymentRequest } from "@/features/payments/payment-request";
import { runPreflight } from "@/features/payments/preflight";
import type { Runtime } from "@/features/payments/runtime";
import type {
  ConstructResult,
  PaymentFailure,
  PaymentRecord,
  PreparationMode,
  StageMeasurement,
} from "@/features/payments/types";

function unavailable(reason: string): StageMeasurement {
  return { status: "unavailable", reason };
}

function parseZatoshis(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

function openQuoteHoldsBalance(readiness: {
  sync: string;
  canSubmit?: boolean;
  blocker?: string | null;
}): boolean {
  return (
    readiness.sync === "synced" &&
    readiness.canSubmit === false &&
    typeof readiness.blocker === "string" &&
    readiness.blocker.includes("locked by an open quote")
  );
}

function invalidRequest(message: string): PaymentFailure {
  return {
    code: "invalid_request",
    message,
    recovery: "Correct the payment details and prepare again. Nothing was sent.",
  };
}

export class PaymentOrchestrator {
  private readonly locks = new Map<string, Promise<PaymentRecord>>();

  constructor(
    private readonly backend: ZcashTransactionBackend,
    private readonly runtime: Runtime,
    private readonly ids: () => string,
  ) {}

  createDraft(
    input: {
      recipient: string;
      amountZec: string | null;
      zcashName?: string | null;
    },
    mode: PreparationMode,
  ): PaymentRecord {
    return {
      id: this.ids(),
      mode,
      phase: "draft",
      request: {
        recipient: input.recipient.trim(),
        amountZec: input.amountZec?.trim() ? input.amountZec.trim() : null,
        network: "testnet",
        memo: null,
        zcashName: input.zcashName?.trim() ? input.zcashName.trim() : null,
      },
      sync: "unknown",
      spendableZatoshis: null,
      feeZatoshis: null,
      feeNote: null,
      preparation: null,
      authorization: null,
      submission: null,
      confirmation: null,
      detection: null,
      chain: null,
      failure: null,
      statusConfidence: "known",
      stages: {},
      dataSource: this.backend.kind === "simulated" ? "simulated" : "live",
      warnings: [...this.backend.honestyNotes],
    };
  }

  async prepare(record: PaymentRecord): Promise<PaymentRecord> {
    if (record.submission?.acceptedForBroadcast || record.statusConfidence === "unknown") {
      return record;
    }

    const preparing: PaymentRecord = {
      ...record,
      phase: "preparing",
      authorization: null,
      preparation: null,
      submission: null,
      confirmation: null,
      detection: null,
      chain: null,
      failure: null,
      statusConfidence: "known",
    };

    if (!this.backend.canSubmit) {
      return {
        ...preparing,
        phase: "draft",
        sync: "unknown",
        failure: {
          code: "backend_unavailable",
          message: this.backend.blocker ?? "The selected backend cannot submit payments.",
          recovery: "Use the simulated demo, or connect a verified backend before sending.",
        },
        stages: {
          ...preparing.stages,
          wallet_readiness: unavailable(
            this.backend.blocker ?? "Backend cannot submit payments.",
          ),
        },
      };
    }

    const validated = validatePaymentRequest({
      recipient: record.request.recipient,
      amountZec: record.request.amountZec,
    });
    if (!validated.ok) {
      return { ...preparing, phase: "draft", failure: invalidRequest(validated.reason) };
    }
    if (validated.request.amountZec === null) {
      return {
        ...preparing,
        request: validated.request,
        phase: "draft",
        failure: {
          code: "invalid_request",
          message: "Enter an amount before preparing this payment.",
          recovery: "Add a ZEC amount. Nothing was sent.",
        },
      };
    }
    const amount = parseZecToZatoshis(validated.request.amountZec);
    if (!amount.ok) {
      return {
        ...preparing,
        request: validated.request,
        phase: "draft",
        failure: invalidRequest(amount.reason),
      };
    }

    const readiness = await this.backend.getReadiness(record.mode);
    const withReadiness: PaymentRecord = {
      ...preparing,
      request: validated.request,
      sync: readiness.sync,
      spendableZatoshis: readiness.spendableZatoshis?.toString() ?? null,
      stages: { ...preparing.stages, wallet_readiness: readiness.measurement },
      warnings: [...preparing.warnings, readiness.note],
    };

    const reservedByOpenQuote = openQuoteHoldsBalance(readiness);
    if (
      readiness.sync !== "synced" ||
      readiness.spendableZatoshis === null ||
      (readiness.canSubmit === false && !reservedByOpenQuote)
    ) {
      const code = readiness.sync === "stale" ? "stale_wallet" : "not_ready";
      return {
        ...withReadiness,
        phase: "draft",
        failure: {
          code,
          message:
            readiness.blocker ??
            (readiness.sync === "stale"
              ? "Wallet state is stale, so it cannot authorize a payment."
              : "The wallet is not ready to send."),
          recovery:
            "Prepare the payment again after the wallet reports a synced spendable balance. Nothing was sent.",
        },
      };
    }

    const quote = await this.backend.quoteFee({
      mode: record.mode,
      recipient: validated.request.recipient,
      amountZatoshis: amount.zatoshis,
    });
    const withFee: PaymentRecord = {
      ...withReadiness,
      feeZatoshis: quote.feeZatoshis?.toString() ?? null,
      feeNote: quote.note,
      stages: { ...withReadiness.stages, preflight: quote.measurement },
    };

    if (quote.failure) {
      return { ...withFee, phase: "draft", failure: quote.failure };
    }

    if (
      quote.feeZatoshis === null ||
      quote.quoteId === null ||
      quote.expiresAtMs === null ||
      quote.recipient === null ||
      quote.amountZatoshis === null
    ) {
      return {
        ...withFee,
        phase: "draft",
        failure: {
          code: "not_ready",
          message: quote.note,
          recovery:
            "Sync and fund the testnet wallet, then prepare the payment again. Nothing was sent.",
        },
      };
    }

    if (
      quote.recipient !== validated.request.recipient ||
      quote.amountZatoshis !== amount.zatoshis.toString()
    ) {
      return {
        ...withFee,
        phase: "draft",
        failure: invalidRequest(
          "The wallet service quoted different payment details. Start again.",
        ),
      };
    }

    const preflight = runPreflight({
      request: validated.request,
      sync: readiness.sync,
      spendableZatoshis: readiness.spendableZatoshis,
      feeZatoshis: quote.feeZatoshis,
      quoteHoldsBalance: reservedByOpenQuote,
    });
    if (!preflight.ok) {
      return { ...withFee, phase: "draft", failure: preflight.failure };
    }

    let constructed: ConstructResult;
    try {
      constructed = await this.backend.construct({
        mode: record.mode,
        quoteId: quote.quoteId,
        recipient: quote.recipient,
        amountZatoshis: preflight.amountZatoshis,
        feeZatoshis: quote.feeZatoshis,
        expiresAtMs: quote.expiresAtMs,
      });
    } catch (error) {
      return {
        ...withFee,
        phase: "draft",
        failure: {
          code: "backend_unavailable",
          message:
            error instanceof Error
              ? error.message
              : "The backend could not prepare the payment.",
          recovery: "Nothing was sent. Prepare again when the wallet service is ready.",
        },
      };
    }

    const prepared = constructed.preparation;
    if (
      prepared.preparationId !== quote.quoteId ||
      prepared.recipient !== quote.recipient ||
      prepared.amountZatoshis !== quote.amountZatoshis ||
      prepared.feeZatoshis !== quote.feeZatoshis.toString() ||
      prepared.expiresAtMs !== quote.expiresAtMs ||
      prepared.network !== "testnet"
    ) {
      return {
        ...withFee,
        phase: "draft",
        failure: invalidRequest(
          "Preparation did not match the wallet-service quote. Start again.",
        ),
      };
    }

    return {
      ...withFee,
      phase: "awaiting_approval",
      preparation: prepared,
      authorization: null,
      failure: null,
      stages: {
        ...withFee.stages,
        construction: constructed.measurements.construction,
        proof: constructed.measurements.proof,
        signing: constructed.measurements.signing,
      },
    };
  }

  authorizeAndSubmit(record: PaymentRecord): Promise<PaymentRecord> {
    const existing = this.locks.get(record.id);
    if (existing) {
      return existing;
    }

    const run = this.authorizeBody(record);
    this.locks.set(record.id, run);
    return run.finally(() => {
      if (this.locks.get(record.id) === run) {
        this.locks.delete(record.id);
      }
    });
  }

  async confirm(record: PaymentRecord): Promise<PaymentRecord> {
    if (!record.submission?.acceptedForBroadcast) {
      return record;
    }
    if (record.confirmation?.met || record.confirmation?.source === "unavailable") {
      return record;
    }

    const started = this.runtime.now();
    try {
      const confirmation = await this.backend.confirm(record.submission.reference);
      return {
        ...record,
        confirmation,
        stages: {
          ...record.stages,
          confirmation: this.measured(record, this.runtime.now() - started),
        },
      };
    } catch {
      return {
        ...record,
        confirmation: {
          source: "unavailable",
          met: false,
          criterion: "status_check_failed",
          note: "The confirmation check failed. Submission evidence is unchanged.",
        },
        stages: {
          ...record.stages,
          confirmation: unavailable("The confirmation check failed."),
        },
      };
    }
  }

  async detect(record: PaymentRecord): Promise<PaymentRecord> {
    if (!record.submission?.acceptedForBroadcast) {
      return record;
    }
    if (record.detection?.detected || record.detection?.source === "unavailable") {
      return record;
    }

    const started = this.runtime.now();
    try {
      const detection = await this.backend.detect(
        record.submission.reference,
        record.request.recipient,
      );
      return {
        ...record,
        detection,
        stages: {
          ...record.stages,
          recipient_detection: this.measured(record, this.runtime.now() - started),
        },
      };
    } catch {
      return {
        ...record,
        detection: {
          source: "unavailable",
          detected: false,
          note: "Recipient detection failed. Confirmation evidence is unchanged.",
        },
        stages: {
          ...record.stages,
          recipient_detection: unavailable("Recipient detection failed."),
        },
      };
    }
  }

  private measured(record: PaymentRecord, durationMs: number): StageMeasurement {
    return {
      status: "measured",
      durationMs,
      kind: record.dataSource === "simulated" ? "simulated" : "observed",
    };
  }

  private async authorizeBody(record: PaymentRecord): Promise<PaymentRecord> {
    if (record.submission?.acceptedForBroadcast || record.statusConfidence === "unknown") {
      return record;
    }
    if (record.phase !== "awaiting_approval" || !record.preparation) {
      return record;
    }
    if (!this.backend.canSubmit) {
      return {
        ...record,
        phase: "draft",
        authorization: null,
        failure: {
          code: "backend_unavailable",
          message: this.backend.blocker ?? "The selected backend cannot submit payments.",
          recovery: "Nothing was sent.",
        },
      };
    }

    const prepared = record.preparation;
    if (prepared.expiresAtMs <= this.runtime.now()) {
      return {
        ...record,
        phase: "draft",
        authorization: null,
        preparation: null,
        failure: {
          code: "stale_wallet",
          message: "The prepared payment expired before authorization.",
          recovery: "Prepare it again. Nothing was sent.",
        },
      };
    }

    const feeZatoshis = parseZatoshis(prepared.feeZatoshis);
    if (feeZatoshis === null) {
      return {
        ...record,
        phase: "draft",
        authorization: null,
        preparation: null,
        failure: invalidRequest("The prepared fee is not a zatoshis value. Start again."),
      };
    }

    const readinessStarted = this.runtime.now();
    const readiness = await this.backend.getReadiness(record.mode);
    const checked: PaymentRecord = {
      ...record,
      sync: readiness.sync,
      spendableZatoshis: readiness.spendableZatoshis?.toString() ?? null,
      stages: {
        ...record.stages,
        wallet_readiness: this.measured(record, this.runtime.now() - readinessStarted),
      },
      warnings: record.warnings.includes(readiness.note)
        ? record.warnings
        : [...record.warnings, readiness.note],
    };

    const reservedByThisQuote = openQuoteHoldsBalance(readiness);
    if (
      readiness.sync !== "synced" ||
      readiness.spendableZatoshis === null ||
      (readiness.canSubmit === false && !reservedByThisQuote)
    ) {
      const code = readiness.sync === "stale" ? "stale_wallet" : "not_ready";
      return {
        ...checked,
        phase: "draft",
        authorization: null,
        preparation: null,
        failure: {
          code,
          message:
            readiness.blocker ??
            (readiness.sync === "stale"
              ? "Wallet state is stale, so it cannot authorize a payment."
              : "The wallet is not ready to send."),
          recovery:
            "Prepare the payment again after the wallet reports a synced spendable balance. Nothing was sent.",
        },
      };
    }

    const preflight = runPreflight({
      request: record.request,
      sync: readiness.sync,
      spendableZatoshis: readiness.spendableZatoshis,
      feeZatoshis,
      quoteHoldsBalance: reservedByThisQuote,
    });
    if (!preflight.ok) {
      return {
        ...checked,
        phase: "draft",
        authorization: null,
        preparation: null,
        failure: preflight.failure,
      };
    }

    if (
      prepared.recipient !== record.request.recipient ||
      prepared.amountZatoshis !== preflight.amountZatoshis.toString() ||
      prepared.feeZatoshis !== feeZatoshis.toString() ||
      prepared.network !== record.request.network
    ) {
      return {
        ...checked,
        phase: "draft",
        authorization: null,
        preparation: null,
        failure: {
          code: "invalid_request",
          message: "The payment details changed after preparation.",
          recovery: "Review the new details and prepare again. Nothing was sent.",
        },
      };
    }

    const authorization = {
      approvedAtMs: this.runtime.now(),
      recipient: prepared.recipient,
      amountZatoshis: prepared.amountZatoshis,
      network: prepared.network,
    };
    const submitting: PaymentRecord = {
      ...checked,
      phase: "submitting",
      authorization,
      failure: null,
    };
    const result = await this.backend.submit({
      preparation: prepared,
      authorization,
    });

    if (result.outcome === "accepted") {
      return {
        ...submitting,
        phase: "tracking",
        submission: result.evidence,
        stages: { ...submitting.stages, broadcast: result.measurement },
      };
    }

    if (result.outcome === "indeterminate") {
      return {
        ...submitting,
        phase: "tracking",
        statusConfidence: "unknown",
        submission: null,
        failure: {
          code: "rpc_failure",
          message: result.message,
          recovery: "Status is unknown. This payment will not be retried automatically.",
        },
        stages: { ...submitting.stages, broadcast: result.measurement },
      };
    }

    return {
      ...checked,
      phase: "draft",
      authorization: null,
      preparation: null,
      failure: {
        code: "rejected",
        message: result.message,
        recovery: "The backend did not accept the payment. You can prepare it again.",
      },
      stages: { ...checked.stages, broadcast: result.measurement },
    };
  }
}
