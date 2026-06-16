import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Гость идентифицируется секретом из localStorage (без авторизации). */
export class JoinDto {
  @IsOptional() @IsString() @MaxLength(100)
  guestKey?: string;
}

export class AddItemDto {
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

export class SubmitDto {
  @IsString() @MaxLength(100)
  guestKey!: string;
}
