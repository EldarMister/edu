import { IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** Частичный отказ по количеству: отказать `quantity` штук из позиции `itemId`. */
export class RejectItemQuantityDto {
  @IsString()
  itemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class ReadyItemsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];

  /** id блюд внутри сетов — кухня отмечает их по отдельности. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  setComponentIds?: string[];
}

export class RejectItemsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[];

  /** id блюд внутри сетов — кухня отказывает их по отдельности. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  setComponentIds?: string[];

  /** Частичный отказ по количеству для обычных позиций (остаток остаётся активным). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RejectItemQuantityDto)
  partial?: RejectItemQuantityDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comment?: string;
}
