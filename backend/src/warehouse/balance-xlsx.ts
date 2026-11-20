import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import * as XLSX from 'xlsx';
import type { IngredientsService } from './ingredients.service';

type BalanceItem = Awaited<ReturnType<IngredientsService['findAll']>>[number];

const columns = {
  name: { label: 'Название', width: 38 },
  warehouse: { label: 'Склад', width: 25 },
  kind: { label: 'Тип', width: 18 },
  category: { label: 'Категория', width: 25 },
  barcode: { label: 'Штрихкод', width: 22 },
  stock: { label: 'Остатки', width: 17 },
  unit: { label: 'Ед. измерения', width: 16 },
  cost: { label: 'Себестоимость', width: 19 },
  total: { label: 'Сумма', width: 18 },
  limit: { label: 'Лимит', width: 17 },
};
type Column = keyof typeof columns;
const defaultColumns: Column[] = ['name', 'kind', 'category', 'stock', 'cost', 'total', 'limit'];
const repeated = ({ value }: { value: unknown }) => typeof value === 'string' ? [value] : value;
const kindLabels = { ingredient: 'Ингредиент', goods: 'Товар', preparation: 'Полуфабрикат' };

export class BalanceExportQuery {
  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @Transform(repeated) @IsArray() @IsString({ each: true })
  kinds?: string[];

  @IsOptional() @Transform(repeated) @IsArray() @IsString({ each: true })
  categories?: string[];

  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;

  @IsOptional() @IsIn(['low', 'empty'])
  stockFilter?: 'low' | 'empty';

  @IsOptional() @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @IsOptional() @IsString() @MaxLength(160)
  columns?: string;
}

function balanceKind(item: BalanceItem): keyof typeof kindLabels {
  if (item.isPrepared) return 'preparation';
  return item.kind === 'goods' || item.kind === 'beverage' ? 'goods' : 'ingredient';
}

export function balanceExportColumns(selection?: string): Column[] {
  if (selection === undefined) return defaultColumns;
  const requested = selection.split(',');
  if (requested.some((key) => !Object.prototype.hasOwnProperty.call(columns, key))
    || new Set(requested).size !== requested.length) {
    throw new BadRequestException('Укажите допустимые столбцы остатков без повторов');
  }
  return requested as Column[];
}

export function writeBalanceWorkbook(items: BalanceItem[], warehouse: string, query: BalanceExportQuery, selected: Column[]): Buffer {
  const search = query.search?.trim().toLocaleLowerCase();
  const rows = items.filter((item) =>
    (!search || [item.name, item.barcode, item.category].some((value) => value?.toLocaleLowerCase().includes(search))) &&
    (!query.kinds?.length || query.kinds.includes(balanceKind(item)) || query.kinds.includes(item.kind ?? '')) &&
    (!query.categories?.length || query.categories.includes(item.category ?? '')) &&
    (!query.unit || item.displayUnit === query.unit) &&
    (!query.stockFilter || (query.stockFilter === 'empty' ? item.stock <= 0 : item.isLow && item.stock > 0)),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru') * (query.sort === 'desc' ? -1 : 1));
  const sheet = XLSX.utils.aoa_to_sheet([selected.map((key) => columns[key].label)]);
  sheet['!cols'] = selected.map((key) => ({ wch: columns[key].width }));
  const hasUnits = selected.includes('unit');
  for (const [index, item] of rows.entries()) {
    const virtual = item.isPrepared && item.preparationMode === 'virtual';
    const total = item.stock === 0 ? 0 : item.avgCostBase == null ? null
      : Math.round((item.stockBase * item.avgCostBase + Number.EPSILON) * 100) / 100;
    const values = {
      name: item.name, warehouse, kind: kindLabels[balanceKind(item)], category: item.category, barcode: item.barcode,
      stock: virtual ? 'По рецепту' : item.stock, unit: item.unit,
      cost: virtual ? item.recipeUnitCost : item.avgCost, total: virtual ? null : total, limit: virtual ? null : item.lowStockThreshold,
    };
    const r = index + 1;
    XLSX.utils.sheet_add_aoa(sheet, [selected.map((key) => values[key])], { origin: { r, c: 0 } });
    selected.forEach((key, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t !== 'n') return;
      if (key === 'cost' || key === 'total') cell.z = '#,##0.00 "с"';
      if (key === 'stock' || key === 'limit') {
        const format = key === 'stock' && item.unitType === 'count' ? '#,##0.00' : '#,##0.000';
        cell.z = hasUnits ? format : `${format} "${item.unit}"`;
      }
    });
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Остатки');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
