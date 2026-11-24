import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';

const locationSelect = { id: true, cafeId: true, name: true, isDefault: true } as const;

export type WarehouseLocation = Prisma.WarehouseGetPayload<{ select: typeof locationSelect }>;
type IngredientBalance = { stock: Prisma.Decimal; avgCost: Prisma.Decimal; valuationKnown: boolean };
type IngredientWithBalance = Pick<IngredientBalance, 'stock' | 'avgCost'> & { id: string; valuationKnown?: boolean };
const zero = new Prisma.Decimal(0);
const emptyBalance = { stock: zero, avgCost: zero, valuationKnown: false };

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
    data: { id: `warehouse:default:${cafeId}`, cafeId, name: 'Основной склад', isDefault: true },
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

type WarehouseSelection = { warehouseId?: string; warehouseIds?: string };

export function warehouseSelectionIds({ warehouseId, warehouseIds }: WarehouseSelection) {
  if (warehouseId !== undefined && warehouseIds !== undefined) {
    throw new BadRequestException('Укажите один способ выбора складов');
  }
  const requested = warehouseIds?.split(',') ?? (warehouseId === undefined ? undefined : [warehouseId]);
  if (!requested) return undefined;
  const ids = new Set(requested.map((id) => id.trim()));
  if (ids.has('') || ids.size > 100 || [...ids].some((id) => id.length > 160)) {
    throw new BadRequestException('Проверьте список складов');
  }
  return ids;
}

export async function resolveWarehouseSelection(db: Prisma.TransactionClient, { warehouseId, warehouseIds }: WarehouseSelection): Promise<WarehouseLocation[]> {
  if (warehouseIds === undefined) {
    const warehouse = warehouseId === undefined ? null : await resolveWarehouse(db, warehouseId);
    return warehouse ? [warehouse] : [];
  }
  const ids = warehouseSelectionIds({ warehouseId, warehouseIds })!;
  const cafeId = getCafeId();
  if (!cafeId) throw new NotFoundException('Склад не найден');
  const warehouses = await db.warehouse.findMany({ where: { cafeId, id: { in: [...ids] } }, select: locationSelect });
  if (warehouses.length !== ids.size) throw new NotFoundException('Склад не найден');
  return warehouses.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function selectedWarehouseDocumentFilter(warehouses: WarehouseLocation[]): Prisma.PurchaseWhereInput {
  if (warehouses.length === 0) return {};
  const selection = { warehouseId: { in: warehouses.map(({ id }) => id) } };
  return warehouses.some(({ isDefault }) => isDefault)
    ? { OR: [selection, { warehouseId: null }] }
    : selection;
}

export function selectedWarehousePurchaseSql(warehouses: WarehouseLocation[]) {
  if (warehouses.length === 0) return Prisma.empty;
  const ids = Prisma.join(warehouses.map(({ id }) => id));
  return warehouses.some(({ isDefault }) => isDefault)
    ? Prisma.sql`AND (p.warehouse_id IN (${ids}) OR p.warehouse_id IS NULL)`
    : Prisma.sql`AND p.warehouse_id IN (${ids})`;
}

export async function getWarehouseBalance(
  db: Prisma.TransactionClient,
  warehouse: WarehouseLocation | null,
  ingredient: IngredientWithBalance,
): Promise<IngredientBalance> {
  if (!warehouse || warehouse.isDefault) return { stock: ingredient.stock, avgCost: ingredient.avgCost, valuationKnown: ingredient.valuationKnown === true };
  return await db.warehouseStock.findUnique({
    where: { cafeId: warehouse.cafeId, warehouseId_ingredientId: { warehouseId: warehouse.id, ingredientId: ingredient.id } },
    select: { stock: true, avgCost: true, valuationKnown: true },
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
  warehouse: WarehouseLocation | WarehouseLocation[] | null,
  ingredients: IngredientWithBalance[],
) {
  const cafeId = getCafeId();
  const locations = Array.isArray(warehouse) ? warehouse : warehouse ? [warehouse] : [];
  const warehouseIds = locations.filter(({ isDefault }) => !isDefault).map(({ id }) => id);
  const includeDefault = !locations.length || locations.some(({ isDefault }) => isDefault);
  const rows = cafeId && ingredients.length && (!locations.length || warehouseIds.length)
    ? await db.warehouseStock.findMany({
        where: { cafeId, ...(locations.length ? { warehouseId: { in: warehouseIds } } : { warehouse: { isDefault: false } }),
          ingredientId: { in: ingredients.map(({ id }) => id) } },
        select: { ingredientId: true, stock: true, avgCost: true, valuationKnown: true },
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
    const balances = includeDefault ? [ingredient, ...other] : other;
    let stock = zero;
    let stockValue = zero;
    let knownStockValue = zero;
    let positiveStock = zero;
    let positiveValue = zero;
    for (const balance of balances) {
      const value = balance.stock.mul(balance.avgCost);
      stock = stock.add(balance.stock);
      stockValue = stockValue.add(value);
      if (balance.valuationKnown) knownStockValue = knownStockValue.add(value.toDecimalPlaces(2));
      if (balance.stock.gt(0)) {
        positiveStock = positiveStock.add(balance.stock);
        positiveValue = positiveValue.add(value);
      }
    }
    const avgCost = balances.length === 1 ? balances[0].avgCost
      : positiveStock.gt(0) ? positiveValue.div(positiveStock)
      : balances[0]?.avgCost ?? zero;
    const stockValueKnown = balances.every((balance) => balance.stock.isZero() || balance.valuationKnown === true);
    const valuationKnown = stockValueKnown && positiveStock.gt(0);
    return [ingredient.id, { stock, avgCost, stockValue, knownStockValue, stockValueKnown, valuationKnown }];
  }));
}
