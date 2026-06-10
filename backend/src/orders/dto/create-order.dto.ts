import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
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

  @IsEnum(SetComponentAction)
  action: SetComponentAction;
}

export class CreateOrderItemDto {
  @IsString()
  @IsNotEmpty()
  dishId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;

  /** Состав сета с изменениями (только для блюд-сетов). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetComponentInputDto)
  setComponents?: SetComponentInputDto[];
}

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  tableId: string;

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
