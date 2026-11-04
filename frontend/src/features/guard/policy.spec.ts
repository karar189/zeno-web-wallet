import { describe, it, expect } from "vitest";
import { assessRequirements, DEFAULT_REQUIREMENTS } from "./policy";
describe("privacy requirements", () => {
  it("blocks transparent provider routes on both defaults", () =>
    expect(
      assessRequirements(
        { receiver: "transparent", provider: true, verified: true },
        DEFAULT_REQUIREMENTS,
      ),
    ).toHaveLength(2));
  it("does not certify unverified receivers", () =>
    expect(
      assessRequirements(
        { receiver: "shielded", provider: false, verified: false },
        DEFAULT_REQUIREMENTS,
      ),
    ).toHaveLength(1));
  it("allows verified shielded payments", () =>
    expect(
      assessRequirements(
        { receiver: "shielded", provider: false, verified: true },
        DEFAULT_REQUIREMENTS,
      ),
    ).toEqual([]));
  it("requires explicit relaxation for transparent swaps", () =>
    expect(
      assessRequirements(
        { receiver: "transparent", provider: true, verified: true },
        { shieldedOnly: false, noSwapProvider: false },
      ),
    ).toEqual([]));
  it("blocks transparent testnet sends until shieldedOnly is off", () => {
    expect(
      assessRequirements(
        { receiver: "transparent", provider: false, verified: true },
        DEFAULT_REQUIREMENTS,
      ),
    ).toEqual(["This route uses a transparent Zcash receiver."]);
    expect(
      assessRequirements(
        { receiver: "transparent", provider: false, verified: true },
        { shieldedOnly: false, noSwapProvider: true },
      ),
    ).toEqual([]);
  });
  it("requires a running mixnet proxy only when asked", () => {
    const facts = { receiver: "shielded" as const, provider: false, verified: true };
    const strict = { ...DEFAULT_REQUIREMENTS, mixnetOnly: true };
    expect(assessRequirements({ ...facts, network: "direct" }, DEFAULT_REQUIREMENTS)).toEqual([]);
    expect(assessRequirements({ ...facts, network: "mixnet" }, strict)).toEqual([]);
    expect(assessRequirements({ ...facts, network: "direct" }, strict)).toEqual([
      "Wallet traffic goes directly to lightwalletd, not through Nym.",
    ]);
    expect(assessRequirements({ ...facts, network: "proxy-down" }, strict)).toEqual([
      "The Nym proxy is configured but not running.",
    ]);
    expect(assessRequirements(facts, strict)).toHaveLength(1);
  });
});
