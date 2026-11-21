import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateDishDto, DishVariantDto } from './dto';
import { RecipeItemInputDto, RecipeMetadataDto } from '../warehouse/recipes.dto';
import { MenuModifiersDto } from '../warehouse/menu-modifiers';

export class MenuRecipeDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RecipeMetadataDto)
  metadata?: RecipeMetadataDto;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecipeItemInputDto)
  items: RecipeItemInputDto[];
}
class MenuEntryVariantDto extends DishVariantDto {
  @IsOptional() @IsString() @MaxLength(80) clientKey?: string;
}
class MenuEntryDishDto extends CreateDishDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MenuEntryVariantDto)
  variants?: MenuEntryVariantDto[];
}
export class MenuEntryDto {
  @IsIn(['goods', 'recipe']) catalogKind: 'goods' | 'recipe';
  @IsDefined()
  @ValidateNested()
  @Type(() => MenuEntryDishDto)
  dish: MenuEntryDishDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => MenuRecipeDto)
  recipe?: MenuRecipeDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => MenuModifiersDto)
  modifiers?: MenuModifiersDto;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
  @IsOptional() @IsString() @MaxLength(80) requestKey?: string;
}
