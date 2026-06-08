import { IsEnum, IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

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
}
