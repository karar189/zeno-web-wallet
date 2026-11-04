/** ZNS name body: 1–63 lowercase letters or digits (SDK / mint rule). */
const NAME_BODY = /^[a-z0-9]{1,63}$/;

/** Explicit name suffixes used in the pay-by-name demo (`alice.zcash`). */
const NAME_SUFFIX = /\.(zcash|zec)$/i;

export type ParsedZcashName = {
  /** Canonical registry name without suffix. */
  name: string;
  /** Display form with `.zcash` suffix. */
  display: string;
};

/**
 * Detect a Zcash name for forward lookup.
 * Requires an explicit `.zcash` or `.zec` suffix so partial addresses are not
 * treated as names. Bare labels like `alice` stay raw address input.
 */
export function parseZcashNameInput(raw: string): ParsedZcashName | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  if (!NAME_SUFFIX.test(trimmed)) {
    return null;
  }
  const withoutSuffix = trimmed.replace(NAME_SUFFIX, "").toLowerCase();
  if (!NAME_BODY.test(withoutSuffix)) {
    return null;
  }
  return {
    name: withoutSuffix,
    display: `${withoutSuffix}.zcash`,
  };
}

export function looksLikeZcashName(raw: string): boolean {
  return parseZcashNameInput(raw) !== null;
}

export function formatZcashName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(NAME_SUFFIX, "");
  return `${normalized}.zcash`;
}
