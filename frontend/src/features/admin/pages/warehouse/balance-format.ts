import type { UnitType } from './units';

// Display prices are rounded for readability; valuations use the base-unit cost.
export function balanceValue(item: { stock: number; avgCost: number | null; stockBase: number; avgCostBase: number | null }): number | null {
  if (item.stock === 0) return 0;
  if (item.avgCostBase == null) return null;
  return Math.round((item.stockBase * item.avgCostBase + Number.EPSILON) * 100) / 100;
}

export function balanceQuantity(value: number, unit: string, unitType?: UnitType): string {
  const isCount = unitType ? unitType === 'count' : ['шт', 'шт.', 'pcs'].includes(unit);
  const digits = isCount ? 2 : 3;
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`;
}

export function balanceMoney(value: number): string {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} с`;
}
