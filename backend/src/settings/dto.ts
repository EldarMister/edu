import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(80)
  cafeName?: string;

  @IsOptional() @IsString() @MaxLength(160)
  address?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone2?: string;

  @IsOptional() @IsString() @MaxLength(120)
  receiptText?: string;

  @IsOptional() @IsNumber() @Min(0) @Max(100000)
  serviceChargeAmount?: number;

  @IsOptional() @IsIn(['ru', 'ky'])
  language?: string;

  @IsOptional() @IsBoolean()
  payQr?: boolean;

  @IsOptional() @IsBoolean()
  payCash?: boolean;

  @IsOptional() @IsBoolean()
  payCard?: boolean;

  // QR-код как data URL (image/png|jpeg|webp). Пустая строка = удалить QR.
  @IsOptional() @IsString() @MaxLength(5_000_000)
  qrImageUrl?: string;
}
