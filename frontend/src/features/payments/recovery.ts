import type { PaymentRecord } from "./types";

// Recovery is tracking-only: no prepared proposal or authorization survives reload.
export function trackingSnapshot(record: PaymentRecord): PaymentRecord {
  const interrupted =
    record.phase === "submitting" ||
    (record.phase === "tracking" && !record.submission);
  return {
    ...record,
    chain: record.chain ?? null,
    preparation: null,
    authorization: null,
    phase: "tracking",
    statusConfidence: interrupted ? "unknown" : record.statusConfidence,
    failure: interrupted
      ? {
          code: "rpc_failure",
          message:
            "The page closed before a definite submission result was saved.",
          recovery:
            "Check the wallet before sending again. This payment will not be retried automatically.",
        }
      : record.failure,
  };
}
export function decodeTracking(
  raw: string,
  kind: "live" | "simulated",
): PaymentRecord[] {
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.records)) return [];
    return data.records
      .slice(0, 8)
      .filter((r: PaymentRecord) => {
        if (
          !r ||
          r.dataSource !== kind ||
          typeof r.id !== "string" ||
          !r.request ||
          r.request.network !== "testnet" ||
          typeof r.request.recipient !== "string" ||
          !r.stages ||
          !Array.isArray(r.warnings)
        )
          return false;
        if (
          typeof r.request.amountZec !== "string" ||
          !/^\d+(\.\d{1,8})?$/.test(r.request.amountZec)
        )
          return false;
        if (
          r.submission &&
          (typeof r.submission.reference !== "string" ||
            r.submission.acceptedForBroadcast !== true ||
            (kind === "live" &&
              !/^[a-fA-F0-9]{64}$/.test(r.submission.reference)))
        )
          return false;
        return r.phase === "tracking" || r.phase === "submitting";
      })
      .map(trackingSnapshot);
  } catch {
    return [];
  }
}
