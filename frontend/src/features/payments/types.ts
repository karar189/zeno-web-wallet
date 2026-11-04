export type Network = "testnet" | "mainnet";

export type PreparationMode = "baseline" | "optimized";

export type DataKind = "simulated" | "observed";

export type SyncState = "synced" | "syncing" | "stale" | "unknown";

export type PaymentState =
  | "not_ready"
  | "preparing"
  | "awaiting_approval"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "received"
  | "failed"
  | "unknown";

export type StageName =
  | "wallet_readiness"
  | "preflight"
  | "construction"
  | "proof"
  | "signing"
  | "broadcast"
  | "confirmation"
  | "recipient_detection";

export type StageMeasurement =
  | { status: "measured"; durationMs: number; kind: DataKind }
  | { status: "unavailable"; reason: string };

export type FailureCode =
  | "insufficient_funds"
  | "stale_wallet"
  | "not_ready"
  | "invalid_request"
  | "rpc_failure"
  | "rejected"
  | "backend_unavailable"
  | "not_authorized";

export type PaymentFailure = {
  code: FailureCode;
  message: string;
  recovery: string;
};

export type PaymentRequest = {
  recipient: string;
  amountZec: string | null;
  network: Network;
  memo: null;
  /** Human-readable Zcash name that resolved to `recipient`, when used. */
  zcashName?: string | null;
};

export type Readiness = {
  sync: SyncState;
  spendableZatoshis: bigint | null;
  network: Network;
  measurement: StageMeasurement;
  note: string;
  canSubmit?: boolean;
  blocker?: string | null;
};

export type FeeQuote = {
  feeZatoshis: bigint | null;
  note: string;
  measurement: StageMeasurement;
  quoteId: string | null;
  recipient: string | null;
  amountZatoshis: string | null;
  expiresAtMs: number | null;
  failure?: PaymentFailure | null;
};

export type PreparedPayment = {
  preparationId: string;
  recipient: string;
  amountZatoshis: string;
  feeZatoshis: string;
  network: Network;
  expiresAtMs: number;
};

export type ConstructResult = {
  preparation: PreparedPayment;
  measurements: {
    construction: StageMeasurement;
    proof: StageMeasurement;
    signing: StageMeasurement;
  };
};

export type Authorization = {
  approvedAtMs: number;
  recipient: string;
  amountZatoshis: string;
  network: Network;
};

export type SubmissionEvidence = {
  source: "simulated" | "backend";
  reference: string;
  acceptedForBroadcast: true;
  note: string;
  txids?: string[];
};

export type ConfirmationEvidence = {
  source: "simulated" | "backend" | "unavailable";
  met: boolean;
  criterion: string;
  note: string;
  minedHeight?: number | null;
  blockHash?: string | null;
  confirmations?: number | null;
};

export type DetectionEvidence = {
  source: "simulated" | "backend" | "unavailable";
  detected: boolean;
  note: string;
};

export type ChainExplorerLinks = {
  transaction: string;
  block: string | null;
};

export type PaymentChainRef = {
  txid: string;
  minedHeight: number | null;
  blockHash: string | null;
  confirmations: number | null;
  explorer: ChainExplorerLinks;
};

export type SubmitResult =
  | {
      outcome: "accepted";
      evidence: SubmissionEvidence;
      measurement: StageMeasurement;
    }
  | { outcome: "rejected"; message: string; measurement: StageMeasurement }
  | {
      outcome: "indeterminate";
      message: string;
      measurement: StageMeasurement;
      txids?: string[];
    };

export type PaymentPhase =
  | "draft"
  | "preparing"
  | "awaiting_approval"
  | "submitting"
  | "tracking";

export type PaymentRecord = {
  id: string;
  mode: PreparationMode;
  phase: PaymentPhase;
  request: PaymentRequest;
  sync: SyncState;
  spendableZatoshis: string | null;
  feeZatoshis: string | null;
  feeNote: string | null;
  preparation: PreparedPayment | null;
  authorization: Authorization | null;
  submission: SubmissionEvidence | null;
  confirmation: ConfirmationEvidence | null;
  detection: DetectionEvidence | null;
  chain: PaymentChainRef | null;
  failure: PaymentFailure | null;
  statusConfidence: "known" | "unknown";
  stages: Partial<Record<StageName, StageMeasurement>>;
  dataSource: "simulated" | "live";
  warnings: string[];
};

export type StatusBoard = {
  state: PaymentState;
  message: string;
  evidence: string;
  submission: "not_submitted" | "submitted" | "unknown";
  confirmation: "not_confirmed" | "confirmed" | "unknown";
  detection: "not_detected" | "detected" | "unknown";
  simulated: boolean;
};

export type TrialOutcome = "success" | "failed" | "incomplete";

export type TrialConditions = {
  network: Network;
  device: string;
  softwareVersion: string;
  note: string;
};

export type Trial = {
  id: string;
  mode: PreparationMode | "experimental";
  measurementKind: DataKind;
  coldStart: boolean;
  outcome: TrialOutcome;
  failureCode: FailureCode | null;
  stages: Partial<Record<StageName, StageMeasurement>>;
};

export const STAGE_NAMES: readonly StageName[] = [
  "wallet_readiness",
  "preflight",
  "construction",
  "proof",
  "signing",
  "broadcast",
  "confirmation",
  "recipient_detection",
];

export const SIMULATED_HONESTY_NOTES = [
  "This demo uses a simulated Zcash backend. It does not generate a shielded proof or broadcast a transaction.",
  "Address checks cover the prefix and character set only. They do not verify a checksum.",
  "Submission, confirmation, and recipient detection stay separate. Local preparation is not confirmation.",
  "Shorter preparation in optimized mode is a simulated schedule. It does not change Zcash block times.",
  "The experimental probe is not Project Tachyon and is not on the payment path.",
] as const;

export const LIVE_HONESTY_NOTES = [
  "This page talks to a local Zcash wallet service for the network selected in the header. Testnet funds have no value. On mainnet, payments spend real ZEC and only mainnet addresses are accepted.",
  "The browser stores an encrypted seed vault. The local wallet service decrypts it while unlocked and signs on this machine.",
  "The page checks address format; the wallet service fully parses the recipient and builds the proposal before it quotes.",
  "Submission, confirmation, and recipient detection stay separate. A wallet-service acceptance is not a mined transaction.",
  "Confirmation is reported from lightwalletd. Recipient detection is withheld until the transaction is mined.",
  "The experimental probe is not Project Tachyon and is not on the payment path.",
] as const;
