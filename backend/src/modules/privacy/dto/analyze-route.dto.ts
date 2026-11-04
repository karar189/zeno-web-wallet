import { IsNotEmpty, IsString } from 'class-validator';

export class AnalyzeRouteDto {
  @IsString()
  @IsNotEmpty()
  routeId!: string;
}
