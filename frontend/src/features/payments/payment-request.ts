import { parseZecToZatoshis } from "@/features/payments/amount";
import { readPreferredNetwork } from "@/features/network/preference";
import type { Network, PaymentRequest } from "@/features/payments/types";

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type AddressPool = "sapling" | "unified" | "transparent";

export type RequestValidation =
  | { ok: true; request: PaymentRequest; pool: AddressPool }
  | { ok: false; reason: string };

function usesCharset(value: string, alphabet: string): boolean {
  return [...value].every((character) => alphabet.includes(character));
}

export function isShieldedPool(pool: AddressPool): boolean {
  return pool === "sapling" || pool === "unified";
}

export function classifyTestnetRecipient(
  address: string,
): { ok: true; pool: AddressPool } | { ok: false; reason: string } {
  if (address.length === 0 || /\s/.test(address)) {
    return { ok: false, reason: "Enter a testnet Zcash address." };
  }

  if (
    address.startsWith("t1") ||
    address.startsWith("t3") ||
    address.startsWith("zs1") ||
    address.startsWith("u1")
  ) {
    return {
      ok: false,
      reason: "This is a mainnet address. This demo only accepts testnet recipients.",
    };
  }

  if (address.startsWith("tm") || address.startsWith("t2")) {
    const body = address.slice(2);
    if (body.length < 20 || !usesCharset(body, BASE58)) {
      return { ok: false, reason: "Transparent testnet address has invalid characters." };
    }
    return { ok: true, pool: "transparent" };
  }

  if (address.startsWith("ztestsapling")) {
    const body = address.slice("ztestsapling".length);
    if (!body.startsWith("1") || body.length < 21 || !usesCharset(body.slice(1), BECH32)) {
      return { ok: false, reason: "Sapling testnet address has invalid characters." };
    }
    return { ok: true, pool: "sapling" };
  }

  if (address.startsWith("utest1")) {
    const body = address.slice("utest1".length);
    if (body.length < 20 || !usesCharset(body, BECH32)) {
      return { ok: false, reason: "Unified testnet address has invalid characters." };
    }
    return { ok: true, pool: "unified" };
  }

  return {
    ok: false,
    reason: "Recipient is not a supported testnet address.",
  };
}

export function classifyMainnetRecipient(
  address: string,
): { ok: true; pool: AddressPool } | { ok: false; reason: string } {
  if (address.length === 0 || /\s/.test(address)) {
    return { ok: false, reason: "Enter a mainnet Zcash address." };
  }
  if (
    address.startsWith("tm") ||
    address.startsWith("t2") ||
    address.startsWith("ztestsapling") ||
    address.startsWith("utest1")
  ) {
    return {
      ok: false,
      reason: "This is a testnet address. Mainnet payments refuse it.",
    };
  }
  if (address.startsWith("t1") || address.startsWith("t3")) {
    const body = address.slice(2);
    if (body.length < 20 || !usesCharset(body, BASE58)) {
      return { ok: false, reason: "Transparent mainnet address has invalid characters." };
    }
    return { ok: true, pool: "transparent" };
  }
  if (address.startsWith("zs1")) {
    const body = address.slice(3);
    if (body.length < 20 || !usesCharset(body, BECH32)) {
      return { ok: false, reason: "Sapling mainnet address has invalid characters." };
    }
    return { ok: true, pool: "sapling" };
  }
  if (address.startsWith("u1")) {
    const body = address.slice(2);
    if (body.length < 20 || !usesCharset(body, BECH32)) {
      return { ok: false, reason: "Unified mainnet address has invalid characters." };
    }
    return { ok: true, pool: "unified" };
  }
  return {
    ok: false,
    reason: "Recipient is not a supported mainnet address.",
  };
}

export function validatePaymentRequest(input: {
  recipient: string;
  amountZec: string | null;
  network?: Network;
}): RequestValidation {
  const recipient = input.recipient.trim();
  const network =
    input.network ??
    (typeof window === "undefined" ? "testnet" : readPreferredNetwork());
  const classified =
    network === "mainnet"
      ? classifyMainnetRecipient(recipient)
      : classifyTestnetRecipient(recipient);
  if (!classified.ok) {
    return classified;
  }

  if (input.amountZec !== null && input.amountZec.trim().length > 0) {
    const amount = parseZecToZatoshis(input.amountZec);
    if (!amount.ok) {
      return amount;
    }
  }

  return {
    ok: true,
    pool: classified.pool,
    request: {
      recipient,
      amountZec:
        input.amountZec === null || input.amountZec.trim().length === 0
          ? null
          : input.amountZec.trim(),
      network,
      memo: null,
    },
  };
}

export function encodePaymentUri(request: {
  recipient: string;
  amountZec: string | null;
}): string {
  const base = `zcash:${request.recipient}`;
  if (request.amountZec === null || request.amountZec.trim().length === 0) {
    return base;
  }
  const params = new URLSearchParams();
  params.set("amount", request.amountZec.trim());
  return `${base}?${params.toString()}`;
}

export function parsePaymentUri(raw: string): RequestValidation {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("zcash:")) {
    return { ok: false, reason: "Payment request must start with zcash:." };
  }

  const withoutScheme = trimmed.slice("zcash:".length);
  const queryIndex = withoutScheme.indexOf("?");
  const recipient = queryIndex === -1 ? withoutScheme : withoutScheme.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : withoutScheme.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  const amountValues = params.getAll("amount");

  if (amountValues.length > 1) {
    return { ok: false, reason: "Payment request contains more than one amount." };
  }

  if (params.has("address") || params.has("recipient")) {
    return {
      ok: false,
      reason: "Payment request tries to override the recipient. It was rejected.",
    };
  }

  return validatePaymentRequest({
    recipient,
    amountZec: amountValues[0] ?? null,
  });
}
