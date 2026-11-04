"use client";

import { create } from "zustand";
import type { WalletStatus } from "@/types/domain";

type WalletState = {
  status: WalletStatus;
  publicAddress: string | null;
  setStatus: (status: WalletStatus) => void;
  setPublicAddress: (address: string | null) => void;
  reset: () => void;
};

export const useWalletStore = create<WalletState>((set) => ({
  status: "disconnected",
  publicAddress: null,
  setStatus: (status) => set({ status }),
  setPublicAddress: (publicAddress) => set({ publicAddress }),
  reset: () => set({ status: "disconnected", publicAddress: null }),
}));
