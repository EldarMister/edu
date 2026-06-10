import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comment?: string;
}
