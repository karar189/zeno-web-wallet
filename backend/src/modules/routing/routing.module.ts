import { Module } from '@nestjs/common';
import { RouteScorerService } from './route-scorer.service.js';

@Module({
  providers: [RouteScorerService],
  exports: [RouteScorerService],
})
export class RoutingModule {}
