import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, Max, Min, ValidateNested } from 'class-validator';

export const processingMethods = ['cleaning', 'boiling', 'frying', 'stewing', 'baking'] as const;
export const processingBases = ['gross', 'net', 'manual'] as const;
export type ProcessingBasis = typeof processingBases[number];
export type ProcessingStage = { method: typeof processingMethods[number]; lossPercent: number };

export class ProcessingStageDto implements ProcessingStage {
  @IsIn(processingMethods)
  method: typeof processingMethods[number];

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(-999.99) @Max(100)
  lossPercent: number;
}

export class ProcessingOptionsDto {
  @IsOptional() @IsNumber() @Min(0)
  netAmount?: number | null;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(99_999_999_999.999)
  measuredNetWeightGrams?: number | null;

  @IsOptional() @IsNumber() @Max(100)
  lossPercent?: number;

  @IsOptional() @IsIn(processingMethods)
  processingMethod?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ProcessingStageDto)
  processingStages?: ProcessingStageDto[] | null;

  @IsOptional() @IsIn(processingBases)
  processingBasis?: ProcessingBasis;
}
