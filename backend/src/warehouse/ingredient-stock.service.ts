import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients } from './stock-lock';
import { fromBase, unitLabel, type UnitCode } from './units';
import { getWarehouseBalance, setWarehouseBalance } from './warehouse-location';

type OrderLine = {
  id?: string | null;
  sourceLineId?: string;
  sourceLineQuantity?: number;
  dishId?: string | null;
  prepStation?: string;
  quantity?: number | null;
};
type Ingredient = { id: string; name: string; displayUnit: string; stock: Prisma.Decimal; avgCost: Prisma.Decimal };
type Warehouse = { id: string; cafeId: string; name: string; isDefault: boolean };
type Movement = {
  ingredient: Ingredient;
  warehouse: Warehouse | null;
  lineId: string | null;
  quantity: number;
  cycle: number;
  sourceLineId?: string;
  change: Prisma.Decimal;
  cost?: Prisma.Decimal;
  comment: string;
};

export type IngredientStockWarning = {
  ingredientId: string;
  ingredient: string;
  warehouseId: string | null;
  warehouseName?: string;
  unit: string;
  needed: number;
  available: number;
  missing: number;
};

@Injectable()
export class IngredientStockService {
  async applyDishSale(tx: Prisma.TransactionClient, orderId: string, lines: OrderLine[], reopen = false) {
    const dishIds = [...new Set(lines.flatMap((line) => line.dishId ? [line.dishId] : []))];
    if (!dishIds.length) return [];

    const cafeId = getCafeId();
    const stationIds = [...new Set(lines.flatMap((line) => line.prepStation ? [line.prepStation] : []))];
    const [recipe, routes] = await Promise.all([
      tx.recipeItem.findMany({
        where: { dishId: { in: dishIds } },
        include: { dish: { select: { name: true } }, ingredient: true },
      }),
      cafeId && stationIds.length ? tx.stationWarehouse.findMany({
        where: { cafeId, stationId: { in: stationIds } },
        include: { warehouse: true },
      }) : [],
    ]);
    if (!recipe.length) return [];
    await lockIngredients(tx, recipe.map((row) => row.ingredientId));
    const cycles = await this.latestSaleCycles(tx, orderId, lines);
    const lastCycle = reopen ? await tx.stockMovement.aggregate({
      where: { sourceType: 'order', sourceId: orderId },
      _max: { saleCycle: true },
    }) : null;
    const cycle = lastCycle ? (lastCycle._max.saleCycle ?? 0) + 1 : 0;
    const routeByStation = new Map(routes.map((route) => [route.stationId, route.warehouse]));
    const recipeByDish = new Map<string, typeof recipe>();
    for (const row of recipe) {
      const items = recipeByDish.get(row.dishId) ?? [];
      items.push(row);
      recipeByDish.set(row.dishId, items);
    }

    const plan: Movement[] = [];
    for (const line of lines) {
      if (!line.dishId || !line.quantity || line.quantity <= 0) continue;
      const previousCycle = line.id ? cycles.get(line.id) : undefined;
      if (previousCycle !== undefined && !reopen) continue;
      for (const row of recipeByDish.get(line.dishId) ?? []) {
        const change = row.amount.mul(line.quantity).negated().toDecimalPlaces(3);
        if (change.isZero()) continue;
        const routed = line.prepStation && !row.fromCommonWarehouse ? routeByStation.get(line.prepStation) : undefined;
        plan.push({
          ingredient: row.ingredient,
          warehouse: routed && !routed.isDefault ? routed : null,
          lineId: line.id ?? null,
          quantity: line.quantity,
          cycle,
          change,
          comment: `Списание по техкарте: ${row.dish.name} × ${line.quantity}`,
        });
      }
    }
    return this.post(tx, orderId, plan, 'sale');
  }

  async restoreDishSale(tx: Prisma.TransactionClient, orderId: string, lines: OrderLine[]) {
    const sourceIds = [...new Set(lines.flatMap((line) => line.sourceLineId ?? line.id ?? []))];
    if (!sourceIds.length) return [];
    const sales = await tx.stockMovement.findMany({
      where: { sourceType: 'order', sourceId: orderId, type: 'sale', orderItemId: { in: sourceIds } },
      include: { ingredient: true, warehouse: true },
    });
    if (!sales.length) return [];

    await lockIngredients(tx, sales.map((sale) => sale.ingredientId));
    const lineIds = lines.flatMap((line) => line.id ? [line.id] : []);
    const returns = await tx.stockMovement.findMany({
      where: { sourceType: 'order', sourceId: orderId, type: 'return', OR: [
        { orderItemId: { in: [...new Set([...sourceIds, ...lineIds])] } },
        { saleLineId: { in: sourceIds } },
      ] },
      select: { orderItemId: true, ingredientId: true, saleCycle: true, saleLineId: true, change: true },
    });
    const recorded = new Set(returns.map((row) => `${row.orderItemId}:${row.ingredientId}:${row.saleCycle}`));
    const refunded = new Map<string, Prisma.Decimal>();
    for (const row of returns) {
      const key = `${row.saleLineId ?? row.orderItemId}:${row.ingredientId}:${row.saleCycle}`;
      refunded.set(key, (refunded.get(key) ?? new Prisma.Decimal(0)).add(row.change));
    }
    const legacyIds = sales.flatMap((sale) => sale.saleQuantity == null && sale.orderItemId ? [sale.orderItemId] : []);
    const originals = legacyIds.length ? await tx.orderItem.findMany({
      where: { orderId, id: { in: legacyIds } },
      select: { id: true, quantity: true },
    }) : [];
    const originalQuantity = new Map(originals.map((line) => [line.id, line.quantity]));
    const salesByLine = new Map<string, typeof sales>();
    for (const sale of sales) {
      const key = sale.orderItemId!;
      const entries = salesByLine.get(key) ?? [];
      entries.push(sale);
      salesByLine.set(key, entries);
    }
    const plan: Movement[] = [];
    for (const line of lines) {
      if (!line.id || !line.quantity || line.quantity <= 0) continue;
      const sourceId = line.sourceLineId ?? line.id;
      const sourceSales = salesByLine.get(sourceId) ?? [];
      const latestCycle = Math.max(...sourceSales.map((sale) => sale.saleCycle));
      for (const sale of sourceSales) {
        const key = `${sourceId}:${sale.ingredientId}:${sale.saleCycle}`;
        if (sale.saleCycle !== latestCycle || recorded.has(`${line.id}:${sale.ingredientId}:${sale.saleCycle}`)) continue;
        const quantity = sale.saleQuantity ?? line.sourceLineQuantity ?? originalQuantity.get(sourceId) ?? line.quantity;
        if (sale.saleQuantity == null && quantity > 0) {
          await tx.stockMovement.update({ where: { id: sale.id }, data: { saleQuantity: quantity } });
        }
        const remaining = sale.change.abs().sub(refunded.get(key) ?? 0);
        const change = sourceId === line.id ? remaining
          : Prisma.Decimal.min(remaining, sale.change.abs().mul(line.quantity).div(quantity).toDecimalPlaces(3));
        if (change.lte(0)) continue;
        refunded.set(key, (refunded.get(key) ?? new Prisma.Decimal(0)).add(change));
        plan.push({
          ingredient: sale.ingredient,
          warehouse: sale.warehouse,
          lineId: line.id,
          quantity: line.quantity,
          cycle: sale.saleCycle,
          sourceLineId: sourceId,
          change,
          cost: sale.costAtMoment,
          comment: 'Возврат по отмене или отказу',
        });
      }
    }
    return this.post(tx, orderId, plan, 'return');
  }

