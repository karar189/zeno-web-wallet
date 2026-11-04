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
  PaymentFailure,
  Readiness,
  StageMeasurement,
  SubmissionEvidence,
  SubmitResult,
  SyncState,
} from "@/features/payments/types";
import { LIVE_HONESTY_NOTES } from "@/features/payments/types";
import { walletServiceUrl, catchUpWallet } from "@/features/faucet/client";
import { readPreferredNetwork } from "@/features/network/preference";
import { authorizedHeaders } from "@/features/session/vault";

export const LIVE_BACKEND_BLOCKER =
  "The testnet wallet service has not reported a synced spendable balance.";

const disconnected =
  "The testnet wallet service is not reachable. Shielded submission stays unavailable.";

type WalletQuote = FeeQuote;

type WalletStatus = {
  confirmation: ConfirmationEvidence;
  detection: DetectionEvidence;
  txid?: string;
  minedHeight?: number | null;
  blockHash?: string | null;
  confirmations?: number | null;
  explorer?: {
    transaction?: string | null;
    block?: string | null;
  } | null;
};

type WalletSend = {
  outcome: "accepted" | "rejected" | "indeterminate";
  evidence?: SubmissionEvidence;
  message?: string;
  measurement?: StageMeasurement;
  txids?: string[];
};

class WalletTransportError extends Error {}

export class LiveWalletBackend implements ZcashTransactionBackend {
  readonly id = "zcash-testnet-wallet";
  readonly kind = "live" as const;
  readonly label = "Zcash wallet service";
  readonly canSubmit = true;
  readonly honestyNotes = LIVE_HONESTY_NOTES;
  blocker: string | null = LIVE_BACKEND_BLOCKER;
  submitCount = 0;
  private warm = false;

  get isWarm(): boolean {
    return this.warm;
  }

  async warmUp(): Promise<Readiness> {
    const readiness = await this.getReadiness();
    this.warm = true;
    return readiness;
  }

  clearWarmth(): void {
    this.warm = false;
  }

  async getReadiness(): Promise<Readiness> {
    try {
      const body = await catchUpWallet();
      const spendable = parseZatoshis(body.spendableZatoshis);
      this.blocker =
        body.canSubmit === false
          ? body.blocker ?? body.note ?? LIVE_BACKEND_BLOCKER
          : null;
      return {
        sync: asSyncState(body.sync),
        spendableZatoshis: spendable,
        network: serviceNetwork(),
        measurement: unavailable(this.blocker ?? LIVE_BACKEND_BLOCKER),
        note: body.note ?? this.blocker ?? LIVE_BACKEND_BLOCKER,
        canSubmit: body.canSubmit,
        blocker: this.blocker,
      };
    } catch (error) {
      this.blocker = messageOf(error);
      return {
        sync: "unknown",
        spendableZatoshis: null,
        network: serviceNetwork(),
        measurement: unavailable(this.blocker),
        note: this.blocker,
        canSubmit: false,
        blocker: this.blocker,
      };
    }
  }

  async quoteFee(input: QuoteInput): Promise<FeeQuote> {
    try {
      const body = await request<WalletQuote>("/api/wallet/quote", {
        recipient: input.recipient,
        amountZatoshis: input.amountZatoshis.toString(),
      });
      const fee = parseZatoshis(body.feeZatoshis);
      this.blocker = body.quoteId ? null : body.note;
      return {
        feeZatoshis: fee,
        note: body.note,
        measurement: body.measurement ?? unavailable(body.note),
        quoteId: body.quoteId ?? null,
        recipient: body.recipient ?? null,
        amountZatoshis: body.amountZatoshis ?? null,
        expiresAtMs:
          typeof body.expiresAtMs === "number" ? body.expiresAtMs : null,
        failure: body.quoteId ? null : quoteFailure(body.note),
      };
    } catch (error) {
      const message = messageOf(error);
      return {
        feeZatoshis: null,
        note: message,
        measurement: unavailable(message),
        quoteId: null,
        recipient: null,
        amountZatoshis: null,
        expiresAtMs: null,
        failure:
          error instanceof WalletTransportError
            ? {
                code: "backend_unavailable",
                message,
                recovery: "Start the wallet service, then prepare again. Nothing was sent.",
              }
            : {
                code: "invalid_request",
                message,
                recovery: "Correct the recipient or amount, then prepare again. Nothing was sent.",
              },
      };
    }
  }

