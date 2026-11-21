import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SetComponentAction } from '@prisma/client';

export class SetComponentInputDto {
  @IsString()
  @IsNotEmpty()
  originalDishId: string;

  /** Вариант оригинального блюда состава (например, «1 л»), если он был выбран в сете. */
  @IsOptional()
  @IsString()
  originalVariantId?: string;

  @IsOptional()
  @IsString()
  finalDishId?: string;

  @IsOptional()
  @IsString()
  finalVariantId?: string;

  @IsEnum(SetComponentAction)
  action: SetComponentAction;
}

class OrderModifierSelectionDto {
  @IsString() @IsNotEmpty() optionId: string;
  @IsInt() @Min(1) quantity: number;
}

export class CreateOrderItemDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderModifierSelectionDto)
  modifierSelections?: OrderModifierSelectionDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  excludedIngredientIds?: string[];
  /** Stable existing line identifier when editing; ignored for creation. */
  @IsOptional()
  @IsString()
  id?: string;
  @IsString()
  @IsNotEmpty()
  dishId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  /** Количество в базовых единицах: граммах либо миллилитрах. */
  @IsOptional()
  @IsInt()
  @Min(1)
  weightGrams?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;

  /** «С собой» (навынос) — кухня видит, что позицию нужно упаковать. */
  @IsOptional()
  @IsBoolean()
  takeaway?: boolean;

  /** Состав сета с изменениями (только для блюд-сетов). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetComponentInputDto)
  setComponents?: SetComponentInputDto[];
}

export class OrderCompositionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  /** Защита от двойного нажатия «Отправить на кухню». */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Добавьте хотя бы одно блюдо' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}

export class CreateOrderDto extends OrderCompositionDto {
  @IsString()
  @IsNotEmpty()
  tableId: string;
}

export class CreateTerminalDeliveryDto extends OrderCompositionDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(40)
  @Matches(/^\+?(?:[ ()-]*\d){6,15}[ ()-]*$/, { message: 'Укажите корректный телефон клиента' })
  customerPhone: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty({ message: 'Укажите адрес доставки' })
  @MaxLength(300)
  deliveryAddress: string;
}