  private async latestSaleCycles(tx: Prisma.TransactionClient, orderId: string, lines: OrderLine[]) {
    const ids = lines.flatMap((line) => line.id ? [line.id] : []);
    const rows = ids.length ? await tx.stockMovement.groupBy({
      by: ['orderItemId'],
      where: { type: 'sale', sourceType: 'order', sourceId: orderId, orderItemId: { in: ids } },
      _max: { saleCycle: true },
    }) : [];
    return new Map(rows.map((row) => [row.orderItemId, row._max.saleCycle ?? 0]));
  }

  private async post(tx: Prisma.TransactionClient, orderId: string, plan: Movement[], type: 'sale' | 'return') {
    if (!plan.length) return [];
    const ingredientIds = [...new Set(plan.map((row) => row.ingredient.id))];
    const fresh = await tx.ingredient.findMany({ where: { id: { in: ingredientIds } } });
    const ingredients = new Map(fresh.map((ingredient) => [ingredient.id, ingredient]));
    const grouped = new Map<string, Movement[]>();
    for (const row of plan) {
      const key = `${row.warehouse?.isDefault ? '' : row.warehouse?.id ?? ''}:${row.ingredient.id}`;
      const entries = grouped.get(key) ?? [];
      entries.push(row);
      grouped.set(key, entries);
    }
    const warnings: IngredientStockWarning[] = [];
    const balances = await Promise.all([...grouped.values()].map(async (rows) => {
      const { warehouse, ingredient } = rows[0];
      const current = ingredients.get(ingredient.id);
      if (!current) throw new BadRequestException('Сырьё техкарты не найдено');
      const balance = await getWarehouseBalance(tx, warehouse, current);
      const total = rows.reduce((sum, row) => sum.add(row.change), new Prisma.Decimal(0));
      if (type === 'sale' && balance.stock.add(total).isNegative()) {
        const unit = ingredient.displayUnit as UnitCode;
        const display = (amount: Prisma.Decimal) => Math.round(fromBase(Number(amount), unit) * 1000) / 1000;
        warnings.push({
          ingredientId: ingredient.id,
          ingredient: ingredient.name,
          warehouseId: warehouse?.id ?? null,
          warehouseName: warehouse?.name,
          unit: unitLabel(unit),
          needed: display(total.abs()),
          available: display(balance.stock),
          missing: display(balance.stock.add(total).abs()),
        });
      }
      return { rows, warehouse, ingredient, balance };
    }));

    if (warnings.length) {
      const settings = await tx.settings.findFirst({ select: { allowNegativeIngredientStock: true } });
      if (settings?.allowNegativeIngredientStock === false) {
        throw new BadRequestException({ message: 'Недостаточно сырья', shortages: warnings });
      }
    }

    for (const { rows, warehouse, ingredient, balance } of balances) {
      let stock = balance.stock;
      let avgCost = balance.avgCost;
      for (const row of rows) {
        const before = stock;
        stock = before.add(row.change);
        const cost = row.cost ?? avgCost;
        if (type === 'return' && stock.gt(0)) {
          avgCost = Prisma.Decimal.max(before, 0).mul(avgCost).add(row.change.mul(cost))
            .div(Prisma.Decimal.max(before, 0).add(row.change));
        }
        await tx.stockMovement.create({ data: {
          ingredientId: ingredient.id,
          orderItemId: row.lineId,
          warehouseId: warehouse?.id ?? null,
          saleQuantity: type === 'sale' ? row.quantity : null,
          saleCycle: row.cycle,
          saleLineId: row.sourceLineId,
          type,
          sourceType: 'order',
          sourceId: orderId,
          beforeStock: before,
          change: row.change,
          afterStock: stock,
          costAtMoment: cost,
          comment: row.comment,
        } });
      }
      await setWarehouseBalance(tx, warehouse, ingredient.id, { stock, avgCost });
    }
    return warnings;
  }
}
