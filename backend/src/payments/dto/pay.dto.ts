import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsString, IsNotEmpty, IsOptional, IsNumber, Min, ValidateNested } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class PaymentPartDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber()
  @Min(0)
  amount: number;
}

export class PayDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  // Для смешанной оплаты (method = mixed): сумма наличными и сумма по QR.
  @IsOptional()
  @IsNumber()
  @Min(0)
  cashAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  qrAmount?: number;

  // Для раздельной оплаты: отдельные платежи гостей, сохраняются как split.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentPartDto)
  splitPayments?: PaymentPartDto[];
}
