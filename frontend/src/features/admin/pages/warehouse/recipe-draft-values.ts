import type { Ingredient, RecipeItem, RecipeRowInput } from './api';
import type { UnitCode } from './units';

export type RecipeDraftRow = Omit<RecipeRowInput, 'netAmount'> & {
  ingredientId: string;
  name: string;
  unit: UnitCode;
  unitType: Ingredient['unitType'];
  netAmount?: number | null;
};

export function recipeDraftRows(items: RecipeItem[]): RecipeDraftRow[] {
  return items.map((row) => ({
    ingredientId: row.ingredientId,
    name: row.name,
    unitType: row.unitType,
    amount: row.amount,
    unit: row.amountUnit,
    netAmount: row.netAmount,
    lossPercent: row.lossPercent,
    processingMethod: row.processingMethod,
    variantAmounts: row.variantAmounts,
    fromCommonWarehouse: row.fromCommonWarehouse,
    warehouseId: row.warehouseId,
  }));
}

export function recipeDraftPayload(rows: readonly RecipeDraftRow[]) {
  return rows.map(({ name: _name, unitType: _type, ...row }) => row);
}

export function recipePreviewItems(rows: readonly RecipeDraftRow[], savedVariantIds: readonly string[], unsavedVariantKey?: string) {
  const savedIds = new Set(savedVariantIds);
  return recipeDraftPayload(rows).map((row) => {
    const amount = unsavedVariantKey ? row.variantAmounts?.[unsavedVariantKey] : undefined;
    const variantAmounts = Object.fromEntries(Object.entries(row.variantAmounts ?? {}).filter(([id]) => savedIds.has(id)));
    const netAmount = amount != null && row.netAmount != null && row.amount > 0
      ? Number((row.netAmount * amount / row.amount).toFixed(6)) : row.netAmount;
    return { ...row, amount: amount ?? row.amount, netAmount, variantAmounts };
  });
}

export function netFromLoss(gross: number, loss: number) {
  return Number((gross * (1 - loss / 100)).toFixed(6));
}

export function grossFromLoss(net: number, loss: number, currentGross: number) {
  return loss < 100 ? Number((net / (1 - loss / 100)).toFixed(6)) : currentGross;
}

export function validRecipeRows(rows: readonly RecipeDraftRow[]) {
  return rows.every(({ amount, netAmount, lossPercent = 0 }) => Number.isFinite(amount) && amount > 0
    && (netAmount == null || (Number.isFinite(netAmount) && netAmount >= 0 && netAmount <= amount))
    && lossPercent >= 0 && lossPercent <= 100 && (lossPercent < 100 || (netAmount ?? 0) === 0));
}
