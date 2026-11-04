import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class CreateQuoteDto {
  @IsString()
  @IsNotEmpty()
  inputAsset!: string;

  @IsString()
  @IsNotEmpty()
  outputAsset!: string;

  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  destinationChain!: string;

  @IsIn(['demo', 'live'])
  mode!: 'demo' | 'live';
}
