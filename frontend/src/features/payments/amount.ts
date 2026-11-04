const ZATOSHIS_PER_ZEC = BigInt(100_000_000);

export function parseZecToZatoshis(
  input: string,
): { ok: true; zatoshis: bigint } | { ok: false; reason: string } {
  const value = input.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(value)) {
    return {
      ok: false,
      reason: "Enter a ZEC amount with at most 8 decimal places.",
    };
  }

  const [whole, fraction = ""] = value.split(".");
  const padded = `${fraction}00000000`.slice(0, 8);
  const zatoshis = BigInt(whole) * ZATOSHIS_PER_ZEC + BigInt(padded);
  if (zatoshis <= BigInt(0)) {
    return { ok: false, reason: "Amount must be greater than zero." };
  }

  return { ok: true, zatoshis };
}

export function formatZatoshis(zatoshis: bigint): string {
  const negative = zatoshis < BigInt(0);
  const absolute = negative ? -zatoshis : zatoshis;
  const whole = absolute / ZATOSHIS_PER_ZEC;
  const fraction = (absolute % ZATOSHIS_PER_ZEC)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  const text = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}
