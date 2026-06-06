import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateOrderItemDto } from './create-order.dto';

export class EditOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Добавьте хотя бы одно блюдо' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
