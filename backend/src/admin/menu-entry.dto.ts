import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateDishDto, DishVariantDto } from './dto';
import { MAX_RECIPE_PORTIONS, RecipeItemInputDto, RecipeMetadataDto } from '../warehouse/recipes.dto';
import { MenuModifiersDto } from '../warehouse/menu-modifiers';

export class MenuRecipeContentsDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX_RECIPE_PORTIONS) inputPortions?: number;

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
export class MenuRecipeDto extends MenuRecipeContentsDto {
  @IsOptional() @IsString() @MaxLength(160)
  producedStockIngredientId?: string | null;
}
class MenuEntryVariantDto extends DishVariantDto {
  @IsOptional() @IsString() @MaxLength(80) clientKey?: string;
  @IsOptional() @ValidateNested() @Type(() => MenuRecipeContentsDto)
  ownRecipe?: MenuRecipeContentsDto | null;
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
