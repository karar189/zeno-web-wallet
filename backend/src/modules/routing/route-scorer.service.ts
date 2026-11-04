import { Injectable } from '@nestjs/common';

/** Route comparison and scoring — Milestone 1+ */
@Injectable()
export class RouteScorerService {
  scoreRouteIds(_routeIds: string[]): { rankedRouteIds: string[] } {
    return { rankedRouteIds: [] };
  }
}
