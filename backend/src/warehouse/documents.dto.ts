import { WarehouseDocumentKind, WarehouseInventoryMode, WarehouseWriteoffReason } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export const warehouseWriteoffReasons = {
  spoilage: 'Порча',
  expired: 'Просрочка',
  damage: 'Брак',
  staff_meal: 'Питание персонала',
  tasting: 'Дегустация',
  household: 'Хозяйственные нужды',
  other: 'Другое',
} satisfies Record<WarehouseWriteoffReason, string>;

class WarehouseDocumentLineDto {
  @IsString() @IsNotEmpty() @MaxLength(160)
  ingredientId: string;

  @IsNumber() @Min(0)
  quantity: number;
}

export class WarehouseDocumentRevisionDto {
  @IsOptional() @IsInt() @Min(0)
  revision?: number;
}

export class UpdateWarehouseDocumentDto extends WarehouseDocumentRevisionDto {
  @IsOptional() @IsEnum(WarehouseWriteoffReason)
  reason?: WarehouseWriteoffReason | null;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => WarehouseDocumentLineDto)
  items?: WarehouseDocumentLineDto[];

  @IsOptional() @IsBoolean()
  recount?: boolean;
}

export class ReverseWarehouseDocumentDto extends WarehouseDocumentRevisionDto {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  note: string;
}

export class CreateWarehouseDocumentDto extends UpdateWarehouseDocumentDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  destinationWarehouseId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  sourcePurchaseId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  requestKey?: string;
  @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId: string;

  @IsEnum(WarehouseDocumentKind)
  kind: WarehouseDocumentKind;

  @IsOptional() @IsEnum(WarehouseInventoryMode)
  mode?: WarehouseInventoryMode;
}

export class WarehouseDocumentsQueryDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsEnum(WarehouseDocumentKind)
  kind?: WarehouseDocumentKind;
}