  async construct(input: ConstructInput): Promise<ConstructResult> {
    if (
      !input.quoteId ||
      input.expiresAtMs === null ||
      input.feeZatoshis <= BigInt(0)
    ) {
      throw new Error("The wallet service did not issue a usable quote.");
    }
    if (input.amountZatoshis <= BigInt(0)) {
      throw new Error("The quoted amount is not positive.");
    }
    return {
      preparation: {
        preparationId: input.quoteId,
        recipient: input.recipient,
        amountZatoshis: input.amountZatoshis.toString(),
        feeZatoshis: input.feeZatoshis.toString(),
        network: serviceNetwork(),
        expiresAtMs: input.expiresAtMs,
      },
      measurements: {
        construction: unavailable(
          "The wallet service measured proposal construction during the quote; this page did not repeat it.",
        ),
        proof: unavailable(
          "The wallet service creates the shielded proof during send; this page did not observe it.",
        ),
        signing: unavailable(
          "The wallet service signs during send; no key material reaches this page.",
        ),
      },
    };
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    this.submitCount += 1;
    if (input.authorization.network !== serviceNetwork()) {
      return {
        outcome: "rejected",
        message: "This payment is for a different Zcash network than the connected wallet.",
        measurement: unavailable("The payment network does not match the connected wallet."),
      };
    }
    try {
      const body = await request<WalletSend>("/api/wallet/send", {
        quoteId: input.preparation.preparationId,
        approved: true,
        recipient: input.preparation.recipient,
        amountZatoshis: input.preparation.amountZatoshis,
        feeZatoshis: input.preparation.feeZatoshis,
      });
      if (body.outcome === "accepted") {
        const evidence = acceptedEvidence(body);
        if (!evidence) {
          return indeterminate(
            "The wallet service reported acceptance without a transaction id, so its status cannot be tracked. Check the wallet before retrying.",
            body.measurement,
            body.txids,
          );
        }
        return {
          outcome: "accepted",
          evidence,
          measurement:
            body.measurement ?? unavailable("Broadcast timing was not reported."),
        };
      }
      if (body.outcome === "indeterminate") {
        return indeterminate(
          body.message ?? "The wallet service did not report a definite outcome.",
          body.measurement,
          body.txids,
        );
      }
      return {
        outcome: "rejected",
        message: body.message ?? "The wallet service refused the send.",
        measurement:
          body.measurement ?? unavailable("The wallet service refused the send."),
      };
    } catch (error) {
      if (error instanceof WalletTransportError) {
        return indeterminate(
          "The send request did not return a readable response. The wallet service may have accepted it. Check the wallet before retrying.",
          undefined,
        );
      }
      return {
        outcome: "rejected",
        message: messageOf(error),
        measurement: unavailable("The wallet service refused the send."),
      };
    }
  }

  async confirm(reference: string): Promise<ConfirmationEvidence> {
    const status = await this.getChainStatus(reference);
    return (
      status?.confirmation ?? {
        source: "unavailable",
        met: false,
        criterion: "mined_on_testnet",
        note: disconnected,
      }
    );
  }

  async detect(reference: string): Promise<DetectionEvidence> {
    const status = await this.getChainStatus(reference);
    return (
      status?.detection ?? {
        source: "unavailable",
        detected: false,
        note: disconnected,
      }
    );
  }

  async getChainStatus(reference: string): Promise<WalletStatus | null> {
    try {
      return await request<WalletStatus>(
        `/api/wallet/transactions/${encodeURIComponent(reference)}`,
      );
    } catch {
      return null;
    }
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const headers = await authorizedHeaders(
      body === undefined ? undefined : { "content-type": "application/json" },
    );
    response = await fetch(`${walletServiceUrl()}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new WalletTransportError(disconnected);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message || disconnected);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new WalletTransportError(
      "The wallet service response could not be read, so the outcome is unknown.",
    );
  }
}

function serviceNetwork(): "testnet" | "mainnet" {
  return typeof window === "undefined" ? "testnet" : readPreferredNetwork();
}

function quoteFailure(note: string): PaymentFailure {
  return {
    code: "not_ready",
    message: note,
    recovery: "Sync and fund the wallet for the selected network, then prepare the payment again. Nothing was sent.",
  };
}

function acceptedEvidence(body: WalletSend): SubmissionEvidence | null {
  const reference = body.evidence?.reference?.trim();
  if (!reference) {
    return null;
  }
  const txids = normalizeTxids(body.txids ?? body.evidence?.txids);
  return {
    source: "backend",
    reference,
    acceptedForBroadcast: true,
    note:
      body.evidence?.note ??
      "The wallet service accepted the transaction bytes. Confirm on chain before treating the payment as settled.",
    txids,
  };
}

function indeterminate(
  message: string,
  measurement: StageMeasurement | undefined,
  txids?: string[],
): SubmitResult {
  return {
    outcome: "indeterminate",
    message,
    measurement:
      measurement ?? unavailable("Broadcast did not return a definite acceptance."),
    txids: normalizeTxids(txids),
  };
}

function normalizeTxids(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

function parseZatoshis(value: bigint | string | null | undefined): bigint | null {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  return BigInt(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : disconnected;
}

function unavailable(reason: string): StageMeasurement {
  return { status: "unavailable", reason };
}

function asSyncState(value: string | undefined): SyncState {
  if (
    value === "synced" ||
    value === "syncing" ||
    value === "stale" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}
