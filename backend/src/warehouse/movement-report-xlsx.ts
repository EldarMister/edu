import { BadRequestException } from '@nestjs/common';
import type { IngredientKind } from '@prisma/client';
import * as XLSX from 'xlsx';
import type { movementSummary } from './movement-summary';

const exportColumns = {
  name: { label: 'Название', width: 35 },
  kind: { label: 'Тип', width: 19 },
  openingQuantity: { label: 'Нач. остаток', width: 17 },
  openingAvgCost: { label: 'Средняя себестоимость на начало', width: 35 },
  openingValue: { label: 'Нач. сумма', width: 17 },
  incomingQuantity: { label: 'Поступления', width: 17 },
  outgoingQuantity: { label: 'Расход', width: 17 },
  closingQuantity: { label: 'Итог. остаток', width: 17 },
  closingAvgCost: { label: 'Средняя себестоимость на конец', width: 35 },
  closingValue: { label: 'Итог. сумма', width: 17 },
};
type ExportColumn = keyof typeof exportColumns;
type MovementRow = Awaited<ReturnType<typeof movementSummary>>['rows'][number];

const kinds: Record<IngredientKind, string> = {
  raw: 'Ингредиент',
  goods: 'Товар',
  beverage: 'Напиток',
  preparation: 'Полуфабрикат',
  prepared_dish: 'Готовое блюдо',
  consumable: 'Расходник',
};
const quantityColumns = new Set<ExportColumn>(['openingQuantity', 'incomingQuantity', 'outgoingQuantity', 'closingQuantity']);

function isExportColumn(value: string): value is ExportColumn {
  return Object.prototype.hasOwnProperty.call(exportColumns, value);
}

export function movementExportColumns(selection: string | undefined): ExportColumn[] {
  const columns = (selection ?? Object.keys(exportColumns).join(',')).split(',').map((column) => column.trim());
  if (!columns.every(isExportColumn) || !columns.includes('name') || new Set(columns).size !== columns.length) {
    throw new BadRequestException('Укажите название и допустимые столбцы отчёта без повторов');
  }
  return columns;
}

export function writeMovementWorkbook(rows: MovementRow[], columns: ExportColumn[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([columns.map((column) => exportColumns[column].label)]);
  sheet['!cols'] = columns.map((column) => ({ wch: exportColumns[column].width }));
  rows.forEach((row, rowIndex) => {
    const exportRow = {
      ...row,
      kind: kinds[row.kind],
      openingAvgCost: row.openingQuantity === 0 && row.openingValue === 0 ? 0 : row.openingAvgCost,
      closingAvgCost: row.closingQuantity === 0 && row.closingValue === 0 ? 0 : row.closingAvgCost,
    };
    const r = rowIndex + 1;
    XLSX.utils.sheet_add_aoa(sheet, [columns.map((column) => exportRow[column])], { origin: { r, c: 0 } });
    const quantityFormat = row.unit === 'шт' ? `#,##0.00 "${row.unit}"` : `#,##0.000 "${row.unit}"`;
    columns.forEach((column, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === 'n') cell.z = quantityColumns.has(column) ? quantityFormat : '#,##0.00 "с"';
    });
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Отчёт по движению');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
