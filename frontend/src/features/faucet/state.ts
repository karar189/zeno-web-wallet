import type {
  FaucetInfo,
  FundingPhase,
  StoredClaim,
  WalletReadiness,
} from "./types";

const ZAT_PER_TAZ = BigInt(100000000);
const ZERO = BigInt(0);

export const PHASE_LABEL: Record<FundingPhase, string> = {
  ready: "Ready to request",
  submitted: "Request submitted",
  waiting: "Waiting for funds",
  detected: "Funds detected",
  spendable: "Spendable",
  failed: "Failed",
};

export const FUNDING_STEPS: FundingPhase[] = [
  "ready",
  "submitted",
  "waiting",
  "detected",
  "spendable",
];

export type FundingView = {
  phase: FundingPhase;
  label: string;
  detail: string;
  failureCode: string | null;
  failureMessage: string | null;
  cooldownUntilMs: number | null;
  detected: bigint | null;
  spendable: bigint | null;
  detectedDelta: bigint | null;
  spendableDelta: bigint | null;
  faucetState: string | null;
  canStartClaim: boolean;
  canWatchExternal: boolean;
  canCheckNow: boolean;
  canRetry: boolean;
  canDismiss: boolean;
  isTracking: boolean;
  captchaRequired: boolean;
  websiteUrl: string | null;
};

export function toZats(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || !/^\d+$/.test(value.trim())) {
    return null;
  }
  try {
    return BigInt(value.trim());
  } catch {
    return null;
  }
}

