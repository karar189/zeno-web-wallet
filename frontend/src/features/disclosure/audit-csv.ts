/** One transaction as returned by the wallet service's read-only audit scan. */
export type AuditTransaction = {
  txid: string;
  minedHeight: number | null;
  /** Unix seconds of the mining block. */
  blockTime: number | null;
  kind: "received" | "sent" | "shield" | "other";
  /** Signed zatoshis: the change to the account balance, fee included. */
  netZatoshis: string;
  receivedZatoshis: string;
  spentZatoshis: string;
  feeZatoshis: string | null;
  pools: string[];
  recipients: { address: string; zatoshis: string }[];
  memos: string[];
  /** False when only compact data was available. */
  fullDetails: boolean;
};

const SIGNED_INTEGER = /^-?\d+$/;
const ZATOSHIS_PER_COIN = BigInt(100_000_000);

/** Fixed 8-decimal coin amount from a zatoshi string, exact (no floating point). */
export function coinAmount(zatoshis: string): string {
  if (!SIGNED_INTEGER.test(zatoshis)) throw new Error(`Invalid zatoshi amount: ${zatoshis}`);
  const value = BigInt(zatoshis);
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / ZATOSHIS_PER_COIN;
  const fraction = (absolute % ZATOSHIS_PER_COIN).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** RFC 4180 field. Text from the chain (memos) is neutralized against spreadsheet formulas. */
function field(value: string, { text = false } = {}): string {
  let out = value;
  if (text && /^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  return /[",\r\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

const KIND_LABEL: Record<AuditTransaction["kind"], string> = {
  received: "Received",
  sent: "Sent",
  shield: "Shielding",
  other: "Other",
};

function utcDate(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

/**
 * Accountant-ready CSV of a viewing-key scan: one row per transaction, oldest first,
 * fixed 8-decimal amounts, ISO 8601 UTC dates, CRLF line endings.
 */
export function auditCsv(
  transactions: AuditTransaction[],
  { unit }: { unit: "ZEC" | "TAZ" },
): string {
  const header = [
    "Date (UTC)",
    "Block height",
    "Transaction ID",
    "Type",
    `Amount (${unit})`,
    `Received (${unit})`,
    `Spent (${unit})`,
    `Fee (${unit})`,
    "Pools",
    "Recipients",
    "Memo",
    "Details",
  ];
  const rows = transactions.map((tx) =>
    [
      field(utcDate(tx.blockTime)),
      field(tx.minedHeight === null ? "" : String(tx.minedHeight)),
      field(tx.txid),
      field(KIND_LABEL[tx.kind] ?? "Other"),
      field(coinAmount(tx.netZatoshis)),
      field(coinAmount(tx.receivedZatoshis)),
      field(coinAmount(tx.spentZatoshis)),
      field(tx.feeZatoshis === null ? "" : coinAmount(tx.feeZatoshis)),
      field(tx.pools.join("; "), { text: true }),
      field(
        tx.recipients
          .map((r) => `${r.address} (${coinAmount(r.zatoshis)})`)
          .join("; "),
        { text: true },
      ),
      field(tx.memos.join(" | "), { text: true }),
      field(
        tx.fullDetails
          ? "Full"
          : "Compact only: memo, fee and recipients may be missing",
      ),
    ].join(","),
  );
  return [header.join(","), ...rows].join("\r\n") + "\r\n";
}

export function auditCsvFileName(network: string, scannedHeight: number): string {
  return `zeno-viewing-key-report-${network}-${scannedHeight}.csv`;
}
