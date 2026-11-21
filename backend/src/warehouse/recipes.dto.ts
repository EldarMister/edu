import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MenuModifiersDto } from './menu-modifiers';

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

export class RecipeMetadataDto {
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

/** Warehouse staff may change the recipe, never the menu's price/name/category. */
export class RecipeDraftDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => RecipeItemInputDto)
  items: RecipeItemInputDto[];
  @IsOptional() @ValidateNested() @Type(() => RecipeMetadataDto) metadata?: RecipeMetadataDto;
  @IsOptional() @ValidateNested() @Type(() => MenuModifiersDto) modifiers?: MenuModifiersDto;
}
