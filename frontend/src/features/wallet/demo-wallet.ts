import type { WalletAdapter } from "@/features/wallet/types";
import type { WalletStatus } from "@/types/domain";

/** Demo wallet — no keys, no signing. Milestone 1+ will wire real adapters. */
export class DemoWalletAdapter implements WalletAdapter {
  private status: WalletStatus = "disconnected";
  private address: string | null = null;

  async getStatus(): Promise<WalletStatus> {
    return this.status;
  }

  async connect(): Promise<void> {
    this.status = "connected";
    this.address = "demo:zaddr…mock";
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
    this.address = null;
  }

  async getPublicAddress(): Promise<string | null> {
    return this.address;
  }
}
