import { ALL_UNITS, type UnitCode } from '@/services/api/warehouseUnits';
import type { StockDocumentItem } from '@/services/api/stockDocuments';

export interface TransferDraftRow {
  key: string;
  ingredientId: string;
  name: string;
  quantity: string;
  unit: UnitCode;
  /** Existing documents accept quantity in their saved unit, even after a catalogue unit change. */
  documentUnit: UnitCode;
}
export const transferUnit = (unit: string): UnitCode => ALL_UNITS.find((entry) => entry.code === unit || entry.label === unit)?.code ?? 'pcs';
export function transferDraftRows(items: StockDocumentItem[] = []): TransferDraftRow[] {
  return items.map((item) => ({ key: item.ingredientId, ingredientId: item.ingredientId, name: item.name,
    quantity: item.quantity == null ? '' : String(item.quantity), unit: transferUnit(item.unit), documentUnit: transferUnit(item.unit) }));
}
export function transferRowsInput(rows: TransferDraftRow[]) {
  const entered = rows.filter((row) => row.ingredientId || row.quantity.trim());
  const seen = new Set<string>();
  const items: { ingredientId: string; quantity: number }[] = [];
  let error = '';
  for (const row of entered) {
    if (!row.ingredientId) { error = 'Выберите продукт для каждой строки.'; break; }
    if (seen.has(row.ingredientId)) { error = 'Объедините повторяющиеся продукты в одну строку.'; break; }
    seen.add(row.ingredientId);
    const quantity = Number(row.quantity.trim().replace(',', '.'));
    const source = ALL_UNITS.find((unit) => unit.code === row.unit);
    const target = ALL_UNITS.find((unit) => unit.code === row.documentUnit);
    if (!/^\d+(?:[.,]\d+)?$/.test(row.quantity.trim()) || !Number.isFinite(quantity) || quantity <= 0 || !source || !target || source.type !== target.type) {
      error = 'Укажите количество больше нуля в единицах продукта.'; break;
    }
    const base = quantity * source.factor;
    if (base < 0.0005 || base > 99_999_999_999.999) { error = 'Количество выходит за допустимый диапазон складского учёта.'; break; }
    items.push({ ingredientId: row.ingredientId, quantity: Number((base / target.factor).toPrecision(15)) });
  }
  return { items, error, count: entered.length, canPost: !error && entered.length > 0 };
}
export function changeTransferUnit(row: TransferDraftRow, unit: UnitCode): TransferDraftRow {
  const from = ALL_UNITS.find((value) => value.code === row.unit);
  const to = ALL_UNITS.find((value) => value.code === unit);
  if (!from || !to || from.type !== to.type) return row;
  const quantity = Number(row.quantity.replace(',', '.'));
  return { ...row, unit, quantity: row.quantity.trim() && Number.isFinite(quantity) ? String(Number((quantity * from.factor / to.factor).toPrecision(15))) : row.quantity };
}
