import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsInt, IsNotEmpty, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

class SplitOrderItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  itemId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class SplitOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey: string;

  @IsISO8601({ strict: true })
  expectedUpdatedAt: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(150)
  @ValidateNested({ each: true })
  @Type(() => SplitOrderItemDto)
  items: SplitOrderItemDto[];
}
