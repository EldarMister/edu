import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';

const locationSelect = { id: true, cafeId: true, name: true, isDefault: true } as const;

export type WarehouseLocation = Prisma.WarehouseGetPayload<{ select: typeof locationSelect }>;
type IngredientBalance = { stock: Prisma.Decimal; avgCost: Prisma.Decimal };
type IngredientWithBalance = IngredientBalance & { id: string };
const zero = new Prisma.Decimal(0);
const emptyBalance = { stock: zero, avgCost: zero };

export async function resolveWarehouse(db: Prisma.TransactionClient, warehouseId?: string | null): Promise<WarehouseLocation | null> {
  const cafeId = getCafeId();
  if (!cafeId) {
    if (warehouseId !== undefined && warehouseId !== null) throw new NotFoundException('Склад не найден');
    return null;
  }
  if (warehouseId !== undefined && warehouseId !== null) {
    if (!warehouseId.trim()) throw new BadRequestException('Выберите склад');
    const location = await db.warehouse.findFirst({ where: { id: warehouseId, cafeId }, select: locationSelect });
    if (!location) throw new NotFoundException('Склад не найден');
    return location;
  }
  const where = { cafeId, isDefault: true };
  const existing = await db.warehouse.findFirst({ where, select: locationSelect });
  if (existing) return existing;
  await db.warehouse.createMany({
    data: { id: `warehouse:default:${cafeId}`, cafeId, name: 'Общий склад', isDefault: true },
    skipDuplicates: true,
  });
  return db.warehouse.findFirstOrThrow({ where, select: locationSelect });
}

export function warehouseDocumentFilter(warehouse: WarehouseLocation | null) {
  if (!warehouse) return {};
  return warehouse.isDefault
    ? { OR: [{ warehouseId: warehouse.id }, { warehouseId: null }] }
    : { warehouseId: warehouse.id };
}

export async function getWarehouseBalance(
  db: Prisma.TransactionClient,
  warehouse: WarehouseLocation | null,
  ingredient: IngredientWithBalance,
): Promise<IngredientBalance> {
  if (!warehouse || warehouse.isDefault) return { stock: ingredient.stock, avgCost: ingredient.avgCost };
  return await db.warehouseStock.findUnique({
    where: { cafeId: warehouse.cafeId, warehouseId_ingredientId: { warehouseId: warehouse.id, ingredientId: ingredient.id } },
    select: { stock: true, avgCost: true },
  }) ?? emptyBalance;
}

/** Callers hold the ingredient row lock before reading and writing balances. */
export async function setWarehouseBalance(
  tx: Prisma.TransactionClient,
  warehouse: WarehouseLocation | null,
  ingredientId: string,
  balance: IngredientBalance,
) {
  if (!warehouse || warehouse.isDefault) {
    await tx.ingredient.update({ where: { id: ingredientId }, data: balance });
  } else {
    await tx.warehouseStock.upsert({
      where: { cafeId: warehouse.cafeId, warehouseId_ingredientId: { warehouseId: warehouse.id, ingredientId } },
      create: { cafeId: warehouse.cafeId, warehouseId: warehouse.id, ingredientId, ...balance },
      update: balance,
    });
  }
}

export async function warehouseBalances(
  db: Prisma.TransactionClient,
  warehouse: WarehouseLocation | null,
  ingredients: IngredientWithBalance[],
) {
  const cafeId = getCafeId();
  const rows = cafeId && ingredients.length && !warehouse?.isDefault
    ? await db.warehouseStock.findMany({
        where: { cafeId, warehouseId: warehouse?.id, ingredientId: { in: ingredients.map(({ id }) => id) } },
        select: { ingredientId: true, stock: true, avgCost: true },
      })
    : [];
  const byIngredient = new Map<string, IngredientBalance[]>();
  for (const row of rows) {
    const balances = byIngredient.get(row.ingredientId);
    if (balances) balances.push(row);
    else byIngredient.set(row.ingredientId, [row]);
  }

  return new Map(ingredients.map((ingredient) => {
    const other = byIngredient.get(ingredient.id) ?? [];
    const balances = warehouse && !warehouse.isDefault ? other : [ingredient, ...other];
    let stock = zero;
    let stockValue = zero;
    let positiveStock = zero;
    let positiveValue = zero;
    for (const balance of balances) {
      const value = balance.stock.mul(balance.avgCost);
      stock = stock.add(balance.stock);
      stockValue = stockValue.add(value);
      if (balance.stock.gt(0)) {
        positiveStock = positiveStock.add(balance.stock);
        positiveValue = positiveValue.add(value);
      }
    }
    const avgCost = balances.length === 1 ? balances[0].avgCost
      : positiveStock.gt(0) ? positiveValue.div(positiveStock)
      : balances[0]?.avgCost ?? zero;
    return [ingredient.id, { stock, avgCost, stockValue }];
  }));
}
