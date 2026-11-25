import { Equals, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { WaiterOrderPermissions } from '../orders/order-policy';

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean()
  workShiftApprovalRequired?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  taxesEnabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  receiptPrintRequestsOnly?: boolean;

  @IsOptional() @IsObject()
  waiterOrderPermissions?: WaiterOrderPermissions;
  // ---- Интеграция доставки ----
  @IsOptional() @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional() @IsString() @MaxLength(80)
  cafeName?: string;

  @IsOptional() @IsString() @MaxLength(160)
  address?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone2?: string;

  @IsOptional() @IsString() @MaxLength(120)
  instagram?: string;

  @IsOptional() @IsString() @MaxLength(120)
  website?: string;

  @IsOptional() @IsString() @MaxLength(120)
  receiptText?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsIn(['ru', 'ky'])
  receiptLanguage?: 'ru' | 'ky';

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  receiptPrintCafeName?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  receiptPrintAddress?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  receiptPrintPhone?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(700_000)
  receiptLogoData?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  roundOrderTotal?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  telegramStockAlertsEnabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @Matches(/^(?:-?[1-9]\d{0,15})?$/)
  telegramStockChatId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Equals(0, { message: 'Отдельная плата за обслуживание отключена' })
  serviceChargeAmount?: number;

  @IsOptional() @IsIn(['ru', 'ky'])
  language?: string;

  @IsOptional() @IsBoolean()
  payQr?: boolean;

  @IsOptional() @IsBoolean()
  payCash?: boolean;

  @IsOptional() @IsBoolean()
  payCard?: boolean;

  @IsOptional() @IsBoolean()
  allowNegativeIngredientStock?: boolean;

  @IsOptional() @IsBoolean()
  warehouseProductionEnabled?: boolean;

  @IsOptional() @IsBoolean()
  warehouseProcessingEnabled?: boolean;

  // ---- Экран очереди заказов (табло в зале) ----
  @IsOptional() @IsBoolean()
  queueDisplayEnabled?: boolean;

  @IsOptional() @IsIn(['table', 'number'])
  queueDisplayMode?: string;

  // ---- QR-меню: гео-проверка присутствия ----
  @IsOptional() @IsBoolean()
  qrGeoEnabled?: boolean;

  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  qrGeoLat?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  qrGeoLng?: number;

  @IsOptional() @IsNumber() @Min(20) @Max(5000)
  qrGeoRadius?: number;

  // QR-код как data URL (image/png|jpeg|webp). Пустая строка = удалить QR.
  @IsOptional() @IsString() @MaxLength(5_000_000)
  qrImageUrl?: string;

  // ---- ККМ / фискализация ----
  // Пустая строка = выключить ККМ (нормализуется в null в сервисе). mock — режим эмуляции.
  @IsOptional() @IsIn(['ekassa', 'yakassa', 'mock', ''])
  fiscalProvider?: string;

  @IsOptional() @IsString() @MaxLength(255)
  fiscalEkassaApiKey?: string;

  @IsOptional() @IsString() @MaxLength(255)
  fiscalEkassaUrl?: string;

  @IsOptional() @IsString() @MaxLength(32)
  fiscalEkassaInn?: string;

  @IsOptional() @IsString() @MaxLength(255)
  fiscalYakassaApiKey?: string;

  @IsOptional() @IsString() @MaxLength(255)
  fiscalYakassaUrl?: string;
}
