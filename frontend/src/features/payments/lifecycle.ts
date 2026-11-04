import type { PaymentRecord, StatusBoard } from "@/features/payments/types";

const NOT_READY = new Set(["stale_wallet", "not_ready"]);

export function deriveLifecycle(record: PaymentRecord): StatusBoard {
  const simulated = record.dataSource === "simulated";
  const submission = record.submission?.acceptedForBroadcast
    ? "submitted"
    : record.statusConfidence === "unknown"
      ? "unknown"
      : "not_submitted";
  const confirmation = !record.confirmation
    ? "not_confirmed"
    : record.confirmation.met
      ? "confirmed"
      : record.confirmation.source === "unavailable"
        ? "unknown"
        : "not_confirmed";
  const detection = !record.detection
    ? "not_detected"
    : record.detection.detected
      ? "detected"
      : record.detection.source === "unavailable"
        ? "unknown"
        : "not_detected";

  if (record.failure && submission !== "submitted") {
    if (NOT_READY.has(record.failure.code)) {
      return {
        state: "not_ready",
        message: record.failure.message,
        evidence: record.failure.recovery,
        submission,
        confirmation,
        detection,
        simulated,
      };
    }
    if (record.statusConfidence === "unknown") {
      return {
        state: "unknown",
        message: record.failure.message,
        evidence: record.failure.recovery,
        submission,
        confirmation,
        detection,
        simulated,
      };
    }
    return {
      state: "failed",
      message: record.failure.message,
      evidence: record.failure.recovery,
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  if (record.phase === "submitting" && submission !== "submitted") {
    return {
      state: "submitting",
      message: "Completing the send workflow.",
      evidence: "Authorization is recorded. Broadcast acceptance is not available yet.",
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  if (detection === "detected" && record.detection) {
    return {
      state: "received",
      message:
        record.detection.source === "simulated"
          ? "Simulated recipient detection. No recipient wallet scanned the chain."
          : "The backend reported recipient-side detection.",
      evidence: record.detection.note,
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  if (confirmation === "confirmed" && record.confirmation) {
    return {
      state: "confirmed",
      message:
        record.confirmation.source === "simulated"
          ? "Simulated confirmation. No Zcash block was observed."
          : "The backend's confirmation criteria were met.",
      evidence: record.confirmation.criterion,
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  if (submission === "submitted" && record.submission) {
    return {
      state: "submitted",
      message:
        record.submission.source === "simulated"
          ? "Simulated submission. Nothing was broadcast to Zcash."
          : "The backend accepted the transaction for broadcast.",
      evidence: record.submission.note,
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  if (submission === "unknown") {
    return {
      state: "unknown",
      message: "The application cannot reliably establish whether this payment was submitted.",
      evidence: "There is no broadcast acceptance. It will not be retried automatically.",
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  if (record.phase === "awaiting_approval") {
    return {
      state: "awaiting_approval",
      message: "Review the payment and authorize it.",
      evidence: "Preflight passed. No authorization has been recorded.",
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  if (record.phase === "preparing") {
    return {
      state: "preparing",
      message: "Preparing the payment.",
      evidence: "Preparation does not authorize a send.",
      submission,
      confirmation,
      detection,
      simulated,
    };
  }

  return {
    state: "not_ready",
    message: "The wallet is not ready to send.",
    evidence:
      record.sync === "synced"
        ? "No prepared payment is waiting for review."
        : `Synchronization state is ${record.sync}.`,
    submission,
    confirmation,
    detection,
    simulated,
  };
}
