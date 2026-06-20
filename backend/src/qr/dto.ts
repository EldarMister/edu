import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Координаты гостя для опциональной гео-проверки присутствия (могут отсутствовать). */
class GuestCoords {
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  lat?: number;

  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  lng?: number;
}

/** Гость идентифицируется секретом из localStorage (без авторизации). */
export class JoinDto {
  @IsOptional() @IsString() @MaxLength(100)
  guestKey?: string;

  /** true — явно начать новый визит после закрытия стола («Сделать новый заказ»). */
  @IsOptional() @IsBoolean()
  reopen?: boolean;
}

export class AddItemDto extends GuestCoords {
  @IsString() @MaxLength(100)
  guestKey!: string;

  @IsString()
  dishId!: string;

  @IsOptional() @IsString()
  variantId?: string;

  @IsInt() @Min(1)
  quantity!: number;

  @IsOptional() @IsString() @MaxLength(200)
  comment?: string;
}

export class UpdateItemDto {
  @IsString() @MaxLength(100)
  guestKey!: string;

  @IsOptional() @IsInt() @Min(1)
  quantity?: number;
}

export class SubmitDto extends GuestCoords {
  @IsString() @MaxLength(100)
  guestKey!: string;
}
