import { describe, expect, it } from "vitest";
import { sanitizeStoredClaim } from "./storage";
import {
  classifyTestnetAddress,
  deriveFundingView,
  formatCooldown,
  formatTaz,
  isClaimAmbiguous,
  isSupportedTestnetShieldedAddress,
  toZats,
} from "./state";
import type {
  ClaimReport,
  FaucetInfo,
  StoredClaim,
  WalletReadiness,
} from "./types";

const ADDRESS = `utest1${"a".repeat(80)}`;
const REQUEST_ID = "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31";
const NOW = 1_800_000_000_000;

function makeInfo(overrides: Partial<FaucetInfo> = {}): FaucetInfo {
  return {
    endpoint: "https://fauzec.com",
    websiteUrl: "https://fauzec.com",
    available: true,
    network: "testnet",
    faucetNetwork: "testnet",
    supportedAddressKinds: ["unified", "sapling"],
    fundingReceiverKinds: ["transparent"],
    captchaMode: "turnstile",
    launchPhase: "open",
    dripZat: 100000000,
    maxAmountZatPerClaim: 100000000,
    addressCooldownHours: 24,
    cause: "ready",
    supportUrl: "https://fauzec.com/help",
    sourceUrl: null,
    fallbackFaucets: [],
    walletAddress: ADDRESS,
    walletAddressKind: "unified",
    addressSupported: true,
    canAttemptClaim: true,
    note: "Faucet is ready.",
    error: null,
    ...overrides,
  };
}

function makeReadiness(
  overrides: Partial<WalletReadiness> = {},
): WalletReadiness {
  return {
    network: "testnet",
    sync: "synced",
    detectedZatoshis: "0",
    spendableZatoshis: "0",
    canSubmit: false,
    blocker: "Spendable balance is zero zatoshi.",
    note: "Readiness.",
    ...overrides,
  };
}

function makeReport(overrides: Partial<ClaimReport> = {}): ClaimReport {
  return {
    requestId: REQUEST_ID,
    network: "testnet",
    state: "pending",
    outcome: "accepted",
    txid: null,
    amountZat: 100000000,
    nextEligibleAtMs: null,
    confirmedHeight: null,
    address: ADDRESS,
    addressKind: "unified",
    privacyPolicy: null,
    failureReason: null,
    ambiguous: false,
    note: "Fauzec queued the claim.",
    error: null,
    ...overrides,
  };
}

function makeClaim(overrides: Partial<StoredClaim> = {}): StoredClaim {
  return {
    version: 1,
    mode: "faucet",
    requestId: REQUEST_ID,
    address: ADDRESS,
    createdAtMs: NOW - 60000,
    baselineDetectedZatoshis: "0",
    baselineSpendableZatoshis: "0",
    report: makeReport(),
    submissionError: null,
    submissionAmbiguous: false,
    lastCheckedAtMs: NOW - 30000,
    lastFaucetState: "pending",
    websiteUrl: "https://fauzec.com",
    ...overrides,
  };
}

function view(
  overrides: {
    readiness?: WalletReadiness;
    claim?: StoredClaim | null;
    info?: FaucetInfo | null;
    address?: string | null;
  } = {},
) {
  return deriveFundingView({
    readiness:
      "readiness" in overrides
        ? (overrides.readiness ?? null)
        : makeReadiness(),
    claim: "claim" in overrides ? (overrides.claim ?? null) : null,
    info: "info" in overrides ? (overrides.info ?? null) : makeInfo(),
    address: "address" in overrides ? (overrides.address ?? null) : ADDRESS,
    now: NOW,
  });
}

describe("amount and address helpers", () => {
  it("formats zats without floating point loss", () => {
    expect(formatTaz(toZats("100000000"))).toBe("1 TAZ");
    expect(formatTaz(toZats("123456789"))).toBe("1.23456789 TAZ");
    expect(formatTaz(toZats("0"))).toBe("0 TAZ");
    expect(formatTaz(null)).toBe("Unavailable");
  });

  it("classifies testnet address kinds and rejects mainnet or transparent", () => {
    expect(classifyTestnetAddress(ADDRESS)).toBe("unified");
    expect(classifyTestnetAddress(`ztestsapling1${"b".repeat(70)}`)).toBe(
      "sapling",
    );
    expect(classifyTestnetAddress(`tm${"c".repeat(33)}`)).toBe("transparent");
    expect(classifyTestnetAddress(`zs1${"d".repeat(70)}`)).toBe("unsupported");
    expect(isSupportedTestnetShieldedAddress(ADDRESS)).toBe(true);
    expect(isSupportedTestnetShieldedAddress(`tm${"c".repeat(33)}`)).toBe(false);
  });

  it("formats a cooldown without inventing an exact clock", () => {
    expect(formatCooldown(NOW + 90_000, NOW)).toBe("2 min");
    expect(formatCooldown(NOW + 3_600_000, NOW)).toBe("1 h 00 min");
    expect(formatCooldown(NOW - 1, NOW)).toBe("Eligible now");
    expect(formatCooldown(null, NOW)).toBeNull();
  });
});

