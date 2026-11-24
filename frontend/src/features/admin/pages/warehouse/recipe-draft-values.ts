import type { Ingredient, RecipeItem, RecipeRowInput } from './api';
import type { UnitCode, UnitType } from './units';

export function recipeQuantity(amount: number, unit: string) {
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} ${unit}`.trim();
}

export function supportsProcessing(unitType: Ingredient['unitType']) {
  return unitType === 'mass';
}

export function parsePieceWeightGrams(input: string) {
  const typed = input.trim().replace(',', '.');
  if (!typed) return null;
  if (!/^(?:\d{1,11}(?:\.\d{1,3})?|\.\d{1,3})$/.test(typed)) return undefined;
  const grams = Number(typed);
  return grams >= 0.001 && grams <= 99_999_999_999.999 ? grams : undefined;
}

export function pieceNetWeight(pieces: number | null | undefined, gramsPerPiece: number | null | undefined) {
  if (pieces == null || !Number.isFinite(pieces) || pieces < 0 || gramsPerPiece == null ||
      !Number.isFinite(gramsPerPiece) || gramsPerPiece <= 0) return null;
  return Number((pieces * gramsPerPiece).toFixed(6));
}

type YieldRow = {
  unitType: UnitType | null;
  unitFactor: number;
  netAmount: number | null;
  pieceWeightGrams?: number | null;
};

export function preparationYieldBase(outputType: UnitType, rows: readonly YieldRow[]) {
  let total = 0;
  for (const row of rows) {
    if (row.netAmount == null || !Number.isFinite(row.netAmount) || row.netAmount < 0) return null;
    if (row.netAmount === 0) continue;
    if (row.unitType === outputType) total += row.netAmount * row.unitFactor;
    else if (outputType === 'mass' && row.unitType === 'count') {
      const grams = pieceNetWeight(row.netAmount, row.pieceWeightGrams);
      if (grams == null) return null;
      total += grams;
    } else return null;
  }
  return total;
}

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

export function lossFromAmounts(gross: number, net: number) {
  return gross > 0 ? Number(Math.max(0, (1 - net / gross) * 100).toFixed(2)) : 0;
}

export function validRecipeRows(rows: readonly RecipeDraftRow[]) {
  return rows.every(({ amount, netAmount, lossPercent = 0 }) => Number.isFinite(amount) && amount > 0
    && (netAmount == null || (Number.isFinite(netAmount) && netAmount >= 0 && netAmount <= amount))
    && lossPercent >= 0 && lossPercent <= 100 && (lossPercent < 100 || (netAmount ?? 0) === 0));
}