export function formatTaz(value: bigint | null): string {
  if (value === null) {
    return "Unavailable";
  }
  const negative = value < ZERO;
  const absolute = negative ? -value : value;
  const whole = absolute / ZAT_PER_TAZ;
  const fraction = (absolute % ZAT_PER_TAZ)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""} TAZ`;
}

export function formatZats(value: bigint | null): string {
  return value === null ? "Unavailable" : `${value.toString()} zats`;
}

export function formatZatAmount(value: number | null): string | null {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return formatTaz(BigInt(value));
}

export function formatCooldown(untilMs: number | null, nowMs: number): string | null {
  if (untilMs === null) {
    return null;
  }
  const remaining = untilMs - nowMs;
  if (remaining <= 0) {
    return "Eligible now";
  }
  const minutes = Math.ceil(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) {
    return `${hours} h ${rest.toString().padStart(2, "0")} min`;
  }
  return `${minutes} min`;
}

export type AddressKind = "unified" | "sapling" | "transparent" | "unsupported";

export function classifyTestnetAddress(address: string | null | undefined): AddressKind {
  if (!address) {
    return "unsupported";
  }
  const value = address.trim();
  if (/^utest1[a-z0-9]{20,}$/.test(value)) {
    return "unified";
  }
  if (/^ztestsapling1[a-z0-9]{20,}$/.test(value)) {
    return "sapling";
  }
  if (/^(tm|t2)[a-zA-Z0-9]{20,}$/.test(value)) {
    return "transparent";
  }
  return "unsupported";
}

export function isSupportedTestnetShieldedAddress(
  address: string | null | undefined,
): boolean {
  const kind = classifyTestnetAddress(address);
  return kind === "unified" || kind === "sapling";
}

export function isClaimAmbiguous(claim: StoredClaim): boolean {
  return (
    claim.submissionAmbiguous ||
    claim.report?.ambiguous === true ||
    claim.submissionError?.code === "submission_ambiguous"
  );
}

function cooldownFrom(
  info: FaucetInfo | null,
  claim: StoredClaim | null,
): number | null {
  const times = [
    info?.error?.nextEligibleAtMs,
    claim?.report?.nextEligibleAtMs,
    claim?.submissionError?.nextEligibleAtMs,
  ].filter((value): value is number => typeof value === "number" && value > 0);
  if (times.length === 0) {
    return null;
  }
  return Math.max(...times);
}

export type DeriveFundingInput = {
  readiness: WalletReadiness | null;
  claim: StoredClaim | null;
  info: FaucetInfo | null;
  address: string | null;
  now: number;
};

export function deriveFundingView(input: DeriveFundingInput): FundingView {
  const { readiness, claim, info, address, now } = input;
  const detected = toZats(readiness?.detectedZatoshis);
  const spendable = toZats(readiness?.spendableZatoshis);
  const baselineDetected = claim ? toZats(claim.baselineDetectedZatoshis) : null;
  const baselineSpendable = claim ? toZats(claim.baselineSpendableZatoshis) : null;
  const detectedDelta =
    claim && detected !== null && baselineDetected !== null
      ? detected - baselineDetected
      : null;
  const spendableDelta =
    claim && spendable !== null && baselineSpendable !== null
      ? spendable - baselineSpendable
      : null;
  const walletTestnet = readiness?.network === "testnet";
  const addressSupported =
    isSupportedTestnetShieldedAddress(address) &&
    (info === null || info.addressSupported);
  const addressMatchesWalletService =
    info === null || info.walletAddress === null || info.walletAddress === address;
  let cooldownUntilMs = cooldownFrom(info, claim);
  const cooldownActive = cooldownUntilMs !== null && cooldownUntilMs > now;
  const captchaRequired =
    typeof info?.captchaMode === "string" &&
    info.captchaMode.toLowerCase() !== "none";

  let phase: FundingPhase = "ready";
  let detail = "The wallet and faucet are ready. No claim has been submitted.";
  let failureCode: string | null = null;
  let failureMessage: string | null = null;

  if (claim) {
    const arrived = detectedDelta !== null && detectedDelta > ZERO;
    const spendableArrived = spendableDelta !== null && spendableDelta > ZERO;
    const reportFailed =
      claim.report?.state === "failed" && claim.report.ambiguous !== true;
    const submissionFailed =
      claim.submissionError !== null && !claim.submissionAmbiguous;
    const failureError =
      claim.report?.error ?? claim.submissionError ?? null;

    if (arrived) {
      if (spendableArrived && readiness?.canSubmit && walletTestnet) {
        phase = "spendable";
        detail =
          "The wallet service reports the new funds as spendable. Sending stays a separate, manual step.";
      } else if (spendableArrived) {
        phase = "detected";
        detail = `New spendable funds are reported, but the wallet service is not ready to send: ${
          readiness?.blocker ?? "readiness is unavailable."
        }`;
      } else {
        phase = "detected";
        detail =
          "The wallet balance includes new funds, but they are not spendable yet. ZIP 315 requires confirmations before faucet-funded notes can be spent.";
      }
    } else if (claim.mode === "external") {
      phase = "waiting";
      detail =
        "Watching the wallet for incoming testnet funds. This tracks the wallet balance; it does not verify a Fauzec claim.";
    } else if (reportFailed || submissionFailed) {
      phase = "failed";
      failureCode = failureError?.code ?? "claim_failed";
      failureMessage =
        failureError?.message ??
        claim.report?.note ??
        claim.submissionError?.message ??
        "The claim did not succeed.";
      detail = failureError?.message ?? "The claim did not succeed.";
    } else if (
      claim.report?.state === "broadcasting" ||
      claim.report?.state === "confirmed"
    ) {
      phase = "waiting";
      detail =
        claim.report.state === "broadcasting"
          ? "Fauzec says a dispense is broadcasting. The wallet has not detected new funds yet."
          : "Fauzec says its dispense is confirmed. The wallet still has to detect and confirm the shielded note.";
    } else if (claim.report?.state === "pending") {
      phase = "submitted";
      detail = "Fauzec queued the claim. No dispense has been reported yet.";
    } else {
      phase = "submitted";
      detail = isClaimAmbiguous(claim)
        ? "The claim outcome is not certain. This app checks the same Fauzec request id instead of submitting another claim."
        : "The claim request is recorded. No funds are counted until the wallet detects them.";
    }

    if (failureError?.nextEligibleAtMs) {
      cooldownUntilMs = Math.max(
        cooldownUntilMs ?? 0,
        failureError.nextEligibleAtMs,
      );
    }
  } else {
    const infoError = info?.error ?? null;
    if (readiness === null) {
      phase = "failed";
      failureCode = "wallet_unavailable";
      failureMessage =
        "The wallet service has not reported a balance. Start the local wallet service before requesting funds.";
      detail = failureMessage;
    } else if (info === null) {
      phase = "failed";
      failureCode = "faucet_info_unavailable";
      failureMessage =
        "The faucet info could not be loaded from the wallet service. Refresh before requesting funds.";
      detail = failureMessage;
    } else if (info.walletAddress !== null && info.walletAddress !== address) {
      phase = "failed";
      failureCode = "wallet_address_changed";
      failureMessage =
        "The faucet info and the wallet service report different receiving addresses. Refresh before requesting funds.";
      detail = failureMessage;
    } else if (info && !info.available) {
      phase = "failed";
      failureCode = infoError?.code ?? "faucet_unavailable";
      failureMessage =
        infoError?.message ??
        "The faucet is not available, so no claim can be requested right now.";
      detail = failureMessage;
    } else if (info && infoError) {
      phase = "failed";
      failureCode = infoError.code;
      failureMessage = infoError.message;
      detail = infoError.message;
    } else if (address === null) {
      phase = "failed";
      failureCode = "wallet_address_unavailable";
      failureMessage =
        "The wallet service has not reported a shielded receiving address yet.";
      detail = failureMessage;
    } else if (info && !info.addressSupported) {
      phase = "failed";
      failureCode = "unsupported_address_kind";
      failureMessage = `The faucet does not fund this address type. Supported kinds: ${
        info.supportedAddressKinds.join(", ") || "none reported"
      }.`;
      detail = failureMessage;
    } else if (!addressSupported) {
      phase = "failed";
      failureCode = "unsupported_address_kind";
      failureMessage =
        "The receiving address is not a shielded Zcash testnet address, so Fauzec will not fund it.";
      detail = failureMessage;
    } else if (captchaRequired) {
      detail =
        "Fauzec currently requires a browser captcha. The API claim may be refused; the website fallback below can complete it.";
    }
  }

  const infoReady =
    info !== null &&
    info.available &&
    info.canAttemptClaim &&
    info.error === null &&
    info.addressSupported;
  const readinessBaselineReady =
    detected !== null && spendable !== null && walletTestnet;
  const canStartClaim =
    claim === null &&
    infoReady &&
    addressSupported &&
    addressMatchesWalletService &&
    readinessBaselineReady &&
    !cooldownActive;

  const definiteFailure =
    claim !== null && phase === "failed" && !isClaimAmbiguous(claim);
  const canDismiss =
    definiteFailure || phase === "spendable" || claim?.mode === "external";
  const canWatchExternal =
    (claim === null || definiteFailure) &&
    addressSupported &&
    readinessBaselineReady &&
    !cooldownActive;
  const errorRetryable =
    claim?.report?.error?.retryable === true ||
    claim?.submissionError?.retryable === true;
  const canRetry =
    definiteFailure && errorRetryable && !cooldownActive;
  const websiteUrl =
    info?.websiteUrl?.trim() || info?.endpoint?.trim() || null;

  return {
    phase,
    label: PHASE_LABEL[phase],
    detail,
    failureCode,
    failureMessage,
    cooldownUntilMs,
    detected,
    spendable,
    detectedDelta,
    spendableDelta,
    faucetState: claim?.lastFaucetState ?? claim?.report?.state ?? null,
    canStartClaim,
    canWatchExternal,
    canCheckNow: claim !== null && phase !== "spendable",
    canRetry,
    canDismiss,
    isTracking: claim !== null && phase !== "spendable" && phase !== "failed",
    captchaRequired,
    websiteUrl,
  };
}
