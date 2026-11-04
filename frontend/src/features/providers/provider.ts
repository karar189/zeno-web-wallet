import type { RouteQuote } from "@/types/domain";

export type QuoteRequest = {
  inputAsset: string;
  outputAsset: string;
  amount: string;
  destinationChain: string;
  mode: "demo" | "live";
};

export type QuotesResponse = {
  quotes: RouteQuote[];
  dataSource: "live" | "mock";
  limitations: string[];
};

export interface QuoteProviderClient {
  fetchQuotes(request: QuoteRequest): Promise<QuotesResponse>;
}
