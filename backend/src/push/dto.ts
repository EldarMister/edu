import { IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class PushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @IsString()
  @IsOptional()
  userAgent?: string;
}

/** Регистрация мобильного устройства (React Native) для native push. */
export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  pushToken: string;

  @IsString()
  @IsNotEmpty()
  platform: string; // 'android' | 'ios'

  @IsString()
  @IsOptional()
  deviceId?: string;

  @IsString()
  @IsOptional()
  appVersion?: string;
}

export class UnregisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  pushToken: string;
}
