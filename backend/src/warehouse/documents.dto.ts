import { WarehouseDocumentKind, WarehouseInventoryMode, WarehouseWriteoffReason } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

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

  // A selected inventory position may remain uncounted in a draft.
  // The service only permits null for inventory and rejects it on finalization.
  @ValidateIf((_object, value) => value !== null) @IsNumber() @Min(0)
  quantity: number | null;
}

export class WriteoffSourceLineDto {
  @IsString() @IsNotEmpty() @MaxLength(160)
  sourceLineId: string;
  @IsIn(['ingredient', 'dish'])
  kind: 'ingredient' | 'dish';
  @IsString() @IsNotEmpty() @MaxLength(160)
  sourceId: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  variantId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  packageId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  packageSnapshotLineId?: string;
  @IsNumber() @Min(0.000001)
  quantity: number;
  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;
  @IsOptional() @IsString() @MaxLength(64)
  recipeSignature?: string;
  @IsOptional() @IsString() @MaxLength(300)
  details?: string;
}

export class WriteoffReasonDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsBoolean()
  expense: boolean;
}

export class WriteoffPreviewDto {
  @IsOptional() @IsString() @MaxLength(35)
  effectiveAt?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  documentId?: string;
  @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => WriteoffSourceLineDto)
  sourceLines: WriteoffSourceLineDto[];
}

export class WarehouseDocumentRevisionDto {
  @IsOptional() @IsInt() @Min(0)
  revision?: number;
}

export class UpdateWarehouseDocumentDto extends WarehouseDocumentRevisionDto {
  @IsOptional() @IsIn(['submit', 'post'])
  finalize?: 'submit' | 'post';

  @IsOptional() @IsString() @MaxLength(35)
  countedAt?: string | null;

  @IsOptional() @IsString() @MaxLength(35)
  effectiveAt?: string | null;

  @IsOptional() @IsEnum(WarehouseWriteoffReason)
  reason?: WarehouseWriteoffReason | null;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  writeoffReasonId?: string | null;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string | null;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => WarehouseDocumentLineDto)
  items?: WarehouseDocumentLineDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => WriteoffSourceLineDto)
  sourceLines?: WriteoffSourceLineDto[];

  @IsOptional() @IsBoolean()
  recount?: boolean;
}

export class ReverseWarehouseDocumentDto extends WarehouseDocumentRevisionDto {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  note: string;
}

export class EditPostedWriteoffDto extends UpdateWarehouseDocumentDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;
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
  @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsEnum(WarehouseDocumentKind)
  kind?: WarehouseDocumentKind;

  @IsOptional() @IsIn(['true', 'false'])
  includeDeletedWriteoffs?: string;
}
