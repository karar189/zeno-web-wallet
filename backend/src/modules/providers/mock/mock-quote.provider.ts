import { Injectable } from '@nestjs/common';
import type { RouteQuote } from '../../../shared/types/domain.js';
import type {
  QuoteProvider,
  QuoteRequest,
} from '../interfaces/quote-provider.interface.js';

@Injectable()
export class MockQuoteProvider implements QuoteProvider {
  readonly name = 'mock';

  async getQuotes(_request: QuoteRequest): Promise<RouteQuote[]> {
    return [];
  }
}
