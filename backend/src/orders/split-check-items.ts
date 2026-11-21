import { BadRequestException } from '@nestjs/common';
import { Prisma, type OrderItem, type OrderItemSetComponent, type StockMovement } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { lockIngredients } from '../warehouse/stock-lock';

type CheckItem = OrderItem & { setComponents: OrderItemSetComponent[] };
type SelectedItem = { item: CheckItem; quantity: number };
type SnapshotPart = { amount?: Prisma.JsonValue; componentId?: Prisma.JsonValue; parts?: Prisma.JsonValue };

function jsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value;
}

/** Scale quantities recorded in snapshots without changing the recorded recipe or stock route. */
function splitSnapshot(value: Prisma.JsonValue, moved: number, total: number, componentIds: Map<string, string>, child: boolean): Prisma.JsonValue {
  if (value === null || typeof value !== 'object') return value;
  const splitPart = (part: Prisma.JsonValue) => splitSnapshot(part, moved, total, componentIds, child);
  if (Array.isArray(value)) return value.map(splitPart);
  const snapshot = value as SnapshotPart;
  const originalAmount = typeof snapshot.amount === 'string' || typeof snapshot.amount === 'number'
    ? new Prisma.Decimal(snapshot.amount) : null;
  const movedAmount = originalAmount?.mul(moved).div(total).toDecimalPlaces(12);
  return {
    ...value,
    ...(originalAmount && movedAmount ? { amount: (child ? movedAmount : originalAmount.sub(movedAmount)).toString() } : {}),
    ...(Array.isArray(snapshot.parts) ? { parts: snapshot.parts.map(splitPart) } : {}),
    ...(child && typeof snapshot.componentId === 'string' && componentIds.has(snapshot.componentId)
      ? { componentId: componentIds.get(snapshot.componentId)! } : {}),
  };
}

function blockedHistory() {
  return new BadRequestException('Эту позицию нельзя разделить после складской корректировки или частичной отмены');
}

/** Reassign the relevant part of a recorded sale while retaining its place in the stock ledger. */
async function splitSaleMovement(
  tx: Prisma.TransactionClient, sale: StockMovement, childOrderId: string, childItemId: string,
  moved: number, total: number, componentIds: Map<string, string>,
) {
  const childChange = sale.change.mul(moved).div(total).toDecimalPlaces(3);
  const parentChange = sale.change.sub(childChange);
  if (childChange.isZero() || parentChange.isZero()) {
    throw new BadRequestException('Количество этой позиции меньше точности складского учёта. Перенесите позицию целиком');
  }
  const middleStock = sale.beforeStock.add(parentChange);
  const middleValuationKnown = sale.beforeValuationKnown && middleStock.gt(0);
  const parentSnapshot = splitSnapshot(sale.recipeSnapshot, moved, total, componentIds, false);
  const childSnapshot = splitSnapshot(sale.recipeSnapshot, moved, total, componentIds, true);
  await tx.stockMovement.update({
    where: { id: sale.id }, data: {
      change: parentChange, afterStock: middleStock, valuationKnown: middleValuationKnown, saleQuantity: total - moved,
      recipeSnapshot: jsonValue(parentSnapshot),
    },
  });
  const { id, ...snapshot } = sale;
  // Keep each piece at the original instant, including inventory cutoffs.
  // The new piece sits immediately after its parent and before older splits
  // of that parent, even when a later historical replay changes its balances.
  const prefix = id + ':split:';
  const firstChild = await tx.stockMovement.findFirst({
    where: { id: { startsWith: prefix } }, orderBy: { id: 'asc' }, select: { id: true },
  });
  const position = firstChild ? Number(firstChild.id.slice(prefix.length, prefix.length + 8)) - 1 : 99_999_999;
  if (!Number.isSafeInteger(position) || position < 0) throw blockedHistory();
  await tx.stockMovement.create({ data: {
    ...snapshot, id: prefix + String(position).padStart(8, '0'),
    sourceId: childOrderId, orderItemId: childItemId,
    saleLineId: sale.saleLineId === null ? null : childItemId,
    beforeStock: middleStock, beforeValuationKnown: middleValuationKnown, change: childChange, saleQuantity: moved,
    recipeSnapshot: jsonValue(childSnapshot),
  } });
}

