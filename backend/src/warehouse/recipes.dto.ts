import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MenuModifiersDto } from './menu-modifiers';
import { ProcessingOptionsDto } from './recipe-processing.dto';

export class RecipeItemUpdateDto extends ProcessingOptionsDto {
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(16) unit?: string;
  @IsOptional() @IsBoolean() fromCommonWarehouse?: boolean;
  @IsOptional() @IsString() warehouseId?: string | null;
  @IsOptional() @IsObject() variantAmounts?: Record<string, number>;
}

export class RecipeItemInputDto extends RecipeItemUpdateDto {
  @IsString() ingredientId: string;
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

export class RecipePreviewDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) dishId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) categoryId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) prepStation?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) variantId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) producedStockIngredientId?: string | null;
  @IsOptional() @IsIn([1, 100, 1000]) weightedPriceBase?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999.99) price?: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) taxId?: string | null;
  @IsOptional() @IsBoolean() taxExempt?: boolean;
  @IsOptional() @ValidateNested() @Type(() => RecipeMetadataDto) metadata?: RecipeMetadataDto;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => RecipeItemInputDto)
  items: RecipeItemInputDto[];
}

export class RecipeCostsQuery {
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(4830) dishIds?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
