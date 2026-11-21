import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

export class OrderRefundSelectionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  itemId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class OrderRefundApprovalDto {
  @IsOptional()
  @IsBoolean()
  fundsReturned?: boolean;

  @IsOptional()
  @IsBoolean()
  restockGoods?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fiscalRefundReference?: string;
}

export class CreateOrderRefundDto extends OrderRefundSelectionDto {
  @Matches(/^[a-zA-Z0-9-]{12,100}$/)
  requestId!: string;

  @Matches(/^[a-f0-9]{64}$/)
  quoteVersion!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderRefundApprovalDto)
  approval?: OrderRefundApprovalDto;
}
