import type { ProcessingLine, ProcessingLineInput } from '@/services/api/warehouseProcessing';
import { ALL_UNITS, type UnitCode } from '@/services/api/warehouseUnits';

export type ProcessingDraftRow = {
  key: string;
  ingredientId: string;
  warehouseId: string;
  name: string;
  quantity: string;
  unit: UnitCode;
  share: string;
  savedLine?: ProcessingLine;
};

const decimal = (value: string) => /^\d+(?:[.,]\d*)?$|^[.,]\d+$/.test(value.trim())
  ? Number(value.trim().replace(',', '.'))
  : Number.NaN;

export const processingRowEntered = (row: ProcessingDraftRow) => !!(row.ingredientId || row.quantity.trim());

export function changeProcessingUnit(row: ProcessingDraftRow, unit: UnitCode): ProcessingDraftRow {
  const oldUnit = ALL_UNITS.find((entry) => entry.code === row.unit);
  const nextUnit = ALL_UNITS.find((entry) => entry.code === unit);
  const quantity = decimal(row.quantity);
  return {
    ...row,
    unit,
    savedLine: undefined,
    quantity: Number.isFinite(quantity) && oldUnit && nextUnit && oldUnit.type === nextUnit.type
      ? String(Number((quantity * oldUnit.factor / nextUnit.factor).toFixed(9)))
      : row.quantity,
  };
}

function shareTicks(value: string) {
  const share = decimal(value || '0');
  if (!Number.isFinite(share) || share < 0 || share > 100) return Number.NaN;
  const [whole, fractional = ''] = (value || '0').trim().split(/[.,]/);
  const digits = fractional.padEnd(5, '0');
  return Number(whole) * 10_000 + Number(digits.slice(0, 4)) + (Number(digits[4]) >= 5 ? 1 : 0);
}

/** Shares are rounded to the same four decimal places as ProcessingLine on the server. */
export function allocatedProcessingShare(rows: ProcessingDraftRow[]) {
  return rows.filter(processingRowEntered).reduce((sum, row) => sum + (shareTicks(row.share) || 0), 0) / 10_000;
}

export function processingRowsInput(rows: ProcessingDraftRow[], output: boolean): { lines: ProcessingLineInput[]; error: string } {
  const label = output ? 'Полученные продукты' : 'Исходные продукты';
  const lines: ProcessingLineInput[] = [];
  const seen = new Set<string>();
  const invalid = (reason: string, index: number) => ({
    lines: [],
    error: label + ', строка ' + (index + 1) + ' · ' + reason,
  });
  for (const [index, row] of rows.entries()) {
    if (!processingRowEntered(row)) continue;
    if (!row.ingredientId) return invalid('выберите продукт', index);
    if (!row.warehouseId) return invalid('выберите склад', index);
    const quantity = decimal(row.quantity);
    const factor = ALL_UNITS.find((entry) => entry.code === row.unit)?.factor ?? 1;
    const base = quantity * factor;
    if (!Number.isFinite(quantity) || quantity < 0.000001 || base < 0.0005 || base >= 99_999_999_999.9995) {
      return invalid('укажите допустимое количество больше нуля', index);
    }
    const key = row.ingredientId + ':' + row.warehouseId;
    if (seen.has(key)) return invalid('объедините одинаковые продукты одного склада', index);
    seen.add(key);
    const share = shareTicks(row.share);
    if (output && !Number.isFinite(share)) {
      return invalid('доля себестоимости должна быть от 0 до 100%', index);
    }
    lines.push({
      ingredientId: row.ingredientId,
      warehouseId: row.warehouseId,
      unit: row.unit,
      quantity,
      ...(output ? { costSharePercent: share / 10_000 } : {}),
    });
  }
  return { lines, error: '' };
}

export function processingDraftRow(line: ProcessingLine): ProcessingDraftRow {
  return {
    key: line.id,
    ingredientId: line.ingredientId,
    warehouseId: line.warehouseId,
    name: line.name,
    quantity: String(line.quantity),
    unit: line.unit,
    share: String(line.costSharePercent),
    savedLine: line,
  };
}
