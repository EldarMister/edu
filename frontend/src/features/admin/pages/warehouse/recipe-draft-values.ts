import type { Ingredient, ProcessingBasis, ProcessingStage, RecipeItem, RecipeRowInput } from './api';
import type { UnitCode, UnitType } from './units';

export function recipeQuantity(amount: number, unit: string) {
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} ${unit}`.trim();
}

export function supportsProcessing(unitType: Ingredient['unitType']) {
  return unitType === 'mass';
}

export const MAX_PROCESSING_STAGES = 10;
export const MIN_STAGE_LOSS = -999.99;

export function displayedProcessingStages({ processingStages, processingMethod, lossPercent }: Pick<RecipeRowInput,
  'processingStages' | 'processingMethod' | 'lossPercent'>): ProcessingStage[] {
  if (processingStages?.length) return processingStages;
  return processingMethod ? [{ method: processingMethod, lossPercent: lossPercent ?? 0 }] : [];
}

export function processingRetention(stages: readonly ProcessingStage[], legacyLoss = 0) {
  return stages.length ? stages.reduce((remaining, stage) => remaining * (1 - stage.lossPercent / 100), 1)
    : 1 - legacyLoss / 100;
}

export function validProcessingStages(stages: readonly ProcessingStage[]) {
  return stages.length <= MAX_PROCESSING_STAGES && stages.every(({ lossPercent }) =>
    Number.isFinite(lossPercent) && lossPercent >= MIN_STAGE_LOSS && lossPercent <= 100);
}

export function processingQuantities(gross: number, net: number, basis: ProcessingBasis, retention: number) {
  if (basis === 'net' && retention > 0) return { amount: Number((net / retention).toFixed(6)), netAmount: net };
  if (basis === 'gross') return { amount: gross, netAmount: Number((gross * retention).toFixed(6)) };
  return { amount: gross, netAmount: net };
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

export function stockWriteoffQuantity(gross: number, unit: UnitCode, roundPieces = false) {
  if (!roundPieces || unit !== 'pcs' || gross <= 0) return gross;
  // A decimal production factor can produce 14.000000000000002 for exactly 14 pieces.
  return Math.ceil(Number(gross.toPrecision(15)));
}

export function validMeasuredNetWeight(grams: number) {
  return Number.isFinite(grams) && grams >= 0 && grams < 100_000_000_000 && Number(grams.toFixed(3)) === grams;
}

type YieldRow = {
  unitType: UnitType | null;
  unitFactor: number;
  netAmount: number | null;
  pieceWeightGrams?: number | null;
  measuredNetWeightGrams?: number | null;
};

export function preparationYieldBase(outputType: UnitType, rows: readonly YieldRow[]) {
  let total = 0;
  for (const row of rows) {
    if (outputType === 'mass' && (row.unitType === 'volume' || row.unitType === 'count') && row.measuredNetWeightGrams != null) {
      if (!validMeasuredNetWeight(row.measuredNetWeightGrams)) return null;
      total += row.measuredNetWeightGrams;
      continue;
    }
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

export function recipeDraftRows(items: RecipeItem[], copying = false): RecipeDraftRow[] {
  return items.map((row) => {
    const copyNonMass = copying && !supportsProcessing(row.unitType);
    const net = copyNonMass ? row.netAmount ?? netFromLoss(row.amount, row.lossPercent ?? 0) : row.netAmount;
    return {
      ingredientId: row.ingredientId,
      name: row.name,
      unitType: row.unitType,
      amount: row.amount,
      unit: row.amountUnit,
      netAmount: net,
      ...(row.unitType !== 'mass' && row.measuredNetWeightGrams !== undefined && {
        measuredNetWeightGrams: row.measuredNetWeightGrams,
      }),
      lossPercent: copyNonMass ? undefined : row.lossPercent,
      processingMethod: copyNonMass ? undefined : row.processingMethod,
      processingStages: !copyNonMass && row.processingStages?.length ? row.processingStages : undefined,
      processingBasis: copyNonMass ? undefined : row.processingBasis,
      variantAmounts: row.variantAmounts,
      fromCommonWarehouse: row.fromCommonWarehouse,
      warehouseId: row.warehouseId,
    };
  });
}

export function scaleRecipeDraftRows(rows: RecipeDraftRow[], fromPortions: number, toPortions: number): RecipeDraftRow[] {
  if (fromPortions === toPortions) return rows;

  function scale(amount: number, decimals: number) {
    if (!Number.isFinite(amount) || amount <= 0) return amount;
    // Round decimal quantities half up, as the API does when it stores a portion.
    const [mantissa, exponent = '0'] = String(amount).split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    const places = decimals + Number(exponent) - fraction.length;
    const units = BigInt(whole + fraction) * 10n ** BigInt(Math.max(0, places));
    const divisor = BigInt(fromPortions) * 10n ** BigInt(Math.max(0, -places));
    const portionUnits = (2n * units + divisor) / (2n * divisor);
    return Number(`${portionUnits * BigInt(toPortions)}e-${decimals}`);
  }

  return rows.map((row) => {
    const decimals = row.unit === 'kg' || row.unit === 'l' ? 6 : 3;
    const measured = row.measuredNetWeightGrams;
    return {
      ...row,
      amount: scale(row.amount, decimals),
      netAmount: row.netAmount == null ? row.netAmount : scale(row.netAmount, decimals),
      ...(measured != null && { measuredNetWeightGrams: scale(measured, 3) }),
      variantAmounts: row.variantAmounts && Object.fromEntries(
        Object.entries(row.variantAmounts).map(([id, amount]) => [id, scale(amount, decimals)]),
      ),
    };
  });
}

export function recipeDraftPayload(rows: readonly RecipeDraftRow[]) {
  return rows.map(({ name: _name, unitType: _type, ...row }) => ({
    ...row,
    netAmount: row.processingBasis === 'gross' ? undefined : row.netAmount,
    ...(row.processingStages?.length && { lossPercent: undefined, processingMethod: undefined }),
  }));
}

export function recipePreviewItems(rows: readonly RecipeDraftRow[], savedVariantIds: readonly string[], unsavedVariantKey?: string) {
  const savedIds = new Set(savedVariantIds);
  return recipeDraftPayload(rows).map((row) => {
    const amount = unsavedVariantKey ? row.variantAmounts?.[unsavedVariantKey] : undefined;
    const variantAmounts = Object.fromEntries(Object.entries(row.variantAmounts ?? {}).filter(([id]) => savedIds.has(id)));
    const netAmount = amount != null && row.netAmount != null && row.amount > 0
      ? Number((row.netAmount * amount / row.amount).toFixed(6)) : row.netAmount;
    const measured = row.measuredNetWeightGrams;
    return { ...row, amount: amount ?? row.amount, netAmount, variantAmounts,
      ...(measured != null && amount != null && row.amount > 0 && {
        measuredNetWeightGrams: Number((measured * amount / row.amount).toFixed(3)),
      }) };
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
  return rows.every(({ amount, netAmount, measuredNetWeightGrams, lossPercent = 0, unitType, processingStages, processingBasis }) => {
    if (!Number.isFinite(amount) || amount <= 0 || (netAmount != null && (!Number.isFinite(netAmount) || netAmount < 0))) return false;
    if (measuredNetWeightGrams != null && (supportsProcessing(unitType) || !validMeasuredNetWeight(measuredNetWeightGrams))) return false;
    if (!supportsProcessing(unitType)) return (netAmount ?? 0) <= amount && lossPercent >= 0 && lossPercent <= 100
      && (lossPercent < 100 || (netAmount ?? 0) === 0);
    if ((processingStages == null && (!Number.isFinite(lossPercent) || lossPercent < -1e16 || lossPercent > 100)) ||
      !validProcessingStages(processingStages ?? [])) return false;
    if (processingBasis === 'net') return (netAmount ?? 0) > 0 && processingRetention(processingStages ?? [], lossPercent) > 0;
    if (processingBasis === 'manual') return netAmount != null;
    if (processingBasis == null && processingStages == null && lossPercent >= 0 && (netAmount ?? 0) > amount) return false;
    return processingBasis === 'gross' || lossPercent < 100 || (netAmount ?? 0) === 0;
  });
}
