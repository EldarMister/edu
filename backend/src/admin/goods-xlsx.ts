import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import * as XLSX from 'xlsx';
import type { CatalogService } from './catalog.service';

type GoodsRow = Awaited<ReturnType<CatalogService['goodsAll']>>[number];
const repeated = ({ value }: { value: unknown }) => typeof value === 'string' ? [value] : value;

const columns = {
  name: 'Название',
  category: 'Категория',
  price: 'Цена',
  station: 'Цех',
  barcode: 'Штрихкод',
  unit: 'Ед. измерения',
  weighted: 'Весовой товар',
  availability: 'Доступность',
  tax: 'Налог',
};
type Column = keyof typeof columns;

export class GoodsExportQuery {
  @IsOptional() @IsString() columns?: string;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(160) barcode?: string;
  @IsOptional() @Transform(repeated) @IsArray() @IsString({ each: true }) units?: string[];
  @IsOptional() @IsIn(['yes', 'no']) weighted?: 'yes' | 'no';
  @IsOptional() @IsIn(['visible', 'hidden']) availability?: 'visible' | 'hidden';
  @IsOptional() @IsString() @MaxLength(80) tax?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sort?: 'asc' | 'desc';
  @IsOptional() @Transform(repeated) @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @Transform(repeated) @IsArray() @IsString({ each: true }) stations?: string[];
}

export function goodsExportColumns(selection = 'name,category,price'): Column[] {
  const selected = selection.split(',');
  if (selected.some((key) => !Object.prototype.hasOwnProperty.call(columns, key)) || new Set(selected).size !== selected.length) {
    throw new BadRequestException('Укажите допустимые столбцы товаров без повторов');
  }
  return selected as Column[];
}

export function writeGoodsWorkbook(goods: GoodsRow[], query: GoodsExportQuery, selected: Column[],
  stations: Map<string, string>, taxNames: Map<string, string> = new Map()): Buffer {
  const search = query.search?.trim().toLocaleLowerCase();
  const name = query.name?.trim().toLocaleLowerCase();
  const barcode = query.barcode?.trim().toLocaleLowerCase();
  const units = query.units ?? [];
  const taxId = (item: GoodsRow) => item.taxExempt ? null : item.taxId ?? item.category.taxId;
  const rows = goods.filter((item) => {
    const itemName = item.name.toLocaleLowerCase();
    return (!search || itemName.includes(search)) && (!name || itemName.includes(name))
      && (!query.categories?.length || query.categories.includes(item.categoryId))
      && (!query.stations?.length || query.stations.includes(item.goodsStation))
      && (!barcode || item.barcodes.some((code) => code.toLocaleLowerCase().includes(barcode)))
      && (!units.length || item.goodsUnits.some((unit) => units.includes(unit)))
      && (!query.tax || (taxId(item) ?? 'none') === query.tax)
      && (!query.weighted || item.isWeighted === (query.weighted === 'yes'))
      && (!query.availability || (item.isAvailable && item.isActive) === (query.availability === 'visible'));
  }).sort((left, right) => left.name.localeCompare(right.name, 'ru') * (query.sort === 'desc' ? -1 : 1));
  const sheet = XLSX.utils.aoa_to_sheet([selected.map((key) => columns[key])]);
  sheet['!cols'] = selected.map((key) => ({ wch: key === 'name' ? 42 : 23 }));
  for (const [index, item] of rows.entries()) {
    const values = {
      name: item.name, category: item.category.name, price: item.goodsPrice,
      station: item.goodsStation === 'none' ? 'Без цеха' : stations.get(item.goodsStation) ?? item.goodsStation,
      barcode: item.barcodes.join(', '), unit: item.goodsUnits.join(', '), weighted: item.isWeighted ? 'Да' : 'Нет',
      availability: item.isAvailable && item.isActive ? 'Доступен в меню' : 'Скрыт',
      tax: taxNames.get(taxId(item) ?? '') ?? '',
    };
    const r = index + 1;
    XLSX.utils.sheet_add_aoa(sheet, [selected.map((key) => values[key])], { origin: { r, c: 0 } });
    const priceIndex = selected.indexOf('price');
    if (priceIndex >= 0) sheet[XLSX.utils.encode_cell({ r, c: priceIndex })].z = item.variants.length ? '"от " #,##0.00 "с"' : '#,##0.00 "с"';
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Товары');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
