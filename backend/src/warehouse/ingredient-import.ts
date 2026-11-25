import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsString, MaxLength, ValidateNested } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { lockWarehouseCatalog } from './stock-lock';
import { lockIngredientCategories, registerIngredientCategories } from './ingredient-categories';
import { normalizeUnit, unitType, type UnitCode } from './units';

class ImportRow {
  @IsString() @MaxLength(120) name: string;
  @IsString() @MaxLength(120) category: string;
  @IsString() @MaxLength(32) unit: string;
}
export class IngredientImportDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ImportRow)
  rows: ImportRow[];
  @IsBoolean() apply: boolean;
}

export async function importCatalogue(db: Prisma.TransactionClient, dto: IngredientImportDto) {
  if (dto.apply) {
    await lockIngredientCategories(db);
    await lockWarehouseCatalog(db);
  }
  const existing = await db.ingredient.findMany({ where: { kind: { in: ['raw', 'consumable'] }, isActive: true },
    select: { name: true, category: true, displayUnit: true } });
  const catalogue = new Map(existing.map((item) => [item.name.trim().toLocaleLowerCase('ru'), item]));
  const fresh: Prisma.IngredientCreateManyInput[] = [];
  const rows = dto.rows.map((row) => {
    const name = row.name.trim();
    const category = row.category.trim() || null;
    if (!name) return { status: 'error', message: 'Укажите название.' };
    let unit: UnitCode;
    try {
      unit = normalizeUnit(row.unit.trim().toLowerCase().replace(/\.$/, ''));
      if (!['g', 'kg', 'l', 'ml', 'pcs'].includes(unit)) throw new Error();
    } catch { return { status: 'error', message: 'Допустимые единицы: кг, г, л, мл, шт.' }; }
    const key = name.toLocaleLowerCase('ru');
    const prior = catalogue.get(key);
    if (prior) return prior.displayUnit === unit && prior.category === category
      ? { status: 'skip', message: 'Уже в каталоге или таблице' }
      : { status: 'error', message: 'Это название уже используется с другой единицей или категорией.' };
    catalogue.set(key, { name, category, displayUnit: unit });
    fresh.push({ cafeId: getCafeId(), name, category, kind: 'raw', displayUnit: unit, unitType: unitType(unit) });
    return { status: 'new', message: 'К добавлению' };
  });
  if (dto.apply && rows.some((row) => row.status === 'error')) throw new BadRequestException('Исправьте строки с ошибками и проверьте таблицу ещё раз.');
  if (dto.apply && fresh.length) {
    await db.ingredient.createMany({ data: fresh });
    await registerIngredientCategories(db, fresh.map(({ category }) => category));
  }
  return { rows, count: fresh.length };
}
