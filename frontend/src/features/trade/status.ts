import { oneClick } from "@/features/trade/oneclick";
import { refundError } from "@/features/trade/quote";

export const SWAP_STATUSES = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "PROCESSING",
  "SUCCESS",
  "INCOMPLETE_DEPOSIT",
  "REFUNDED",
  "FAILED",
] as const;

export type SwapStatusCode = (typeof SWAP_STATUSES)[number];

export type SwapStatus = {
  status: SwapStatusCode;
  depositAddress: string;
  updatedAt: string;
  note: string;
};

const TERMINAL = new Set<SwapStatusCode>(["SUCCESS", "REFUNDED", "FAILED"]);

export function isTerminalSwapStatus(status: SwapStatusCode): boolean {
  return TERMINAL.has(status);
}

export function describeSwapStatus(status: SwapStatusCode): string {
  switch (status) {
    case "PENDING_DEPOSIT":
      return "1Click is waiting for the ZEC deposit.";
    case "KNOWN_DEPOSIT_TX":
      return "1Click saw the deposit transaction.";
    case "PROCESSING":
      return "1Click is executing the swap.";
    case "SUCCESS":
      return "The destination tokens were delivered.";
    case "INCOMPLETE_DEPOSIT":
      return "The deposit amount was below the quoted amount.";
    case "REFUNDED":
      return "The swap was refunded to the transparent refund address.";
    case "FAILED":
      return "The swap failed. Check the refund address and explorer.";
  }
}

export function validateDepositAddress(address: string): string {
  const value = address.trim();
  const error = refundError(value);
  if (error) {
    throw new Error("Enter the transparent Zcash deposit address from the quote.");
  }
  return value;
}

export function validateTxHash(txHash: string): string {
  const value = txHash.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Enter a 64-character Zcash transaction id.");
  }
  return value.toLowerCase();
}

function asStatus(raw: unknown, depositAddress: string): SwapStatus {
  const record = (raw ?? {}) as Record<string, unknown>;
  const status =
    typeof record.status === "string" ? record.status : "";
  if (!SWAP_STATUSES.includes(status as SwapStatusCode)) {
    throw new Error("1Click returned an unrecognized swap status.");
  }
  return {
    status: status as SwapStatusCode,
    depositAddress,
    updatedAt: new Date().toISOString(),
    note: describeSwapStatus(status as SwapStatusCode),
  };
}

export async function fetchSwapStatus(
  depositAddress: string,
  fetcher: typeof fetch = fetch,
): Promise<SwapStatus> {
  const address = validateDepositAddress(depositAddress);
  const result = await oneClick(
    `status?depositAddress=${encodeURIComponent(address)}`,
    fetcher,
  );
  return asStatus(result, address);
}

export async function submitDepositHash(
  input: { depositAddress: string; txHash: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const depositAddress = validateDepositAddress(input.depositAddress);
  const txHash = validateTxHash(input.txHash);
  await oneClick("deposit/submit", fetcher, { depositAddress, txHash });
}
