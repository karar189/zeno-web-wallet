export type DataSource = "live" | "mock";

export type RouteQuote = {
  id: string;
  provider: string;
  input: {
    asset: string;
    amount: string;
    chain: string;
  };
  output: {
    asset: string;
    estimatedAmount: string;
    chain: string;
  };
  fees: {
    network: string | null;
    provider: string | null;
    total: string | null;
    currency: string | null;
  };
  estimatedSlippageBps: number | null;
  estimatedDurationSeconds: number | null;
  routeSteps: Array<{
    label: string;
    chain: string;
    publicActivityExpected: boolean | null;
  }>;
  trust: {
    bridgeRequired: boolean;
    custodianRequired: boolean | null;
    settlementModel: string;
    dependencies: string[];
  };
  dataSource: DataSource;
  limitations: string[];
};

export type PrivacyCategory =
  | "address_exposure"
  | "amount_exposure"
  | "linkability"
  | "network_metadata"
  | "trust_assumption"
  | "coverage_gap";

export type PrivacyFinding = {
  id: string;
  category: PrivacyCategory;
  severity: "low" | "medium" | "high" | "unknown";
  claim: string;
  evidence: string;
  mitigation?: string;
  confidence: "documented" | "observed" | "inferred" | "unknown";
};

export type PrivacyReport = {
  routeId: string;
  findings: PrivacyFinding[];
  assessedAt: string;
  coverage: "partial" | "complete";
  limitations: string[];
};

export type WalletStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "unsupported"
  | "error";
