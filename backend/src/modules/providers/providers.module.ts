import { Module } from '@nestjs/common';
import { MockQuoteProvider } from './mock/mock-quote.provider.js';
import { QUOTE_PROVIDER } from './interfaces/quote-provider.interface.js';

@Module({
  providers: [
    MockQuoteProvider,
    {
      provide: QUOTE_PROVIDER,
      useExisting: MockQuoteProvider,
    },
  ],
  exports: [QUOTE_PROVIDER, MockQuoteProvider],
})
export class ProvidersModule {}
