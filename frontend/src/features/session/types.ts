export type WalletSession = {
  locked: boolean;
  hasWallet: boolean;
  hasPassword: boolean;
  legacyUnclaimed: boolean;
};

export type NewWalletStart = {
  createId: string;
  phrase: string;
  expiresAtMs: number;
};

export type VaultPayload = {
  walletId: string;
  kdfSalt: string;
  ciphertext: string;
  birthdayHeight: number | null;
};

export type SessionGrant = {
  sessionToken: string;
};
