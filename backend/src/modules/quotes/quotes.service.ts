import { Inject, Injectable } from '@nestjs/common';
import type { RouteQuote } from '../../shared/types/domain.js';
import {
  QUOTE_PROVIDER,
  type QuoteProvider,
} from '../providers/interfaces/quote-provider.interface.js';
import type { CreateQuoteDto } from './dto/create-quote.dto.js';

@Injectable()
export class QuotesService {
  constructor(
    @Inject(QUOTE_PROVIDER) private readonly quoteProvider: QuoteProvider,
  ) {}

  async getQuotes(dto: CreateQuoteDto): Promise<{
    quotes: RouteQuote[];
    dataSource: 'live' | 'mock';
    limitations: string[];
  }> {
    const quotes = await this.quoteProvider.getQuotes({
      inputAsset: dto.inputAsset,
      outputAsset: dto.outputAsset,
      amount: dto.amount,
      destinationChain: dto.destinationChain,
      mode: dto.mode,
    });

    return {
      quotes,
      dataSource: 'mock',
      limitations: [
        'Provider adapters not wired yet; responses are empty mock placeholders.',
        'Do not treat empty quote lists as live market data.',
      ],
    };
  }
}
