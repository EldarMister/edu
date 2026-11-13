import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class RecipeItemInputDto {
  @IsString() ingredientId: string;
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(16) unit?: string;
  @IsOptional() @IsBoolean() fromCommonWarehouse?: boolean;
  @IsOptional() @IsString() warehouseId?: string | null;
  @IsOptional() @IsNumber() @Min(0) netAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) lossPercent?: number;
  @IsOptional() @IsIn(['cleaning', 'boiling', 'frying', 'stewing', 'baking']) processingMethod?: string | null;
  @IsOptional() @IsObject() variantAmounts?: Record<string, number>;
}

export class RecipeItemUpdateDto {
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(16) unit?: string;
  @IsOptional() @IsBoolean() fromCommonWarehouse?: boolean;
  @IsOptional() @IsString() warehouseId?: string | null;
  @IsOptional() @IsNumber() @Min(0) netAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) lossPercent?: number;
  @IsOptional() @IsIn(['cleaning', 'boiling', 'frying', 'stewing', 'baking']) processingMethod?: string | null;
  @IsOptional() @IsObject() variantAmounts?: Record<string, number>;
}

class RecipeMetadataDto {
  @IsOptional() @IsString() @MaxLength(12000) instructions?: string;
  @IsOptional() @IsNumber() @Min(0.001) outputQuantity?: number;
  @IsOptional() @IsString() @MaxLength(16) outputUnit?: string;
  @IsOptional() @IsString() @MaxLength(2000) photoUrl?: string;
}

export class RecipeSettingsDto {
  @IsOptional() @IsString() stockIngredientId?: string | null;
  @IsOptional() @IsNumber() @Min(0.001) stockAmount?: number;
  @IsOptional() @IsString() @MaxLength(16) stockUnit?: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @ValidateNested() @Type(() => RecipeMetadataDto) metadata?: RecipeMetadataDto;
}