describe("funding phases", () => {
  it("is ready only when the faucet, address, and balance baseline are usable", () => {
    const ready = view();
    expect(ready.phase).toBe("ready");
    expect(ready.canStartClaim).toBe(true);
    expect(ready.captchaRequired).toBe(true);
    expect(ready.detail).toContain("browser captcha");
  });

  it("blocks a claim when the wallet address does not match the faucet info", () => {
    const mismatch = view({
      info: makeInfo({ walletAddress: `utest1${"z".repeat(80)}` }),
    });
    expect(mismatch.phase).toBe("failed");
    expect(mismatch.canStartClaim).toBe(false);
  });

  it("blocks an unsupported address instead of submitting it", () => {
    const transparent = `tm${"c".repeat(33)}`;
    const unsupported = view({
      address: transparent,
      info: makeInfo({
        walletAddress: transparent,
        walletAddressKind: "transparent",
        addressSupported: false,
        canAttemptClaim: false,
      }),
    });
    expect(unsupported.phase).toBe("failed");
    expect(unsupported.failureCode).toBe("unsupported_address_kind");
    expect(unsupported.canStartClaim).toBe(false);
    expect(unsupported.canWatchExternal).toBe(false);
  });

  it("reports faucet downtime as a failure without claiming funds moved", () => {
    const down = view({
      info: makeInfo({
        available: false,
        canAttemptClaim: false,
        cause: "faucet_dry",
        error: {
          code: "faucet_dry",
          message: "Fauzec is out of funds right now.",
          retryable: true,
        },
      }),
    });
    expect(down.phase).toBe("failed");
    expect(down.failureCode).toBe("faucet_dry");
    expect(down.canStartClaim).toBe(false);
  });

  it("shows Request submitted while the faucet has only queued the claim", () => {
    const queued = view({ claim: makeClaim() });
    expect(queued.phase).toBe("submitted");
    expect(queued.canCheckNow).toBe(true);
    expect(queued.canDismiss).toBe(false);
  });

  it("shows Waiting for funds for broadcasting or confirmed faucet states", () => {
    expect(
      view({ claim: makeClaim({ report: makeReport({ state: "broadcasting" }) }) })
        .phase,
    ).toBe("waiting");
    expect(
      view({ claim: makeClaim({ report: makeReport({ state: "confirmed" }) }) })
        .phase,
    ).toBe("waiting");
  });

  it("shows Funds detected when the wallet balance grew but is not spendable", () => {
    const detected = view({
      claim: makeClaim(),
      readiness: makeReadiness({
        detectedZatoshis: "100000000",
        spendableZatoshis: "0",
      }),
    });
    expect(detected.phase).toBe("detected");
    expect(detected.detectedDelta).toBe(BigInt(100000000));
    expect(detected.canDismiss).toBe(false);
  });

  it("shows Spendable only when the wallet confirms spendable funds and readiness", () => {
    const spendable = view({
      claim: makeClaim(),
      readiness: makeReadiness({
        detectedZatoshis: "100000000",
        spendableZatoshis: "100000000",
        canSubmit: true,
        blocker: "The wallet is within 10 blocks of the testnet tip.",
      }),
    });
    expect(spendable.phase).toBe("spendable");
    expect(spendable.canDismiss).toBe(true);
  });

  it("keeps Funds detected when the spendable balance rose but sending is blocked", () => {
    const blocked = view({
      claim: makeClaim(),
      readiness: makeReadiness({
        detectedZatoshis: "100000000",
        spendableZatoshis: "100000000",
        canSubmit: false,
        blocker: "The wallet is 80 blocks behind the testnet tip.",
      }),
    });
    expect(blocked.phase).toBe("detected");
    expect(blocked.detail).toContain("80 blocks behind");
  });

  it("lets wallet evidence override a failed faucet state", () => {
    const failedFaucet = makeClaim({
      report: makeReport({
        state: "failed",
        outcome: "failed",
        error: {
          code: "wallet_operation_failed",
          message: "Fauzec's wallet failed while preparing the dispense.",
          retryable: true,
        },
      }),
    });
    const detected = view({
      claim: failedFaucet,
      readiness: makeReadiness({ detectedZatoshis: "100000000" }),
    });
    expect(detected.phase).toBe("detected");
  });

  it("only treats a definite failure as Failed and offers a safe retry", () => {
    const failed = view({
      claim: makeClaim({
        report: makeReport({
          state: "failed",
          ambiguous: false,
          error: {
            code: "runtime_unavailable",
            message: "Fauzec's claim runtime is unavailable.",
            retryable: true,
          },
        }),
      }),
    });
    expect(failed.phase).toBe("failed");
    expect(failed.canRetry).toBe(true);
    expect(failed.canDismiss).toBe(true);
    expect(failed.canWatchExternal).toBe(true);
  });

  it("keeps an ambiguous submission as Request submitted, not Failed", () => {
    const ambiguous = view({
      claim: makeClaim({
        report: null,
        submissionError: {
          code: "wallet_service_unreachable",
          message: "The wallet service did not answer.",
          retryable: true,
        },
        submissionAmbiguous: true,
      }),
    });
    expect(ambiguous.phase).toBe("submitted");
    expect(ambiguous.canDismiss).toBe(false);
    expect(ambiguous.canWatchExternal).toBe(false);
    expect(isClaimAmbiguous(ambiguousClaim())).toBe(true);
  });

  it("does not allow a new claim during a documented address cooldown", () => {
    const cooldown = view({
      claim: makeClaim({
        report: makeReport({
          state: "failed",
          nextEligibleAtMs: NOW + 3_600_000,
          error: {
            code: "address_on_cooldown",
            message: "This receiving address already claimed recently.",
            retryable: false,
            nextEligibleAtMs: NOW + 3_600_000,
          },
        }),
      }),
    });
    expect(cooldown.phase).toBe("failed");
    expect(cooldown.canRetry).toBe(false);
    expect(cooldown.canDismiss).toBe(true);
    expect(formatCooldown(cooldown.cooldownUntilMs, NOW)).toBe("1 h 00 min");
  });

  it("tracks an external wallet claim without pretending to verify Fauzec", () => {
    const external = makeClaim({
      mode: "external",
      requestId: null,
      report: null,
      lastFaucetState: null,
    });
    expect(view({ claim: external }).phase).toBe("waiting");
    expect(view({ claim: external }).detail).toContain("does not verify");
    expect(view({ claim: external }).canDismiss).toBe(true);
    expect(
      view({
        claim: external,
        readiness: makeReadiness({
          detectedZatoshis: "100000000",
          spendableZatoshis: "100000000",
          canSubmit: true,
        }),
      }).phase,
    ).toBe("spendable");
  });

  it("refuses a claim without a numeric wallet baseline", () => {
    const unavailable = view({
      readiness: makeReadiness({
        detectedZatoshis: null,
        spendableZatoshis: null,
      }),
    });
    expect(unavailable.canStartClaim).toBe(false);
    expect(unavailable.canWatchExternal).toBe(false);
  });
});

