import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class DeliveryMenuModifierItemDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  id: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsNumber() @Min(0)
  price: number;

  @IsBoolean()
  available: boolean;

  @IsOptional() @IsInt() @Min(1)
  maxQuantity: number | null;
}

class DeliveryMenuModifierGroupDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  id: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsIn(['single', 'multiple'])
  selectionType: 'single' | 'multiple';

  @IsBoolean()
  required: boolean;

  @IsInt() @Min(0)
  minSelections: number;

  @IsOptional() @IsInt() @Min(1)
  maxSelections: number | null;

  @IsIn(['per-product', 'per-line'])
  priceScope: 'per-product' | 'per-line';

  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => DeliveryMenuModifierItemDto)
  items: DeliveryMenuModifierItemDto[];
}

class DeliveryMenuProductDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  id: string;

  @IsInt() @Min(1)
  sourceId: number;

  @IsString() @IsNotEmpty() @MaxLength(160)
  slug: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsString() @MaxLength(2_000)
  description: string;

  @IsString() @MaxLength(2_000)
  composition: string;

  @IsString() @MaxLength(2_000)
  imageUrl: string;

  @IsNumber() @Min(0)
  price: number;

  @IsOptional() @IsNumber() @Min(0)
  originalPrice: number | null;

  @IsBoolean()
  available: boolean;

  @IsBoolean()
  soldByWeight: boolean;

  @IsOptional() @IsInt() @Min(1)
  weightGrams: number | null;

  @IsInt() @Min(0)
  sortOrder: number;

  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DeliveryMenuModifierGroupDto)
  modifiers: DeliveryMenuModifierGroupDto[];
}

class DeliveryMenuCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  id: string;

  @IsInt() @Min(1)
  sourceId: number;

  @IsString() @IsNotEmpty() @MaxLength(160)
  slug: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsString() @MaxLength(2_000)
  imageUrl: string;

  @IsInt() @Min(0)
  sortOrder: number;

  @IsArray() @ArrayMaxSize(1_000) @ValidateNested({ each: true }) @Type(() => DeliveryMenuProductDto)
  products: DeliveryMenuProductDto[];
}

export class ImportDeliveryMenuDto {
  @Equals('nakta-sushi')
  source: 'nakta-sushi';

  @IsString() @IsNotEmpty() @MaxLength(80)
  regionSlug: string;

  @IsString() @IsNotEmpty() @MaxLength(80)
  menuSourceRegionSlug: string;

  @IsISO8601()
  exportedAt: string;

  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DeliveryMenuCategoryDto)
  categories: DeliveryMenuCategoryDto[];
}
