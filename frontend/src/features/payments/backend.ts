import type {
  Authorization,
  ConfirmationEvidence,
  ConstructResult,
  DetectionEvidence,
  FeeQuote,
  PreparationMode,
  PreparedPayment,
  Readiness,
  SubmitResult,
} from "@/features/payments/types";

export type ChainStatus = {
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

export type QuoteInput = {
  mode: PreparationMode;
  recipient: string;
  amountZatoshis: bigint;
};

export type ConstructInput = {
  mode: PreparationMode;
  quoteId: string | null;
  recipient: string;
  amountZatoshis: bigint;
  feeZatoshis: bigint;
  expiresAtMs: number | null;
};

export type SubmitInput = {
  preparation: PreparedPayment;
  authorization: Authorization;
};

export interface ZcashTransactionBackend {
  readonly id: string;
  readonly kind: "simulated" | "live";
  readonly canSubmit: boolean;
  readonly label: string;
  readonly blocker: string | null;
  readonly honestyNotes: readonly string[];
  readonly isWarm?: boolean;
  warmUp?(): Promise<Readiness>;
  clearWarmth?(): void;
  getReadiness(mode: PreparationMode): Promise<Readiness>;
  quoteFee(input: QuoteInput): Promise<FeeQuote>;
  construct(input: ConstructInput): Promise<ConstructResult>;
  submit(input: SubmitInput): Promise<SubmitResult>;
  confirm(reference: string): Promise<ConfirmationEvidence>;
  detect(reference: string, recipient: string): Promise<DetectionEvidence>;
  /** Optional single-round-trip status used so confirmation and detection stay consistent. */
  getChainStatus?(reference: string): Promise<ChainStatus | null>;
}
