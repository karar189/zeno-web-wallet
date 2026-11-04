import { parseZecToZatoshis } from "@/features/payments/amount";
import { validatePaymentRequest } from "@/features/payments/payment-request";
import type { PaymentFailure, PaymentRequest, SyncState } from "@/features/payments/types";

export type PreflightResult =
  | { ok: true; amountZatoshis: bigint; feeZatoshis: bigint; warnings: string[] }
  | { ok: false; failure: PaymentFailure };

export function runPreflight(input: {
  request: PaymentRequest;
  sync: SyncState;
  spendableZatoshis: bigint | null;
  feeZatoshis: bigint | null;
  quoteHoldsBalance?: boolean;
}): PreflightResult {
  const validated = validatePaymentRequest({
    recipient: input.request.recipient,
    amountZec: input.request.amountZec,
  });
  if (!validated.ok) {
    return {
      ok: false,
      failure: {
        code: "invalid_request",
        message: validated.reason,
        recovery: "Correct the recipient or amount. Nothing was sent.",
      },
    };
  }

  if (validated.request.recipient !== input.request.recipient) {
    return {
      ok: false,
      failure: {
        code: "invalid_request",
        message: "The recipient changed during validation.",
        recovery: "Start the payment again from the original request.",
      },
    };
  }

  if (input.request.amountZec === null) {
    return {
      ok: false,
      failure: {
        code: "invalid_request",
        message: "Enter an amount before preparing this payment.",
        recovery: "Add a ZEC amount. Nothing was sent.",
      },
    };
  }

  const amount = parseZecToZatoshis(input.request.amountZec);
  if (!amount.ok) {
    return {
      ok: false,
      failure: {
        code: "invalid_request",
        message: amount.reason,
        recovery: "Correct the amount. Nothing was sent.",
      },
    };
  }

  if (input.sync === "stale") {
    return {
      ok: false,
      failure: {
        code: "stale_wallet",
        message: "Wallet state is stale, so it cannot authorize a payment.",
        recovery: "Prepare the payment again after the wallet syncs. Nothing was sent.",
      },
    };
  }

  if (input.sync !== "synced") {
    return {
      ok: false,
      failure: {
        code: "not_ready",
        message: "The wallet is not ready to send.",
        recovery: "Wait until synchronization finishes, then prepare the payment again.",
      },
    };
  }

  if (input.feeZatoshis === null || (!input.quoteHoldsBalance && input.spendableZatoshis === null)) {
    return {
      ok: false,
      failure: {
        code: "not_ready",
        message: "Spendable balance or fee is unverified.",
        recovery: "Prepare the payment again once the wallet reports both values.",
      },
    };
  }

  if (
    !input.quoteHoldsBalance &&
    input.spendableZatoshis !== null &&
    amount.zatoshis + input.feeZatoshis > input.spendableZatoshis
  ) {
    return {
      ok: false,
      failure: {
        code: "insufficient_funds",
        message: "Spendable balance does not cover the amount and fee.",
        recovery: "Lower the amount. The demo balance is a fixture, not a chain balance.",
      },
    };
  }

  return {
    ok: true,
    amountZatoshis: amount.zatoshis,
    feeZatoshis: input.feeZatoshis,
    warnings: [
      "Format check only. This demo does not verify the address checksum.",
    ],
  };
}