function ambiguousClaim(): StoredClaim {
  return makeClaim({
    report: makeReport({
      state: "unknown",
      ambiguous: true,
      note: "Fauzec accepted the request for processing.",
    }),
  });
}

describe("stored claim hygiene", () => {
  it("persists only public claim fields and drops key material", () => {
    const parsed = sanitizeStoredClaim({
      ...makeClaim(),
      seed: "abandon abandon abandon",
      spendingKey: "secret-spending-key",
      mnemonic: "abandon abandon abandon",
    });
    expect(parsed).not.toBeNull();
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("abandon");
    expect(serialized).not.toContain("spendingKey");
    expect(serialized).not.toContain("mnemonic");
    expect(serialized).not.toContain("seed");
  });

  it("rejects malformed records and mismatched wallet addresses", () => {
    expect(sanitizeStoredClaim(null)).toBeNull();
    expect(
      sanitizeStoredClaim({ ...makeClaim(), requestId: "not-a-uuid" }),
    ).toBeNull();
    expect(
      sanitizeStoredClaim(makeClaim(), `utest1${"z".repeat(80)}`),
    ).toBeNull();
    expect(
      sanitizeStoredClaim({ ...makeClaim(), version: 2 }),
    ).toBeNull();
  });

  it("strips unsafe website URLs from a tampered record", () => {
    const parsed = sanitizeStoredClaim({
      ...makeClaim(),
      websiteUrl: "javascript:alert(1)",
    });
    expect(parsed?.websiteUrl).toBe("");
  });

  it("keeps an external watch record without a request id", () => {
    const parsed = sanitizeStoredClaim({
      ...makeClaim(),
      mode: "external",
      requestId: REQUEST_ID,
      report: null,
    });
    expect(parsed?.mode).toBe("external");
    expect(parsed?.requestId).toBeNull();
    expect(parsed?.report).toBeNull();
  });
});
