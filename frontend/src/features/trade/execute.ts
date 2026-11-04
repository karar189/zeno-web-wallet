import { walletServiceUrl } from "@/features/faucet/client";
import { authorizedHeaders } from "@/features/session/vault";
import { refundError } from "@/features/trade/quote";

export async function sendMainnetDeposit(input: {
  depositAddress: string;
  amountZatoshis: string;
}): Promise<{ txids: string[] }> {
  if (refundError(input.depositAddress)) {
    throw new Error("The deposit address is not a transparent mainnet address.");
  }
  if (!/^\d+$/.test(input.amountZatoshis) || input.amountZatoshis === "0") {
    throw new Error("The deposit amount is not a positive number of zatoshis.");
  }
  const quote = await walletPost("/api/wallet/quote", {
    recipient: input.depositAddress,
    amountZatoshis: input.amountZatoshis,
  });
  if (
    typeof quote.quoteId !== "string" ||
    typeof quote.feeZatoshis !== "string" ||
    quote.recipient !== input.depositAddress ||
    quote.amountZatoshis !== input.amountZatoshis
  ) {
    throw new Error(
      typeof quote.note === "string"
        ? quote.note
        : "The wallet could not quote this deposit.",
    );
  }
  const sent = await walletPost("/api/wallet/send", {
    quoteId: quote.quoteId,
    approved: true,
    recipient: input.depositAddress,
    amountZatoshis: input.amountZatoshis,
    feeZatoshis: quote.feeZatoshis,
  });
  if (sent.outcome !== "accepted") {
    throw new Error(
      typeof sent.message === "string"
        ? sent.message
        : "The wallet did not broadcast the deposit.",
    );
  }
  const txids = Array.isArray(sent.txids)
    ? sent.txids.filter((item): item is string => typeof item === "string")
    : [];
  return { txids };
}

async function walletPost(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const headers = await authorizedHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${walletServiceUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
  });
  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok || !payload) {
    throw new Error(
      payload && typeof payload.message === "string"
        ? payload.message
        : "The wallet service refused the deposit.",
    );
  }
  return payload;
}
