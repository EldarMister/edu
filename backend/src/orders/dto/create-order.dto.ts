import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @IsString()
  @IsNotEmpty()
  dishId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;
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
