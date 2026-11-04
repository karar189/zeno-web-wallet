export type TransactionDisclosureCapability = {
  implemented: boolean;
  saplingZip311: boolean;
  orchard: boolean;
  reason: string;
};

export type DisclosureSyncState = "synced" | "syncing" | "stale" | "unknown";

export type DisclosureStatus = {
  created: boolean;
  network: "testnet";
  accountIndex: number | null;
  address: string | null;
  birthdayHeight: number | null;
  detectedZatoshis: string | null;
  spendableZatoshis: string | null;
  sync: DisclosureSyncState;
  note: string;
  transactionDisclosure: TransactionDisclosureCapability;
};

export type DisclosureExportRequest = {
  exportId: string;
  expiresAtMs: number;
  network: "testnet";
  accountIndex: number;
  note: string;
  transactionDisclosure: TransactionDisclosureCapability;
};

export type DisclosureScope = {
  account: string;
  incoming: string[];
  outgoing: string[];
  canSpend: boolean;
  seesPrimaryAccount: boolean;
  provesSenderIdentity: boolean;
};

export type DisclosureKey = {
  exportId: string;
  network: "testnet";
  accountIndex: number;
  ufvk: string;
  uivk: string;
  scope: DisclosureScope;
  warning: string;
  transactionDisclosure: TransactionDisclosureCapability;
};
