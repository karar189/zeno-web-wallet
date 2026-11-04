export type FundingPhase =
  | "ready"
  | "submitted"
  | "waiting"
  | "detected"
  | "spendable"
  | "failed";

export type FaucetError = {
  code: string;
  message: string;
  retryable: boolean;
  nextEligibleAtMs?: number;
};

export type FallbackFaucet = {
  name: string;
  url: string;
};

export type FaucetInfo = {
  endpoint: string;
  websiteUrl: string;
  available: boolean;
  network: string;
  faucetNetwork: string | null;
  supportedAddressKinds: string[];
  fundingReceiverKinds: string[];
  captchaMode: string | null;
  launchPhase: string | null;
  dripZat: number | null;
  maxAmountZatPerClaim: number | null;
  addressCooldownHours: number | null;
  cause: string | null;
  supportUrl: string | null;
  sourceUrl: string | null;
  fallbackFaucets: FallbackFaucet[];
  walletAddress: string | null;
  walletAddressKind: string | null;
  addressSupported: boolean;
  canAttemptClaim: boolean;
  note: string;
  error: FaucetError | null;
};

export type ClaimReport = {
  requestId: string;
  network: string;
  state: string;
  outcome: string | null;
  txid: string | null;
  amountZat: number | null;
  nextEligibleAtMs: number | null;
  confirmedHeight: number | null;
  address: string | null;
  addressKind: string | null;
  privacyPolicy: string | null;
  failureReason: string | null;
  ambiguous: boolean;
  note: string;
  error: FaucetError | null;
};

export type WalletReadiness = {
  network: string;
  sync: string;
  detectedZatoshis: string | null;
  spendableZatoshis: string | null;
  pendingChangeZatoshis?: string | null;
  pendingSpendabilityZatoshis?: string | null;
  lockedZatoshis?: string | null;
  transparentDetectedZatoshis?: string | null;
  transparentSpendableZatoshis?: string | null;
  canSubmit: boolean;
  blocker: string;
  note: string;
};

export type WalletAddress = {
  address: string | null;
  transparentAddress?: string | null;
  network: string;
  birthdayHeight: number | null;
  note?: string;
};

export type ClaimMode = "faucet" | "external";

export type StoredClaim = {
  version: 1;
  mode: ClaimMode;
  requestId: string | null;
  address: string;
  createdAtMs: number;
  baselineDetectedZatoshis: string;
  baselineSpendableZatoshis: string;
  report: ClaimReport | null;
  submissionError: FaucetError | null;
  submissionAmbiguous: boolean;
  lastCheckedAtMs: number | null;
  lastFaucetState: string | null;
  websiteUrl: string;
};

export type WalletServiceErrorShape = {
  code: string;
  message: string;
  status: number | null;
  report: ClaimReport | null;
  ambiguous: boolean;
};
