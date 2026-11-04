import type { TransportStatus } from "@/features/transport/client";

export type PrivacyRequirements = {
  shieldedOnly: boolean;
  noSwapProvider: boolean;
  /** Opt-in: wallet traffic must reach lightwalletd through a running Nym (SOCKS5) proxy. */
  mixnetOnly?: boolean;
};
export type PrivacyFacts = {
  receiver: "shielded" | "transparent" | "unknown";
  provider: boolean;
  verified: boolean;
  /** How the wallet service reaches lightwalletd, when known. */
  network?: TransportStatus["kind"];
};
export const DEFAULT_REQUIREMENTS: PrivacyRequirements = {
  shieldedOnly: true,
  noSwapProvider: true,
};
export function assessRequirements(
  facts: PrivacyFacts,
  requirements: PrivacyRequirements,
): string[] {
  const blockers: string[] = [];
  if (
    requirements.shieldedOnly &&
    (facts.receiver !== "shielded" || !facts.verified)
  ) {
    blockers.push(
      facts.receiver === "transparent"
        ? "This route uses a transparent Zcash receiver."
        : "A shielded receiver has not been verified.",
    );
  }
  if (requirements.noSwapProvider && facts.provider)
    blockers.push("This route requires an external swap provider.");
  if (requirements.mixnetOnly && facts.network !== "mixnet")
    blockers.push(
      facts.network === "proxy-down"
        ? "The Nym proxy is configured but not running."
        : facts.network === "direct"
          ? "Wallet traffic goes directly to lightwalletd, not through Nym."
          : "The wallet service did not confirm that its traffic goes through Nym.",
    );
  return blockers;
}
