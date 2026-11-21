import type { StockDocumentItem } from '@/services/api/stockDocuments';
import type { Ingredient, PurchaseReturnableItem } from '@/services/api/warehouse';
import { ALL_UNITS, type UnitCode } from '@/services/api/warehouseUnits';
import { documentQuantity } from './warehouseDocumentForm';

export interface SupplierReturnRow {
  key: string;
  ingredientId: string;
  name: string;
  unit: UnitCode | null;
  quantity: string;
}

function resolveUnit(unit: string) {
  const normalized = unit.trim().replace(/\.$/, '');
  return ALL_UNITS.find((candidate) => candidate.code === normalized || candidate.label === normalized);
}

export function supplierReturnDraftRows(items: readonly StockDocumentItem[] = []): SupplierReturnRow[] {
  return items.map((item) => ({
    key: item.ingredientId,
    ingredientId: item.ingredientId,
    name: item.name,
    unit: resolveUnit(item.unit)?.code ?? null,
    quantity: item.quantity == null ? '' : String(item.quantity).replace('.', ','),
  }));
}

export function supplierReturnCandidates(catalogue: readonly Ingredient[], items: readonly PurchaseReturnableItem[] = []) {
  const catalogueById = new Map(catalogue.map((item) => [item.id, item]));
  const candidates = new Map<string, { ingredient: Ingredient; remainingBase: number }>();
  for (const item of items) {
    const ingredient = catalogueById.get(item.ingredientId);
    if (ingredient && ingredient.preparationMode !== 'virtual') {
      candidates.set(item.ingredientId, { ingredient, remainingBase: item.remainingQuantityBase });
    }
  }
  return candidates;
}

export function supplierReturnRowsInput(
  rows: readonly SupplierReturnRow[],
  candidates: ReturnType<typeof supplierReturnCandidates>,
  savedItems: readonly StockDocumentItem[] = [],
) {
  const savedById = new Map(savedItems.map((item) => [item.ingredientId, item]));
  const seen = new Set<string>();
  const items: { ingredientId: string; quantity: number }[] = [];
  const errors = new Map<string, string>();
  const amounts = new Map<string, number>();
  const shortages = new Set<string>();
  const limits = new Map<string, number>();
  for (const row of rows) {
    if (!row.ingredientId && !row.quantity.trim()) continue;
    const candidate = candidates.get(row.ingredientId);
    const selectedUnit = row.unit && resolveUnit(row.unit);
    const savedItem = savedById.get(row.ingredientId);
    const targetUnit = savedItem ? resolveUnit(savedItem.unit) : candidate && resolveUnit(candidate.ingredient.displayUnit);
    if (!row.ingredientId) {
      errors.set(row.key, 'Выберите продукт.');
      continue;
    }
    if (!candidate || !selectedUnit || !targetUnit || selectedUnit.type !== targetUnit.type) {
      errors.set(row.key, 'Продукт недоступен для возврата по этой поставке.');
      continue;
    }
    if (seen.has(row.ingredientId)) {
      errors.set(row.key, 'Продукт уже добавлен.');
      continue;
    }
    seen.add(row.ingredientId);
    limits.set(row.key, candidate.remainingBase / selectedUnit.factor);
    const quantity = documentQuantity(row.quantity);
    const base = quantity == null ? 0 : quantity * selectedUnit.factor;
    if (!/^\d+(?:[.,]\d+)?$/.test(row.quantity.trim()) || quantity == null || !Number.isFinite(base) || base < 0.0005 || base > 99_999_999_999.999) {
      errors.set(row.key, 'Введите количество больше нуля.');
      continue;
    }
    if (Math.round(base * 1000) / 1000 > candidate.remainingBase + 1e-8) {
      errors.set(row.key, 'Количество превышает доступное для возврата.');
      continue;
    }
    items.push({ ingredientId: row.ingredientId, quantity: selectedUnit.code === targetUnit.code ? quantity : Number((base / targetUnit.factor).toPrecision(15)) });
    if (base > candidate.ingredient.stockBase + 0.0005) {
      shortages.add(row.key);
    } else if (candidate.ingredient.avgCostBase != null && candidate.ingredient.stockBase > 0) {
      amounts.set(row.key, base * candidate.ingredient.avgCostBase);
    }
  }
  return { items, errors, amounts, shortages, limits };
}
