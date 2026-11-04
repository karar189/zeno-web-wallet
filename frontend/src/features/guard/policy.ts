export type PrivacyRequirements = {
  shieldedOnly: boolean;
  noSwapProvider: boolean;
};
export type PrivacyFacts = {
  receiver: "shielded" | "transparent" | "unknown";
  provider: boolean;
  verified: boolean;
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
  return blockers;
}
