import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional,
  IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const maxMenuPrice = 99999999.99;

export class MenuPriceChangeDto {
  @IsString() @IsNotEmpty() @MaxLength(160)
  dishId: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  variantId?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(maxMenuPrice)
  expectedPrice: number;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(maxMenuPrice)
  price: number;

  @IsIn(['pcs', 'g', 'ml'])
  expectedUnit: 'pcs' | 'g' | 'ml';

  @IsInt() @Min(1)
  expectedPriceBase: number;
}

export class MenuPriceBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsObject({ each: true })
  @ValidateNested({ each: true }) @Type(() => MenuPriceChangeDto)
  changes: MenuPriceChangeDto[];
}
