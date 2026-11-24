import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import * as XLSX from 'xlsx';

export class WarehouseRegisterExportDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @ArrayUnique()
  @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(160, { each: true }) ids: string[];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique()
  @IsString({ each: true }) @MaxLength(24, { each: true }) columns: string[];
}

type Cell = string | number | Date | null;
type Column = { label: string; width: number; format?: string };
export const warehouseDateColumn = { label: 'Дата', width: 20, format: 'dd.mm.yyyy hh:mm' };
export const warehouseMoneyFormat = '#,##0.00 "с"';

export function warehouseRegisterColumns<Key extends string>(
  requested: string[], columns: Record<Key, Column>, hidden?: Key,
): Key[] {
  const valid = requested.filter((key): key is Key => Object.prototype.hasOwnProperty.call(columns, key));
  if (valid.length !== requested.length || !requested.includes('date')) {
    throw new BadRequestException('Укажите дату и допустимые столбцы');
  }
  return valid.filter((key) => key !== hidden);
}

export function warehouseRegisterRows<Row extends { id: string }>(ids: string[], rows: Row[]): Row[] {
  const available = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = available.get(id);
    return row ? [row] : [];
  });
}

export function writeWarehouseRegister(name: string, columns: Column[], rows: Cell[][]): Buffer {
  return writeWarehouseWorkbook([{ name, columns, rows }]);
}

export function writeWarehouseWorkbook(tables: { name: string; columns: Column[]; rows: Cell[][] }[]): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const { name, columns, rows } of tables) {
    XLSX.utils.book_append_sheet(workbook, warehouseSheet(columns, rows), name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function warehouseSheet(columns: Column[], rows: Cell[][]) {
  const sheet = XLSX.utils.aoa_to_sheet([
    columns.map(({ label }) => label),
    ...rows.map((row) => row.map((cell) => cell instanceof Date
      ? (cell.getTime() + 6 * 60 * 60 * 1000) / 86400000 + 25569
      : cell)),
  ]);
  sheet['!cols'] = columns.map(({ width }) => ({ wch: width }));
  for (let row = 1; row <= rows.length; row++) {
    columns.forEach(({ format }, col) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (format && cell?.t === 'n') cell.z = format;
    });
  }
  return sheet;
}

export function sendWarehouseWorkbook(response: Response, workbook: Buffer, filename: string): void {
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.send(workbook);
}
