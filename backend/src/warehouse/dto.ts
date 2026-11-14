import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IngredientKind, PurchaseStatus } from '@prisma/client';

// ---------- Сырьё (ингредиенты) ----------

export class PurchaseUnitDto {
  @IsString() @IsNotEmpty() @MaxLength(40)
  name: string;
  @IsNumber() @Min(0.000001)
  factor: number;
}

export class IngredientMetadataDto {
  @IsOptional() @IsObject()
  processingLosses?: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(160)
  supplierId?: string | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PurchaseUnitDto)
  purchaseUnits?: PurchaseUnitDto[];
  @IsOptional() @IsEnum(IngredientKind)
  kind?: IngredientKind;
  @IsOptional() @IsString() @MaxLength(120)
  category?: string | null;
  @IsOptional() @IsString() @MaxLength(80)
  barcode?: string | null;
  @IsOptional() @IsString() @MaxLength(160)
  supplier?: string | null;
  @IsOptional() @IsString() @MaxLength(40)
  purchaseUnit?: string | null;
  @IsOptional() @IsNumber() @Min(0.000001)
  purchaseFactor?: number | null;
  @IsOptional() @IsIn(['stocked', 'virtual'])
  preparationMode?: 'stocked' | 'virtual';
}

export class CreateIngredientDto extends IngredientMetadataDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  // display-единица: g | kg | ml | l | pcs (или кириллица). Тип выводится из неё.
  @IsString() @IsNotEmpty() @MaxLength(16)
  unit: string;

  // Все значения — в выбранной display-единице; backend конвертирует в базу.
  @IsOptional() @IsNumber() @Min(0)
  stock?: number;

  @IsOptional() @IsNumber() @Min(0)
  avgCost?: number; // себестоимость за display-единицу

  @IsOptional() @IsNumber() @Min(0)
  lowStockThreshold?: number;
}

export class UpdateIngredientDto extends IngredientMetadataDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;

  @IsOptional() @IsNumber() @Min(0)
  stock?: number;

  @IsOptional() @IsNumber() @Min(0)
  avgCost?: number;

  @IsOptional() @IsNumber() @Min(0)
  lowStockThreshold?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ---------- Техкарта ----------

export class CreateRecipeItemDto {
  @IsOptional() @IsBoolean()
  fromCommonWarehouse?: boolean;

  @IsString() @IsNotEmpty()
  ingredientId: string;

  @IsNumber() @Min(0)
  amount: number;

  // Единица количества на порцию (g/kg/ml/l/pcs). Если не задана — берётся
  // display-единица ингредиента.
  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;
}

export class UpdateRecipeItemDto {
  @IsOptional() @IsBoolean()
  fromCommonWarehouse?: boolean;

  @IsNumber() @Min(0)
  amount: number;

  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;
}

// ---------- Закупки ----------

export class PurchaseItemInputDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  packageId?: string;
  @IsString() @IsNotEmpty()
  ingredientId: string;

  @IsNumber() @Min(0)
  quantity: number;

  // Единица закупки (g/kg/ml/l/pcs). Если не задана — display-единица ингредиента.
  @IsOptional() @IsString() @MaxLength(40)
  unit?: string;

  @IsOptional() @IsNumber() @Min(0)
  purchasePrice?: number; // цена за выбранную единицу

  // Фактическая сумма позиции. Если задана — авторитетна: цена за единицу
  // выводится из неё (total / quantity), и она идёт в расчёт себестоимости.
  @IsOptional() @IsNumber() @Min(0)
  total?: number;
}

export class PurchaseMetadataDto {
  @IsOptional() @IsString() @MaxLength(160)
  supplierId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000)
  note?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(2000, { each: true })
  attachments?: string[];
  @IsOptional() @IsNumber() @Min(0)
  discount?: number;
}

export class CreatePurchaseDto extends PurchaseMetadataDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  requestKey?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsString()
  date?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  supplier?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items: PurchaseItemInputDto[];

  // true — сразу провести закупку (обновить остатки и себестоимость).
  @IsOptional() @IsBoolean()
  complete?: boolean;
}

export class UpdatePurchaseDto extends PurchaseMetadataDto {
  @IsOptional() @IsBoolean()
  complete?: boolean;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsString()
  date?: string;

  @IsOptional() @IsString() @MaxLength(160)
  supplier?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items?: PurchaseItemInputDto[];
}

// ---------- Фильтры движений ----------

export class MovementsQueryDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @IsString()
  from?: string;

  @IsOptional() @IsString()
  to?: string;

  @IsOptional() @IsString()
  ingredientId?: string;

  @IsOptional() @IsString()
  type?: string;

  @IsOptional() @IsString()
  sourceType?: string;

  @IsOptional() @IsString()
  search?: string;
}

export class PurchaseStatusFilterDto {
  @IsOptional() @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;
}
