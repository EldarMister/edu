import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Role, DiscountType, TableStatus, PrepStation, OrderStatus } from '@prisma/client';

// ---------- Залы ----------
export class CreateHallDto {
  @IsString() @IsNotEmpty() @MaxLength(60)
  name: string;

  @IsOptional() @IsInt()
  sortOrder?: number;
}
export class UpdateHallDto {
  @IsOptional() @IsString() @MaxLength(60)
  name?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt()
  sortOrder?: number;
}

// ---------- Столы ----------
export class CreateTableDto {
  @IsString() @IsNotEmpty()
  hallId: string;

  @IsInt() @Min(1)
  number: number;

  @IsInt() @Min(1)
  seats: number;
}
export class UpdateTableDto {
  @IsOptional() @IsString()
  hallId?: string;

  @IsOptional() @IsInt() @Min(1)
  number?: number;

  @IsOptional() @IsInt() @Min(1)
  seats?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsEnum(TableStatus)
  status?: TableStatus;
}

// ---------- Категории ----------
export class CreateCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(60)
  name: string;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsEnum(PrepStation)
  prepStation?: PrepStation;
}
export class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(60)
  name?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt()
  sortOrder?: number;

  @IsOptional() @IsEnum(PrepStation)
  prepStation?: PrepStation;
}

/** Удаление категории: что сделать с блюдами внутри. */
export class DeleteCategoryDto {
  // move — перенести блюда в другую категорию; delete — удалить вместе с блюдами.
  @IsOptional() @IsString()
  strategy?: 'move' | 'delete';

  @IsOptional() @IsString()
  targetCategoryId?: string;
}

/** Новый порядок категорий (массив id в нужной последовательности). */
export class ReorderCategoriesDto {
  @IsArray() @IsString({ each: true })
  ids: string[];
}

/** Массовый перенос блюд из одной категории в другую. */
export class MoveCategoryDishesDto {
  @IsString() @IsNotEmpty()
  fromCategoryId: string;

  @IsString() @IsNotEmpty()
  toCategoryId: string;
}

// ---------- Блюда ----------
export class DishVariantDto {
  @IsOptional() @IsString()
  id?: string;

  @IsString() @IsNotEmpty() @MaxLength(80)
  name: string;

  @IsNumber() @Min(0.01)
  price: number;

  @IsOptional() @IsInt() @Min(0)
  stock?: number;

  @IsOptional() @IsInt() @Min(0)
  initialStock?: number;

  @IsOptional() @IsString()
  unit?: string;
}

export class CreateDishDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsString() @IsNotEmpty()
  categoryId: string;

  @IsOptional() @IsNumber() @Min(0)
  price?: number;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @IsString()
  imageUrl?: string;

  @IsOptional() @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional() @IsNumber() @Min(0)
  discountValue?: number;

  @IsOptional() @IsInt() @Min(0)
  cookingTime?: number;

  @IsOptional() @IsBoolean()
  isAvailable?: boolean;

  @IsOptional() @IsBoolean()
  trackInventory?: boolean;

  @IsOptional() @IsInt() @Min(0)
  stock?: number;

  @IsOptional() @IsInt() @Min(0)
  initialStock?: number;

  @IsOptional() @IsString()
  unit?: string;

  // null = брать направление из категории; задано — приоритет блюда.
  @IsOptional() @IsEnum(PrepStation)
  prepStation?: PrepStation | null;

  // Отдельное название для озвучки кухни (если задано — используется вместо name).
  @IsOptional() @IsString() @MaxLength(120)
  voiceName?: string | null;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DishVariantDto)
  variants?: DishVariantDto[];
}
export class UpdateDishDto {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsString()
  categoryId?: string;

  @IsOptional() @IsNumber() @Min(0)
  price?: number;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @IsString()
  imageUrl?: string;

  @IsOptional() @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional() @IsNumber() @Min(0)
  discountValue?: number;

  @IsOptional() @IsInt() @Min(0)
  cookingTime?: number;

  @IsOptional() @IsBoolean()
  isAvailable?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsBoolean()
  trackInventory?: boolean;

  @IsOptional() @IsInt() @Min(0)
  stock?: number;

  @IsOptional() @IsInt() @Min(0)
  initialStock?: number;

  @IsOptional() @IsString()
  unit?: string;

  // null = брать направление из категории; задано — приоритет блюда.
  @IsOptional() @IsEnum(PrepStation)
  prepStation?: PrepStation | null;

  // Отдельное название для озвучки кухни.
  @IsOptional() @IsString() @MaxLength(120)
  voiceName?: string | null;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DishVariantDto)
  variants?: DishVariantDto[];
}

// ---------- Сеты ----------
export class SetComponentDto {
  @IsString() @IsNotEmpty()
  dishId: string;

  // Вариант блюда (например, «1 л»). Разные варианты одного блюда — разные строки сета.
  @IsOptional() @IsString()
  dishVariantId?: string;

  @IsOptional() @IsInt() @Min(1)
  quantity?: number;

  @IsOptional() @IsBoolean()
  removable?: boolean;

  @IsOptional() @IsBoolean()
  replaceable?: boolean;
}

export class CreateSetDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name: string;

  @IsNumber() @Min(0.01)
  price: number;

  @IsArray() @ArrayMinSize(1, { message: 'Добавьте хотя бы одно блюдо в состав' })
  @ValidateNested({ each: true }) @Type(() => SetComponentDto)
  components: SetComponentDto[];
}

export class UpdateSetDto {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsNumber() @Min(0.01)
  price?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => SetComponentDto)
  components?: SetComponentDto[];
}

// ---------- Персонал ----------
export class CreateStaffDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  name: string;

  @IsString() @IsNotEmpty()
  phone: string;

  @IsEnum(Role)
  role: Role;

  @IsString() @IsNotEmpty()
  password: string;
}
export class UpdateStaffDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsEnum(Role)
  role?: Role;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString()
  password?: string;
}

// ---------- Отчёт по сменам: фиксация сдачи наличных ----------
export class SetCashHandedDto {
  @IsString() @IsNotEmpty()
  waiterId: string;

  // Дата смены (YYYY-MM-DD); по умолчанию — сегодня.
  @IsOptional() @IsString()
  date?: string;

  @IsNumber() @Min(0)
  cashHanded: number;
}

// ---------- Заказы (фильтр/пагинация) ----------
export class OrderQueryDto {
  @IsOptional() @IsString()
  tab?: 'all' | 'active' | 'paid' | 'cancelled';

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  dateFrom?: string;

  @IsOptional() @IsString()
  dateTo?: string;

  // Фильтр по способу оплаты (qr|cash|card|mixed).
  @IsOptional() @IsString()
  paymentMethod?: string;

  // Фильтр по официанту.
  @IsOptional() @IsString()
  waiterId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  pageSize?: number;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional() @IsString() @MaxLength(240)
  reason?: string;
}

// ---------- Статистика ----------
export class StatsQueryDto {
  @IsOptional() @IsString()
  period?: 'today' | 'week' | 'month' | 'all' | 'custom';

  @IsOptional() @IsString()
  from?: string;

  @IsOptional() @IsString()
  to?: string;
}
