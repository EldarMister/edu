import { ArrayNotEmpty, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReadyItemsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Выберите хотя бы одно блюдо' })
  @IsString({ each: true })
  itemIds: string[];
}

export class RejectItemsDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Выберите хотя бы одно блюдо' })
  @IsString({ each: true })
  itemIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comment?: string;
}
