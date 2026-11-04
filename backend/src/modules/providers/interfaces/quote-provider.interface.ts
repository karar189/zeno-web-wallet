import type { RouteQuote } from '../../../shared/types/domain.js';

export type QuoteRequest = {
  inputAsset: string;
  outputAsset: string;
  amount: string;
  destinationChain: string;
  mode: 'demo' | 'live';
};

export interface QuoteProvider {
  readonly name: string;
  getQuotes(request: QuoteRequest): Promise<RouteQuote[]>;
}

export const QUOTE_PROVIDER = Symbol('QUOTE_PROVIDER');
