import type { Ingredient } from './api';
import { purchasePriceFromTotal } from './purchase-form-values';
import { unitTypeOf, type UnitCode } from './units';

export interface InvoiceLine {
  name: string;
  unit: string;
  quantity: number | null;
  price: number | null;
  total: number | null;
  tax?: { rate: number | null; amount: number | null; totalWithTax: number | null; needsReview: boolean };
}
export interface InvoicePreview {
  lines: InvoiceLine[];
  supplier: string;
  invoiceDate: string;
  total: number | null;
  warnings: string[];
}

type CatalogEntry = Pick<Ingredient, 'id' | 'name' | 'unitType' | 'isActive' | 'preparationMode'>;
function words(value: string) {
  return value.toLowerCase().normalize('NFKC').replace(/ё/g, 'е').replace(/[^\p{L}\d]+/gu, ' ').trim();
}
function matchName(name: string, items: CatalogEntry[]) {
  const normalized = words(name);
  const exact = items.filter(item => words(item.name) === normalized);
  if (exact.length === 1) return exact[0];
  if (exact.length || !normalized) return undefined;
  const matches = items.filter(item => {
    const catalogName = words(item.name);
    return catalogName.length >= 4 && (' ' + normalized + ' ').includes(' ' + catalogName + ' ');
  });
  return matches.length === 1 ? matches[0] : undefined;
}
const recognizedUnits: Record<string, UnitCode> = {
  г: 'g', гp: 'g', гр: 'g', g: 'g', кг: 'kg', kg: 'kg', л: 'l', литр: 'l', l: 'l',
  мл: 'ml', ml: 'ml', шт: 'pcs', штук: 'pcs', pcs: 'pcs', pc: 'pcs',
};
export function invoiceUnit(unit: string, item?: CatalogEntry) {
  const code = recognizedUnits[words(unit)];
  return item && code && unitTypeOf(code) === item.unitType ? code : '';
}

export function invoiceRows(lines: InvoiceLine[], catalog: CatalogEntry[], taxes: { id: string; rate: number | string }[] = []) {
  const items = catalog.filter(item => item.isActive && item.preparationMode !== 'virtual');
  return lines.map(line => {
    const item = matchName(line.name, items);
    const quantity = line.quantity == null ? '' : String(line.quantity);
    const net = line.total == null ? undefined : String(line.total);
    const computedPrice = net === undefined ? '' : purchasePriceFromTotal(quantity, net);
    const disagreement = line.price !== null && line.total !== null && line.quantity !== null &&
      Math.abs(line.price * line.quantity - line.total) > 0.011;
    const sourceTax = line.tax;
    const matches = sourceTax?.rate == null || sourceTax.needsReview ? [] : taxes.filter(t => Number(t.rate) === sourceTax.rate);
    const taxId = matches.length === 1 ? matches[0].id : null;
    const taxReview = !!sourceTax && (sourceTax.needsReview || (!taxId && sourceTax.rate !== 0));
    return { key: crypto.randomUUID(), ingredientId: item?.id ?? '', quantity, unit: invoiceUnit(line.unit, item),
      price: net !== undefined ? computedPrice : line.price == null ? '' : String(line.price), total: net,
      sourceName: line.name, sourceUnit: line.unit, sourcePrice: disagreement ? line.price : null, sourceTax, taxId, taxReview };
  });
}
