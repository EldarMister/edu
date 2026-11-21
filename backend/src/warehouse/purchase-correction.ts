import { ConflictException } from '@nestjs/common';
import { Prisma, type StockMovement } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { nextInventoryPeriods } from './closed-inventory-period';
import { getWarehouseBalance, setWarehouseBalance, warehouseDocumentFilter, type WarehouseLocation } from './warehouse-location';

type Purchase = { id: string; cafeId: string | null; items: { ingredientId: string }[] };
const zero = new Prisma.Decimal(0);

type CorrectionEvidence = Pick<StockMovement, 'sourceType' | 'type' | 'reason'>;
export const historicalPurchaseCorrectionReason = 'purchase_historical_correction';

export function historicalPurchaseCorrection(row: CorrectionEvidence) {
  return row.sourceType === 'purchase' && row.type === 'correction' && row.reason === historicalPurchaseCorrectionReason;
}

export function adjustsPurchaseReceipt(row: CorrectionEvidence) {
  return historicalPurchaseCorrection(row) || (row.sourceType === 'purchase' && row.type === 'correction'
    && row.reason === 'purchase_correction');
}

export function historicalPurchaseValue(row: Pick<StockMovement, 'recipeSnapshot'>) {
  const snapshot = row.recipeSnapshot as Prisma.JsonObject | null;
  const value = snapshot?.valueDelta;
  if (snapshot?.kind !== 'purchase_correction' || snapshot.accounting !== 'historical_replay'
    || typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new ConflictException('Не подтверждена исходная сумма исторического исправления поставки');
  }
  return new Prisma.Decimal(value);
}

