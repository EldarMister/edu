import { IsEnum, IsString, IsNotEmpty } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class PayDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  // На этапе 4 поддерживаем QR и наличку (карта — позже).
  @IsEnum(PaymentMethod)
  method: PaymentMethod;
}
