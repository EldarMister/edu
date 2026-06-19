import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PurchaseStatus } from '@prisma/client';

// ---------- Сырьё (ингредиенты) ----------

export class CreateIngredientDto {
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

export class UpdateIngredientDto {
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

// Ручная корректировка остатка (ТЗ §8): добавить / списать / установить.
export class AdjustIngredientDto {
  @IsIn(['add', 'writeoff', 'set'])
  mode: 'add' | 'writeoff' | 'set';

  @IsNumber() @Min(0)
  quantity: number;

  // Единица количества (должна быть совместима с типом ингредиента).
  @IsString() @IsNotEmpty() @MaxLength(16)
  unit: string;
}

// ---------- Техкарта ----------

export class CreateRecipeItemDto {
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
  @IsNumber() @Min(0)
  amount: number;

  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;
}

// ---------- Закупки ----------

export class PurchaseItemInputDto {
  @IsString() @IsNotEmpty()
  ingredientId: string;

  @IsNumber() @Min(0)
  quantity: number;

  // Единица закупки (g/kg/ml/l/pcs). Если не задана — display-единица ингредиента.
  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;

  @IsOptional() @IsNumber() @Min(0)
  purchasePrice?: number; // цена за выбранную единицу

  // Фактическая сумма позиции. Если задана — авторитетна: цена за единицу
  // выводится из неё (total / quantity), и она идёт в расчёт себестоимости.
  @IsOptional() @IsNumber() @Min(0)
  total?: number;
}

export class CreatePurchaseDto {
  @IsOptional() @IsString()
  date?: string;

  @IsString() @IsNotEmpty() @MaxLength(160)
  supplier: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items: PurchaseItemInputDto[];

  // true — сразу провести закупку (обновить остатки и себестоимость).
  @IsOptional() @IsBoolean()
  complete?: boolean;
}

export class UpdatePurchaseDto {
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