export async function moveSplitCheckItems(tx: Prisma.TransactionClient, sourceId: string, childId: string, selected: SelectedItem[]) {
  const itemIds = selected.map(({ item }) => item.id);
  if (selected.some(({ item }) => item.stockSourceLineId && item.stockSourceLineId !== item.id)) throw blockedHistory();
  if (await tx.orderItem.findFirst({ where: { orderId: sourceId, stockSourceLineId: { in: itemIds }, id: { notIn: itemIds } }, select: { id: true } })) {
    throw blockedHistory();
  }
  const findMovements = () => tx.stockMovement.findMany({
    where: { sourceId, sourceType: 'order', OR: [{ orderItemId: { in: itemIds } }, { saleLineId: { in: itemIds } }] },
  });
  const initial = await findMovements();
  await lockIngredients(tx, initial.map(({ ingredientId }) => ingredientId));
  const movements = initial.length ? await findMovements() : [];

  for (const { item, quantity } of selected) {
    const related = movements.filter((row) => row.orderItemId === item.id || row.saleLineId === item.id);
    const wholeLine = quantity === item.quantity;
    if (wholeLine) {
      await tx.orderItem.update({ where: { id: item.id }, data: { orderId: childId } });
      if (related.length) {
        await tx.stockMovement.updateMany({ where: { id: { in: related.map(({ id }) => id) } }, data: { sourceId: childId } });
      }
      await tx.kitchenEvent.updateMany({ where: { orderId: sourceId, orderItemId: item.id }, data: { orderId: childId } });
      continue;
    }
    const total = item.quantity;
    if (related.some((sale) => sale.type !== 'sale' || sale.saleQuantity !== total || sale.orderItemId !== item.id
      || sale.change.gte(0) || !sale.valuationAdjustment.isZero())) throw blockedHistory();
    const { orderId, id, setComponents, ...itemData } = item;
    const childItemId = randomUUID();
    const componentIds = new Map(setComponents.map(({ id }) => [id, randomUUID()]));
    const childDiscount = item.discountAmount.mul(quantity).div(total).toDecimalPlaces(2);
    const childFinalPrice = item.priceSnapshot.mul(total).sub(item.discountAmount).eq(item.finalPrice)
      ? item.priceSnapshot.mul(quantity).sub(childDiscount)
      : item.finalPrice.mul(quantity).div(total).toDecimalPlaces(2);
    await tx.orderItem.update({ where: { id }, data: {
      quantity: total - quantity, discountAmount: item.discountAmount.sub(childDiscount),
      finalPrice: item.finalPrice.sub(childFinalPrice),
      stockAccountingSnapshot: jsonValue(splitSnapshot(item.stockAccountingSnapshot, quantity, total, componentIds, false)),
    } });
    await tx.orderItem.create({ data: {
      ...itemData, id: childItemId, orderId: childId, quantity, discountAmount: childDiscount, finalPrice: childFinalPrice,
      stockSourceLineId: item.stockSourceLineId === null ? null : childItemId,
      stockAccountingSnapshot: jsonValue(splitSnapshot(item.stockAccountingSnapshot, quantity, total, componentIds, true)),
      modifierSelections: jsonValue(item.modifierSelections),
      excludedIngredientIds: jsonValue(item.excludedIngredientIds),
      excludedIngredientNames: jsonValue(item.excludedIngredientNames),
    } });
    for (const { id: oldComponentId, ...component } of setComponents) {
      await tx.orderItemSetComponent.create({ data: { ...component, id: componentIds.get(oldComponentId), orderItemId: childItemId } });
    }
    for (const sale of related) await splitSaleMovement(tx, sale, childId, childItemId, quantity, total, componentIds);
  }
}
