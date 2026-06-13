import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelOrderItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  reason: string;
}
