import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectDto {
  @IsString()
  @IsNotEmpty({ message: 'Укажите причину отказа' })
  @MaxLength(200)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comment?: string;
}
