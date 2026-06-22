import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @IsString() @MaxLength(100)
  login!: string;

  @IsString() @MaxLength(200)
  password!: string;
}

export class CreateCafeDto {
  @IsString() @MinLength(2) @MaxLength(120)
  cafeName!: string;

  @IsString() @MinLength(2) @MaxLength(120)
  ownerName!: string;

  @IsString() @MaxLength(40)
  ownerPhone!: string;

  @IsString() @MinLength(4) @MaxLength(200)
  ownerPassword!: string;
}

export class SuspendCafeDto {
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

export class UpdateSubscriptionDto {
  // ISO-дата «оплачено до». null/пусто — снять дату.
  @IsOptional() @IsISO8601()
  paidUntil?: string | null;

  // Возобновить кафе, если стоит будущая дата (по умолчанию true).
  @IsOptional() @IsBoolean()
  resumeIfPaid?: boolean;
}
