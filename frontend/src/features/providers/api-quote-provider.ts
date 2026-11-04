import { apiPost } from "@/lib/api-client";
import type {
  QuoteProviderClient,
  QuoteRequest,
  QuotesResponse,
} from "@/features/providers/provider";

export class ApiQuoteProvider implements QuoteProviderClient {
  async fetchQuotes(request: QuoteRequest): Promise<QuotesResponse> {
    return apiPost<QuotesResponse, QuoteRequest>("/quotes", request);
  }
}

export const apiQuoteProvider = new ApiQuoteProvider();
