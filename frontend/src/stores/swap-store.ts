"use client";

import { create } from "zustand";
import type { PrivacyReport, RouteQuote } from "@/types/domain";

export type SwapFormState = {
  inputAsset: string;
  outputAsset: string;
  amount: string;
  destinationChain: string;
  mode: "demo" | "live";
};

type SwapState = SwapFormState & {
  quotes: RouteQuote[];
  dataSource: "live" | "mock" | null;
  quoteLimitations: string[];
  selectedRouteId: string | null;
  privacyReport: PrivacyReport | null;
  isLoadingQuotes: boolean;
  error: string | null;
  setForm: (partial: Partial<SwapFormState>) => void;
  setQuotes: (payload: {
    quotes: RouteQuote[];
    dataSource: "live" | "mock";
    limitations: string[];
  }) => void;
  selectRoute: (routeId: string | null) => void;
  setPrivacyReport: (report: PrivacyReport | null) => void;
  setLoadingQuotes: (loading: boolean) => void;
  setError: (error: string | null) => void;
  resetResults: () => void;
};

const defaultForm: SwapFormState = {
  inputAsset: "ZEC",
  outputAsset: "USDC",
  amount: "0.1",
  destinationChain: "solana",
  mode: "demo",
};

export const useSwapStore = create<SwapState>((set) => ({
  ...defaultForm,
  quotes: [],
  dataSource: null,
  quoteLimitations: [],
  selectedRouteId: null,
  privacyReport: null,
  isLoadingQuotes: false,
  error: null,
  setForm: (partial) => set((state) => ({ ...state, ...partial })),
  setQuotes: ({ quotes, dataSource, limitations }) =>
    set({
      quotes,
      dataSource,
      quoteLimitations: limitations,
      selectedRouteId: quotes[0]?.id ?? null,
      error: null,
    }),
  selectRoute: (selectedRouteId) => set({ selectedRouteId }),
  setPrivacyReport: (privacyReport) => set({ privacyReport }),
  setLoadingQuotes: (isLoadingQuotes) => set({ isLoadingQuotes }),
  setError: (error) => set({ error }),
  resetResults: () =>
    set({
      quotes: [],
      dataSource: null,
      quoteLimitations: [],
      selectedRouteId: null,
      privacyReport: null,
      error: null,
    }),
}));
