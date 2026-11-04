import { Body, Controller, Post } from '@nestjs/common';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { QuotesService } from './quotes.service.js';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  create(@Body() dto: CreateQuoteDto) {
    return this.quotesService.getQuotes(dto);
  }
}
