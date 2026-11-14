import { ALL_UNITS, type UnitCode } from './units';

export interface PurchaseRowValues {
  quantity: string;
  price: string;
  total?: string;
}

interface PurchaseUnitProduct {
  displayUnit: UnitCode;
  purchaseUnit?: string | null;
  purchaseFactor?: number | null;
  purchaseUnits?: { name: string; factor: number }[];
}

interface PurchasePackage {
  id: string;
  unit: UnitCode;
  quantity: number;
}

export function roundPurchaseMoney(value: number): number {
  return Math.round((value + Number.EPSILON * Math.abs(value)) * 100) / 100;
}

export function roundPurchaseQuantity(value: number): number {
  return Math.round((value + Number.EPSILON * Math.abs(value)) * 1000) / 1000;
}

export function selectPurchaseProduct<T extends PurchaseRowValues & { ingredientId: string; unit: string }>(
  row: T,
  product: { id: string; displayUnit: UnitCode; avgCost: number | null },
): T {
  if (row.ingredientId === product.id) return row;
  return {
    ...row,
    ingredientId: product.id,
    quantity: '1',
    unit: product.displayUnit,
    // Average stock cost is not the price on a new supplier invoice.
    price: '',
    total: undefined,
  };
}

export function purchaseRowTotal(row: PurchaseRowValues): number {
  return roundPurchaseMoney(
    row.total === undefined
      ? roundPurchaseQuantity(Number(row.quantity || 0)) * Number(row.price || 0)
      : Number(row.total || 0),
  );
}

export function purchaseRowTotalText(row: PurchaseRowValues): string {
  if (row.total !== undefined) return row.total;
  if (!row.quantity.trim() || !row.price.trim()) return '';
  const total = purchaseRowTotal(row);
  return Number.isFinite(total) ? total.toFixed(2) : '';
}

export function purchasePriceFromTotal(quantity: string, total: string): string {
  const count = roundPurchaseQuantity(Number(quantity));
  const amount = Number(total);
  if (!total.trim() || !Number.isFinite(count) || count <= 0 || !Number.isFinite(amount) || amount < 0)
    return '';
  return String(Number((roundPurchaseMoney(amount) / count).toFixed(8)));
}

export function purchaseUnitFactor(
  unit: string,
  product?: PurchaseUnitProduct,
  packages: PurchasePackage[] = [],
  snapshot?: { packageId?: string | null; packageFactor?: number | null },
): number | undefined {
  const basicFactor = (code: string) => ALL_UNITS.find((entry) => entry.code === code)?.factor;
  if (unit.startsWith('package:')) {
    const id = unit.slice(8);
    if (snapshot?.packageId === id && snapshot.packageFactor != null) return snapshot.packageFactor;
    const pack = packages.find((entry) => entry.id === id);
    if (pack) return pack.quantity * (basicFactor(pack.unit) ?? 0);
    return undefined;
  }
  if (unit.startsWith('pack:') && product) {
    const packs = product.purchaseUnits?.length
      ? product.purchaseUnits
      : product.purchaseUnit && product.purchaseFactor
        ? [{ name: product.purchaseUnit, factor: product.purchaseFactor }]
        : [];
    const pack = packs[Number(unit.slice(5))];
    return pack ? pack.factor * (basicFactor(product.displayUnit) ?? 0) : undefined;
  }
  return basicFactor(unit);
}

export function convertPurchasePrice(
  price: string,
  previousFactor: number | undefined,
  nextFactor: number | undefined,
): string {
  if (!price.trim() || !previousFactor || !nextFactor || previousFactor <= 0 || nextFactor <= 0)
    return '';
  const value = Number(price) * nextFactor / previousFactor;
  return Number.isFinite(value) && value >= 0 ? String(Number(value.toFixed(8))) : '';
}
