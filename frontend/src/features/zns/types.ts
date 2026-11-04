import type { Network } from "@/features/payments/types";

export type ZnsResolveResult =
  | {
      ok: true;
      found: true;
      name: string;
      display: string;
      address: string;
      txid: string;
      height: number;
      lastAction: string;
      expiresAt: string;
      network: Network;
    }
  | {
      ok: true;
      found: false;
      name: string;
      display: string;
      network: Network;
    }
  | { ok: false; reason: string };