export async function purchaseCorrectionEligibility(
  tx: Prisma.TransactionClient, purchase: Purchase, warehouses: (WarehouseLocation | null)[],
  ingredientIds = purchase.items.map((item) => item.ingredientId),
) {
  const posted = await tx.stockMovement.findMany({
    where: { cafeId: purchase.cafeId, sourceType: 'purchase', sourceId: purchase.id, type: 'purchase' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const stockPostedAt = posted[0]?.createdAt ?? null;
  let historicalAt: Date | null = null;
  let correctionBlockedReason: string | null = null;
  if (!stockPostedAt) correctionBlockedReason = 'Нет исходной записи проведения. Исправление количества и стоимости недоступно.';
  else if (posted.some((movement) => movement.beforeStock.lt(0))) {
    correctionBlockedReason = 'Поставка закрывала отрицательный остаток. Для изменения количества или стоимости нужен пересчёт последующих операций.';
  } else {
    const warehouseFilter = { OR: warehouses.map((warehouse) => warehouseDocumentFilter(warehouse)) };
    const following = await tx.stockMovement.findFirst({
      where: { cafeId: purchase.cafeId, ingredientId: { in: [...new Set(ingredientIds)] },
        ...warehouseFilter, createdAt: { gte: stockPostedAt },
        NOT: { sourceType: 'purchase', sourceId: purchase.id } },
      include: { ingredient: { select: { name: true } } }, orderBy: { createdAt: 'asc' },
    });
    // A count with no discrepancy has no movement, but is still an accounting boundary.
    const periods = await nextInventoryPeriods(tx, purchase.cafeId, stockPostedAt,
      warehouses.flatMap((warehouse) => warehouse ? [warehouse.id] : []), [...new Set(ingredientIds)]);
    if (periods.some(({ document }) => !document.reopenedAt)) {
      correctionBlockedReason = 'После поставки по её продуктам проведена инвентаризация. Откройте ближайшую инвентаризацию на редактирование.';
    } else if (following || periods.length) {
      const anchor = posted.at(-1)!.createdAt;
      const [priorCorrections, sameTime, dependentProduction] = await Promise.all([
        tx.stockMovement.findMany({ where: { cafeId: purchase.cafeId, sourceType: 'purchase', sourceId: purchase.id, type: 'correction' } }),
        tx.stockMovement.findFirst({ where: { cafeId: purchase.cafeId, ingredientId: { in: [...new Set(ingredientIds)] },
          ...warehouseFilter, createdAt: anchor, NOT: { sourceType: 'purchase', sourceId: purchase.id } }, select: { id: true } }),
        tx.stockMovement.findFirst({ where: { cafeId: purchase.cafeId, ingredientId: { in: [...new Set(ingredientIds)] },
          ...warehouseFilter, createdAt: { gte: anchor }, sourceType: { in: ['processing', 'production'] } }, select: { id: true } }),
      ]);
      if (priorCorrections.some((row) => !historicalPurchaseCorrection(row) && (!row.change.isZero() || !row.valuationAdjustment.isZero()))) {
        correctionBlockedReason = 'Ранее по поставке проведено исправление текущей датой; его нельзя переносить в прошлый период автоматически.';
      } else if (sameTime) {
        correctionBlockedReason = 'У поставки и другой операции совпадает время до миллисекунды. Порядок пересчёта нельзя подтвердить.';
      } else if (dependentProduction) {
        correctionBlockedReason = 'После поставки было производство или переработка. Автоматическое исправление этого периода недоступно.';
      } else if (purchase.cafeId) historicalAt = anchor;
      else correctionBlockedReason = 'Для исторического исправления нужно назначенное заведение.';
    }
  }
  return { posted, stockPostedAt, historicalAt, canCorrectStock: !correctionBlockedReason, correctionBlockedReason };
}

type CorrectionBalance = { stock: Prisma.Decimal; avgCost: Prisma.Decimal; valuationKnown: boolean };

export function calculatePurchaseCorrection(before: CorrectionBalance, quantityDelta: Prisma.Decimal, valueDelta: Prisma.Decimal) {
  const change = quantityDelta.toDecimalPlaces(3);
  const stock = before.stock.add(change);
  const unchanged = change.isZero() && valueDelta.isZero();
  if (!unchanged && (stock.lt(0) || stock.gte('100000000000'))) throw new ConflictException('Исправление создаёт недопустимый остаток');
  const beforeValue = before.stock.mul(before.avgCost);
  let value = beforeValue.add(valueDelta);
  // A weighted price stored at eight decimal places can leave a sub-cent
  // residue when the final quantity is removed.
  if ((stock.isZero() || value.lt(0)) && value.abs().lt('0.01')) value = zero;
  if (!unchanged && (value.lt(0) || (stock.isZero() && !value.isZero()))) throw new ConflictException('Исправление создаёт неверную стоимость остатка');
  const avgCost = unchanged || stock.isZero() ? before.avgCost : value.div(stock).toDecimalPlaces(8);
  const valuationKnown = unchanged ? before.valuationKnown : stock.gt(0) && (before.stock.isZero() || before.valuationKnown);
  return { stock, avgCost, valuationKnown, change, costKnown: unchanged || valuationKnown,
    valuationAdjustment: stock.mul(avgCost).sub(beforeValue).sub(change.mul(before.avgCost)).toDecimalPlaces(8) };
}

export async function postPurchaseCorrection(tx: Prisma.TransactionClient, input: {
  purchaseId: string; ingredientId: string; warehouse: WarehouseLocation | null;
  quantityDelta: Prisma.Decimal; valueDelta: Prisma.Decimal; actor?: AuthUser;
  reason: string; snapshot?: Prisma.InputJsonValue;
}) {
  const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id: input.ingredientId } });
  const before = await getWarehouseBalance(tx, input.warehouse, ingredient);
  const { stock, avgCost, valuationKnown, change, costKnown, valuationAdjustment } =
    calculatePurchaseCorrection(before, input.quantityDelta, input.valueDelta);
  if (!change.isZero() || !input.valueDelta.isZero()) await setWarehouseBalance(tx, input.warehouse, ingredient.id, { stock, avgCost, valuationKnown });
  return tx.stockMovement.create({ data: {
    createdAt: new Date(),
    cafeId: ingredient.cafeId, ingredientId: ingredient.id,
    warehouseId: input.warehouse?.id ?? null, warehouseKey: input.warehouse?.isDefault ? 'default' : input.warehouse?.id ?? 'default',
    type: 'correction', sourceType: 'purchase', sourceId: input.purchaseId,
    beforeStock: before.stock, change, afterStock: stock, costAtMoment: before.avgCost,
    valuationAdjustment, costKnown, beforeValuationKnown: before.valuationKnown, valuationKnown,
    actorId: input.actor?.id, actorName: input.actor?.name,
    reason: 'purchase_correction', comment: input.reason, recipeSnapshot: input.snapshot,
  } });
}
