import type { StageMeasurement, Trial } from "@/features/payments/types";

export type ExperimentalResult = {
  name: string;
  integration: "not_integrated";
  claimsProjectTachyon: false;
  onPaymentPath: false;
  measurementKind: "simulated";
  finding: string;
  stages: {
    proof: StageMeasurement;
  };
};

export const experimentalProbe = {
  name: "Tachyon-inspired proof-state sketch",
  integration: "not_integrated" as const,
  claimsProjectTachyon: false as const,
  onPaymentPath: false as const,
  describe(): string {
    return "Isolated prototype. It does not generate proofs, does not submit transactions, and is not an integration of Project Tachyon.";
  },
  run(): ExperimentalResult {
    return {
      name: experimentalProbe.name,
      integration: "not_integrated",
      claimsProjectTachyon: false,
      onPaymentPath: false,
      measurementKind: "simulated",
      finding:
        "No payment-path bottleneck was reduced. The probe is not connected to the transaction backend.",
      stages: {
        proof: {
          status: "unavailable",
          reason: "No proof system is connected to this prototype.",
        },
      },
    };
  },
};

export function experimentalTrial(): Trial {
  const result = experimentalProbe.run();
  return {
    id: "experimental_probe",
    mode: "experimental",
    measurementKind: result.measurementKind,
    coldStart: true,
    outcome: "incomplete",
    failureCode: null,
    stages: result.stages,
  };
}
