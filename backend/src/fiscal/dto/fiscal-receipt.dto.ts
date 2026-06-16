import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { FiscalPaymentType, FiscalSection } from '../fiscal.interface';

export class FiscalReceiptItemDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsInt()
  @Min(1)
  quantity!: number;
}

/** Полезная нагрузка для пробития фискального чека (на случай прямого вызова провайдера). */
export class FiscalReceiptDto {
  @IsString()
  orderId!: string;

  @IsString()
  orderNumber!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FiscalReceiptItemDto)
  items!: FiscalReceiptItemDto[];

  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsIn(['cash', 'card', 'qr', 'mixed'])
  paymentType!: FiscalPaymentType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashAmount?: number;

  @IsOptional()
  @IsIn([1, 2])
  section?: FiscalSection;
}
