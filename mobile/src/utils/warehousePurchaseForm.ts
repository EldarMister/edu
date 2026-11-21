import type { Ingredient, LastPurchasePrice, PurchaseItem, PurchaseLineInput, WarehousePackage } from '@/services/api/warehouse';
import { ALL_UNITS, type UnitCode } from '@/services/api/warehouseUnits';

export type PurchaseFormLine = {
  key: string;
  ingredientId: string;
  quantity: string;
  unit: string;
  price: string;
  gross?: string;
  saved?: PurchaseItem;
};

export const purchaseNumber = (value: string) => value.trim() ? Number(value.trim().replace(',', '.')) : NaN;
export const purchaseMoney = (value: number) => Math.round((value + Number.EPSILON * Math.abs(value)) * 100) / 100;
export const purchaseQuantity = (value: number) => Math.round((value + Number.EPSILON * Math.abs(value)) * 1000) / 1000;
const unitFactor = (unit: string) => ALL_UNITS.find(({ code }) => code === unit)?.factor ?? 1;
const packageIdFor = (unit: string) => unit.startsWith('package:') ? unit.slice(8) : undefined;
const customUnitIndex = (unit: string) => unit.startsWith('custom:') ? Number(unit.slice(7)) : undefined;

export function purchaseCustomUnits(ingredient?: Ingredient) {
  if (ingredient?.purchaseUnits?.length) return ingredient.purchaseUnits;
  return ingredient?.purchaseUnit && ingredient.purchaseFactor
    ? [{ name: ingredient.purchaseUnit, factor: ingredient.purchaseFactor }] : [];
}

export function newPurchaseLine(key: string): PurchaseFormLine {
  return { key, ingredientId: '', quantity: '', unit: 'kg', price: '' };
}

export function savedPurchaseLine(item: PurchaseItem): PurchaseFormLine {
  return {
    key: item.id, ingredientId: item.ingredientId, quantity: String(item.quantity),
    unit: item.packageId ? `package:${item.packageId}` : item.unitCode,
    price: String(item.purchasePrice), gross: String(item.grossTotal ?? purchaseMoney(item.quantity * item.purchasePrice)),
    saved: item,
  };
}

export function purchaseLineGross(line: PurchaseFormLine): number {
  return line.gross !== undefined ? purchaseNumber(line.gross)
    : purchaseMoney(purchaseQuantity(purchaseNumber(line.quantity)) * purchaseNumber(line.price));
}

function factorFor(line: PurchaseFormLine, ingredient: Ingredient | undefined, packages: WarehousePackage[]) {
  const packageId = packageIdFor(line.unit);
  if (packageId) {
    return line.saved?.packageId === packageId && line.saved.packageFactor
      ? line.saved.packageFactor : packages.find(({ id }) => id === packageId)?.quantityBase;
  }
  const index = customUnitIndex(line.unit);
  if (index === undefined) return unitFactor(line.unit);
  const factor = purchaseCustomUnits(ingredient)[index]?.factor;
  return factor && ingredient ? factor * unitFactor(ingredient.displayUnit) : undefined;
}

export function purchaseAttachmentLinks(value: string): string[] | undefined {
  const links = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  try {
    return links.every((link) => link.length <= 2000 && ['http:', 'https:'].includes(new URL(link).protocol)) ? links : undefined;
  } catch {
    return undefined;
  }
}

export function purchaseLastPrice(
  line: PurchaseFormLine, previous: LastPurchasePrice, ingredient: Ingredient | undefined, packages: WarehousePackage[],
) {
  const currentFactor = factorFor(line, ingredient, packages);
  if (!currentFactor || !Number.isFinite(previous.unitPrice)) return undefined;
  return Math.round(previous.unitPrice / unitFactor(previous.unitCode) * currentFactor * 1e8) / 1e8;
}

export function changePurchaseLineUnit(line: PurchaseFormLine, unit: string, ingredient: Ingredient | undefined, packages: WarehousePackage[]): PurchaseFormLine {
  if (unit === line.unit) return line;
  const next: PurchaseFormLine = { ...line, unit, saved: undefined, gross: undefined };
  const oldFactor = factorFor(line, ingredient, packages);
  const newFactor = factorFor(next, ingredient, packages);
  const oldPrice = purchaseNumber(line.price);
  return oldFactor && newFactor && Number.isFinite(oldPrice)
    ? { ...next, price: String(Math.round(oldPrice / oldFactor * newFactor * 1e8) / 1e8) } : next;
}

/** The server applies the invoice discount to gross amounts. Do not send the
 * already-discounted line total when editing it again. */
export function purchaseLineInput(line: PurchaseFormLine, ingredient?: Ingredient): PurchaseLineInput | null {
  const quantity = purchaseQuantity(purchaseNumber(line.quantity));
  const price = purchaseNumber(line.price);
  const gross = purchaseLineGross(line);
  if (!line.ingredientId || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(gross) || gross < 0) return null;
  const priceOrTotal = line.gross === undefined ? { purchasePrice: price } : { total: purchaseMoney(gross) };
  const packageId = packageIdFor(line.unit);
  if (packageId) {
    return { ingredientId: line.ingredientId, quantity, packageId, ...priceOrTotal,
      ...(line.saved?.packageId === packageId && line.saved.ingredientId === line.ingredientId ? { purchaseItemId: line.saved.id } : {}) };
  }
  const customIndex = customUnitIndex(line.unit);
  if (customIndex !== undefined) {
    const pack = purchaseCustomUnits(ingredient)[customIndex];
    return pack && ingredient
      ? { ingredientId: line.ingredientId, quantity: purchaseQuantity(quantity * pack.factor), unit: ingredient.displayUnit, total: purchaseMoney(gross) }
      : null;
  }
  return { ingredientId: line.ingredientId, quantity, unit: line.unit as UnitCode, ...priceOrTotal };
}
