import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { getWarehouseBalance, setWarehouseBalance, warehouseDocumentFilter, type WarehouseLocation } from './warehouse-location';

type Purchase = { id: string; cafeId: string | null; items: { ingredientId: string }[] };
const zero = new Prisma.Decimal(0);

/** Corrections are current-time adjustments, never a rewrite of downstream valuation. */
export async function purchaseCorrectionEligibility(
  tx: Prisma.TransactionClient, purchase: Purchase, warehouses: (WarehouseLocation | null)[],
  ingredientIds = purchase.items.map((item) => item.ingredientId),
) {
  const posted = await tx.stockMovement.findMany({
    where: { cafeId: purchase.cafeId, sourceType: 'purchase', sourceId: purchase.id, type: 'purchase' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { createdAt: true, beforeStock: true },
  });
  const stockPostedAt = posted[0]?.createdAt ?? null;
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
    if (following) correctionBlockedReason = `После поставки по «${following.ingredient.name}» уже были другие складские операции. Количество, стоимость и склад нельзя изменить без пересчёта этих операций.`;
    // A count with no discrepancy has no movement, but is still an accounting boundary.
    if (!correctionBlockedReason) {
      const counted = await tx.warehouseDocumentItem.findFirst({ where: {
        cafeId: purchase.cafeId ?? undefined, ingredientId: { in: [...new Set(ingredientIds)] },
        document: { kind: 'inventory', status: { in: ['posted', 'reversed'] }, postedAt: { gte: stockPostedAt },
          OR: warehouses.filter((warehouse): warehouse is WarehouseLocation => !!warehouse).map((warehouse) => ({ warehouseId: warehouse.id })) },
      } });
      if (counted) correctionBlockedReason = 'После поставки по её продуктам проведена инвентаризация. Количество, стоимость и склад нельзя изменить без пересчёта этого периода.';
    }
  }
  return { stockPostedAt, canCorrectStock: !correctionBlockedReason, correctionBlockedReason };
}

export async function postPurchaseCorrection(tx: Prisma.TransactionClient, input: {
  purchaseId: string; ingredientId: string; warehouse: WarehouseLocation | null;
  quantityDelta: Prisma.Decimal; valueDelta: Prisma.Decimal; actor?: AuthUser;
  reason: string; snapshot?: Prisma.InputJsonValue;
}) {
  const ingredient = await tx.ingredient.findUniqueOrThrow({ where: { id: input.ingredientId } });
  const before = await getWarehouseBalance(tx, input.warehouse, ingredient);
  const change = input.quantityDelta.toDecimalPlaces(3);
  const stock = before.stock.add(change);
  const unchanged = change.isZero() && input.valueDelta.isZero();
  if (!unchanged && (stock.lt(0) || stock.gte('100000000000'))) throw new ConflictException(`Исправление создаёт недопустимый остаток «${ingredient.name}»`);
  const beforeValue = before.stock.mul(before.avgCost);
  let value = beforeValue.add(input.valueDelta);
  // Stored average cost has eight decimals. Removing the complete receipt can
  // leave a sub-cent rounding remainder; never carry it on an empty balance.
  if (stock.isZero() && value.abs().lt('0.01')) value = zero;
  if (value.lt(0) && value.abs().lt('0.01')) value = zero;
  if (!unchanged && (value.lt(0) || (stock.isZero() && !value.isZero()))) throw new ConflictException(`Исправление создаёт неверную стоимость остатка «${ingredient.name}»`);
  const avgCost = unchanged || stock.isZero() ? before.avgCost : value.div(stock).toDecimalPlaces(8);
  const valuationKnown = unchanged ? before.valuationKnown : stock.gt(0) && (before.stock.isZero() || before.valuationKnown);
  if (!unchanged) await setWarehouseBalance(tx, input.warehouse, ingredient.id, { stock, avgCost, valuationKnown });
  return tx.stockMovement.create({ data: {
    createdAt: new Date(),
    cafeId: ingredient.cafeId, ingredientId: ingredient.id,
    warehouseId: input.warehouse?.id ?? null, warehouseKey: input.warehouse?.isDefault ? 'default' : input.warehouse?.id ?? 'default',
    type: 'correction', sourceType: 'purchase', sourceId: input.purchaseId,
    beforeStock: before.stock, change, afterStock: stock, costAtMoment: before.avgCost,
    valuationAdjustment: stock.mul(avgCost).sub(beforeValue).sub(change.mul(before.avgCost)).toDecimalPlaces(8),
    costKnown: unchanged ? true : valuationKnown, beforeValuationKnown: before.valuationKnown, valuationKnown,
    actorId: input.actor?.id, actorName: input.actor?.name,
    reason: 'purchase_correction', comment: input.reason, recipeSnapshot: input.snapshot,
  } });
}
