import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from '../../orders/dto/create-order.dto';

export class CreateDeliveryOrderDto {
  /** Уникальный и стабильный id заказа на стороне сайта/приложения. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  externalOrderId: string;

  @IsOptional() @IsString() @MaxLength(120)
  customerName?: string;

  @IsOptional() @IsString() @MaxLength(40)
  customerPhone?: string;

  @IsOptional() @IsString() @MaxLength(300)
  deliveryAddress?: string;

  @IsOptional() @IsString() @MaxLength(500)
  comment?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Добавьте хотя бы одно блюдо' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
