import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import * as XLSX from 'xlsx';
import type { IngredientsService } from './ingredients.service';

type BalanceItem = Awaited<ReturnType<IngredientsService['findAll']>>[number];

const columns = {
  name: { label: 'Название', width: 38 },
  warehouse: { label: 'Склад', width: 25 },
  kind: { label: 'Тип', width: 18 },
  category: { label: 'Категория', width: 25 },
  stock: { label: 'Остатки', width: 17 },
  unit: { label: 'Ед. измерения', width: 16 },
  cost: { label: 'Себестоимость', width: 19 },
  lastPurchasePrice: { label: 'Себестоимость последней поставки', width: 32 },
  retailValue: { label: 'Сумма по ценам реализации', width: 28 },
  total: { label: 'Сумма', width: 18 },
  limit: { label: 'Лимит', width: 17 },
};
type Column = keyof typeof columns;
const defaultColumns: Column[] = ['name', 'kind', 'category', 'stock', 'cost', 'total', 'limit'];
const repeated = ({ value }: { value: unknown }) => typeof value === 'string' ? [value] : value;
const kindLabels = { ingredient: 'Ингредиент', goods: 'Товар', preparation: 'Полуфабрикат', prepared_dish: 'Готовое блюдо' };

export class BalanceExportQuery {
  @IsOptional() @IsString() @MaxLength(160)
  search?: string;

  @IsOptional() @IsString() @MaxLength(160)
  warehouseId?: string;

  @IsOptional() @Transform(repeated) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  kinds?: string[];

  @IsOptional() @Transform(repeated) @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(120, { each: true })
  categories?: string[];

  @IsOptional() @IsString() @MaxLength(16)
  unit?: string;

  @IsOptional() @IsIn(['low', 'empty'])
  stockFilter?: 'low' | 'empty';

  @IsOptional() @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @IsOptional() @IsString() @MaxLength(240)
  columns?: string;
}

export class BalanceListQuery extends BalanceExportQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

function balanceKind(item: BalanceItem): keyof typeof kindLabels {
  if (item.kind === 'prepared_dish') return 'prepared_dish';
  if (item.isPrepared) return 'preparation';
  return item.kind === 'goods' || item.kind === 'beverage' ? 'goods' : 'ingredient';
}

export function balanceExportColumns(selection?: string): Column[] {
  if (selection === undefined) return defaultColumns;
  const requested = selection.split(',').filter((key) => key !== 'barcode');
  if (!requested.length) return defaultColumns;
  if (requested.some((key) => !Object.prototype.hasOwnProperty.call(columns, key))
    || new Set(requested).size !== requested.length) {
    throw new BadRequestException('Укажите допустимые столбцы остатков без повторов');
  }
  return requested as Column[];
}

export function filteredBalances(items: BalanceItem[], query: BalanceExportQuery) {
  const search = query.search?.trim().toLocaleLowerCase();
  return items.filter((item) =>
    (!search || [item.name, item.category].some((value) => value?.toLocaleLowerCase().includes(search))) &&
    (!query.kinds?.length || query.kinds.includes(balanceKind(item)) || query.kinds.includes(item.kind ?? '')) &&
    (!query.categories?.length || query.categories.includes(item.category ?? '')) &&
    (!query.unit || item.displayUnit === query.unit) &&
    (!query.stockFilter || (!isVirtual(item) && (query.stockFilter === 'empty' ? item.stockBase <= 0 : item.isLow && item.stockBase > 0))),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru') * (query.sort === 'desc' ? -1 : 1) || a.id.localeCompare(b.id));
}

const isVirtual = (item: BalanceItem) => item.isPrepared && item.preparationMode === 'virtual';

export function writeBalanceWorkbook(rows: BalanceItem[], warehouse: string, selected: Column[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([selected.map((key) => columns[key].label)]);
  sheet['!cols'] = selected.map((key) => ({ wch: columns[key].width }));
  const hasUnits = selected.includes('unit');
  for (const [index, item] of rows.entries()) {
    const virtual = isVirtual(item);
    const values = {
      name: item.name, warehouse, kind: kindLabels[balanceKind(item)], category: item.category,
      stock: virtual ? 'По рецепту' : item.stock, unit: item.unit,
      cost: virtual ? item.recipeUnitCost : item.avgCost, lastPurchasePrice: item.lastPurchasePrice,
      retailValue: item.retailValue, total: virtual ? null : item.stockValue, limit: virtual ? null : item.lowStockThreshold,
    };
    const r = index + 1;
    XLSX.utils.sheet_add_aoa(sheet, [selected.map((key) => values[key])], { origin: { r, c: 0 } });
    selected.forEach((key, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t !== 'n') return;
      if (key === 'cost' || key === 'total' || key === 'lastPurchasePrice' || key === 'retailValue') cell.z = '#,##0.00 "с"';
      if (key === 'stock' || key === 'limit') {
        const format = key === 'stock' && item.unitType === 'count' ? '#,##0.00' : '#,##0.000';
        cell.z = hasUnits ? format : `${format} "${item.unit}"`;
      }
    });
  }
  if (rows.length && selected.includes('total')) {
    const stocked = rows.filter((item) => !isVirtual(item));
    const unknown = stocked.some((item) => item.stockValue == null);
    XLSX.utils.sheet_add_aoa(sheet, [selected.map((key, index) => key === 'total'
      ? stocked.reduce((sum, item) => sum + Math.round((item.stockValue ?? 0) * 100), 0) / 100
      : index === 0 ? unknown ? 'Известная стоимость' : 'Всего' : null)], { origin: { r: rows.length + 1, c: 0 } });
    sheet[XLSX.utils.encode_cell({ r: rows.length + 1, c: selected.indexOf('total') })].z = '#,##0.00 "с"';
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Остатки');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
