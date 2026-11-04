import type { WalletStatus } from "@/types/domain";

export type { WalletStatus };

export interface WalletAdapter {
  getStatus(): Promise<WalletStatus>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getPublicAddress(): Promise<string | null>;
}
