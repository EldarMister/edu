import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class PurchasePaymentLineDto {
  @IsUUID()
  accountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9999999999.99)
  amount: number;

  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i)
  occurredAt?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class PurchasePaymentsDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,65}$/)
  requestKey: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PurchasePaymentLineDto)
  payments: PurchasePaymentLineDto[];
}

export class PurchaseSettlementReasonDto {
  @IsString() @Matches(/\S/) @MaxLength(500)
  reason: string;
}

export class ReconcilePurchaseDto extends PurchaseSettlementReasonDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99)
  paidAmount: number;
}
