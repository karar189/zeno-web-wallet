import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [ProvidersModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
