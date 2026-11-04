import { Body, Controller, Post } from '@nestjs/common';
import { AnalyzeRouteDto } from './dto/analyze-route.dto.js';
import { PrivacyService } from './privacy.service.js';

@Controller('analyze')
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Post()
  analyze(@Body() dto: AnalyzeRouteDto) {
    return this.privacyService.analyzeRoute(dto);
  }
}
