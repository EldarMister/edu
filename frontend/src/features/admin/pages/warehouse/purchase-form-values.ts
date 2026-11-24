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

const invoicePriceDigits = { minimumFractionDigits: 2, maximumFractionDigits: 8 };
const unitPriceInput = new Intl.NumberFormat('en-US', { ...invoicePriceDigits, useGrouping: false });
const unitPriceLabel = new Intl.NumberFormat('ru-RU', invoicePriceDigits);

export function formatPurchaseUnitPrice(value: string, forInput = false): string {
  const price = Number(value);
  if (!value.trim() || !Number.isFinite(price)) return value;
  return forInput ? unitPriceInput.format(price) : `${unitPriceLabel.format(price)} с`;
}

export function purchasePriceChange(price: string, previousPrice: string) {
  if (!price.trim() || !previousPrice.trim()) return null;
  const current = Number(price);
  const previous = Number(previousPrice);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || current < 0 || previous < 0) return null;
  return {
    difference: current - previous,
    ratio: previous > 0 ? current / previous - 1 : null,
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

/** Allocate an invoice-wide discount in cents the same way as the posting transaction. */
export function purchaseTaxTotal(lines: { amount: number; rate: number }[], discount: number) {
  const subtotal = roundPurchaseMoney(lines.reduce((sum, row) => sum + row.amount, 0));
  if (!(subtotal > 0)) return 0;
  let running = 0;
  let allocated = 0;
  let tax = 0;
  for (const row of lines) {
    running = roundPurchaseMoney(running + row.amount);
    const target = roundPurchaseMoney(running * discount / subtotal);
    const discountedAmount = roundPurchaseMoney(row.amount - (target - allocated));
    tax += roundPurchaseMoney(discountedAmount * row.rate / 100);
    allocated = target;
  }
  return roundPurchaseMoney(tax);
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
