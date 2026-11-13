import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { lockIngredients } from './stock-lock';
import { fromBase, unitLabel, type UnitCode } from './units';
import { getWarehouseBalance } from './warehouse-location';
import { RecipeResolver, recipeAmount, warehouseKey, lockRecipeGraph } from './recipe-resolution';
import { postStockMovement } from './stock-posting';
import type { ModifierSelectionSnapshot } from './menu-modifiers';

type OrderLine = {
  id?: string | null; sourceLineId?: string; sourceLineQuantity?: number; sourceStatus?: string; stockSourceLineId?: string | null;
  dishId?: string | null; dishVariantId?: string | null; weightGrams?: number | null;
  prepStation?: string; quantity?: number | null; status?: string; rejectReason?: string | null; componentId?: string;
  modifierSelections?: unknown; excludedIngredientIds?: unknown;
};
type Ingredient = Prisma.IngredientGetPayload<{}>;
type Warehouse = Pick<Prisma.WarehouseGetPayload<{}>, 'id' | 'name' | 'cafeId' | 'isDefault'>;
type Movement = {
  ingredient: Ingredient; warehouse: Warehouse | null; lineId: string | null;
  quantity: number; cycle: number; sourceLineId?: string; change: Prisma.Decimal;
  cost?: Prisma.Decimal; costKnown?: boolean; comment: string; snapshot?: Prisma.InputJsonValue;
};
export type IngredientStockWarning = {
  ingredientId: string; ingredient: string; warehouseId: string | null; warehouseName?: string;
  unit: string; needed: number; available: number; missing: number;
  kind?: 'shortage' | 'unconfigured'; dishId?: string; message?: string;
};

@Injectable()
export class IngredientStockService {
  async applyDishSale(tx: Prisma.TransactionClient, orderId: string, lines: OrderLine[], reopen = false) {
    await this.lockOrderStock(tx, orderId);
    await lockRecipeGraph(tx, true);
    const usable = lines.filter((line) => line.id && line.dishId && (line.quantity ?? 0) > 0);
    if (!usable.length) return [];
    const storedLines = await tx.orderItem.findMany({ where: { orderId, id: { in: [...new Set(usable.flatMap((line) => [line.id!, ...(line.stockSourceLineId ? [line.stockSourceLineId] : [])]))] } },
      select: { id: true, stockAccountingSnapshot: true, modifierSelections: true, excludedIngredientIds: true } });
    const storedById = new Map(storedLines.map((line) => [line.id, line]));
    const recordedSnapshots = new Map<string, Prisma.InputJsonValue>();
    const lineWarnings = new Map<string, string[]>();
    const history = await tx.stockMovement.findMany({
      where: { sourceType: 'order', sourceId: orderId, type: { in: ['sale', 'return', 'writeoff'] } },
      include: { ingredient: true, warehouse: true },
    });
    const cafeId = getCafeId();
    const dishes = await tx.dish.findMany({
      where: { id: { in: usable.map((line) => line.dishId!) } },
      include: { recipeItems: true, variants: true, category: true, setComponents: true },
    });
    const routes = cafeId ? await tx.stationWarehouse.findMany({ where: { cafeId }, include: { warehouse: true } }) : [];
    const warehouses = cafeId ? await tx.warehouse.findMany({ where: { cafeId } }) : [];
    const routeByStation = new Map(routes.map((route) => [route.stationId, route.warehouse]));
    const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const byDish = new Map(dishes.map((dish) => [dish.id, dish]));
    const resolver = new RecipeResolver(tx);
    const plan: Movement[] = [];
    const warnings: IngredientStockWarning[] = [];
    for (const line of usable) {
      const split = reopen ? history.find((row) => row.orderItemId === line.id && row.saleLineId && row.saleLineId !== line.id) : undefined;
      const ownSale = history.some((row) => row.orderItemId === line.id && row.type === 'sale');
      const originalId = ownSale ? line.id : split?.saleLineId ?? line.stockSourceLineId ?? line.id;
      const sales = history.filter((row) => row.orderItemId === originalId && row.type === 'sale');
      // A zero-consumption result is an immutable accounting decision too. It must
      // never acquire a later recipe on a retry or when a cancelled check is reopened.
      if (!sales.length && (storedById.get(line.id!)?.stockAccountingSnapshot || storedById.get(originalId!)?.stockAccountingSnapshot)) continue;
      if (sales.length && !reopen) continue;
      if (sales.length && reopen) {
        // Reopening consumes only previously returned stock, using the historical recipe and route.
        const cycle = Math.max(...sales.map((sale) => sale.saleCycle));
        const returned = await tx.stockMovement.findMany({ where: {
          sourceType: 'order', sourceId: orderId, type: 'return', saleCycle: cycle,
          OR: [{ orderItemId: originalId }, { saleLineId: originalId }],
        } });
        for (const sale of sales.filter((row) => row.saleCycle === cycle)) {
          const amount = returned.filter((row) => row.ingredientId === sale.ingredientId && row.warehouseKey === sale.warehouseKey && (!split || row.orderItemId === line.id))
            .reduce((sum, row) => sum.add(row.change), new Prisma.Decimal(0));
          if (amount.lte(0)) continue;
          plan.push({ ingredient: sale.ingredient, warehouse: sale.warehouse, lineId: line.id!, quantity: line.quantity!, cycle: cycle + 1,
            change: Prisma.Decimal.min(amount, sale.change.abs().mul(line.quantity!).div(sale.saleQuantity ?? line.quantity!)).toDecimalPlaces(3).negated(), comment: 'Повторное открытие: восстановление исторического расхода',
            snapshot: sale.recipeSnapshot as Prisma.InputJsonValue ?? undefined });
        }
        continue;
      }
      const parentDish = byDish.get(line.dishId!);
      if (!parentDish) continue;
      const warningsStart = warnings.length;
      const stored = storedById.get(line.id!);
      const modifierSelections = stored?.modifierSelections ?? line.modifierSelections;
      const excludedIngredientIds = stored?.excludedIngredientIds ?? line.excludedIngredientIds;
      const modifiers = (Array.isArray(modifierSelections) ? modifierSelections : []) as ModifierSelectionSnapshot[];
      const exclusions = new Set(Array.isArray(excludedIngredientIds) ? excludedIngredientIds as string[] : []);
      recordedSnapshots.set(line.id!, { version: 1, recordedAt: new Date().toISOString(), dishId: parentDish.id,
        recipeVersion: parentDish.recipeVersion, variantId: line.dishVariantId ?? null, excludedIngredientIds: [...exclusions],
        modifierSelections: modifiers as unknown as Prisma.InputJsonValue });
      const servings: { dish: typeof parentDish; variantId?: string | null; quantity: number; componentId?: string; modifiersOnly?: boolean }[] = [];
      if (parentDish.isSet && !parentDish.stockIngredientId && !parentDish.recipeItems.length) {
        const components = await tx.orderItemSetComponent.findMany({ where: { orderItemId: line.id! } });
        const definitions = components.length ? components.filter((component) => component.action !== 'removed').map((component) => ({
          id: component.id, dishId: component.action === 'replaced' ? component.finalDishId : component.originalDishId,
          variantId: component.finalVariantId, variantName: component.originalVariantNameSnapshot, quantity: component.quantity,
        })) : parentDish.setComponents.map((component) => ({ id: component.id, dishId: component.dishId, variantId: component.dishVariantId, variantName: null, quantity: component.quantity }));
        for (const component of definitions) {
          if (!component.dishId) continue;
          const dish = await tx.dish.findUnique({ where: { id: component.dishId }, include: { recipeItems: true, variants: true, category: true, setComponents: true } });
          if (!dish || dish.isSet) throw new BadRequestException('Блюдо состава сета недоступно');
          servings.push({ dish, quantity: line.quantity! * component.quantity, componentId: component.id,
            variantId: component.variantId ?? dish.variants.find((variant) => variant.name === component.variantName)?.id });
        }
        if (modifiers.length) servings.push({ dish: parentDish, quantity: line.quantity!, componentId: '__parent__', modifiersOnly: true });
      } else servings.push({ dish: parentDish, quantity: line.quantity!, variantId: line.dishVariantId });
      for (const serving of servings) {
      const { dish } = serving;
      const variant = serving.variantId ? dish.variants.find((value) => value.id === serving.variantId) : null;
      const directId = variant?.stockIngredientId ?? dish.stockIngredientId;
      const directAmount = variant?.stockIngredientId ? variant.stockAmount : dish.stockAmount;
      const route = routeByStation.get(serving.componentId ? dish.prepStation ?? dish.category.prepStation : line.prepStation ?? dish.prepStation ?? dish.category.prepStation) ?? null;
      const multiplier = new Prisma.Decimal(serving.quantity).mul(dish.isWeighted && line.weightGrams ? new Prisma.Decimal(line.weightGrams).div(dish.weightedPriceBase) : 1);
      const roots = serving.modifiersOnly ? [] : directId ? [{ ingredientId: directId, amount: directAmount, warehouseId: null, fromCommonWarehouse: false, variantAmounts: null }]
        : dish.recipeItems;
      if (!roots.length && !serving.modifiersOnly) warnings.push({ kind: 'unconfigured', dishId: dish.id, ingredientId: '', ingredient: dish.name, warehouseId: route?.id ?? null,
        unit: '', needed: 0, available: 0, missing: 0, message: 'Складской учёт для блюда «' + dish.name + '» не настроен' });
      const selectedModifiers = dish.id === parentDish.id ? modifiers : [];
      const selectedRoots = roots.filter((row) => dish.id !== parentDish.id || directId || !exclusions.has(row.ingredientId))
        .map((row) => ({ ...row, consumed: recipeAmount(row, serving.variantId).mul(multiplier), modifier: null as ModifierSelectionSnapshot | null }));
      for (const modifier of selectedModifiers) if (modifier.ingredientId) selectedRoots.push({ ingredientId: modifier.ingredientId,
        amount: new Prisma.Decimal(modifier.amount), warehouseId: modifier.warehouseId, fromCommonWarehouse: modifier.fromCommonWarehouse,
        variantAmounts: null, consumed: new Prisma.Decimal(modifier.amount).mul(modifier.quantity).mul(line.quantity!), modifier } as typeof selectedRoots[number]);
      for (const row of selectedRoots) {
        const warehouse = row.warehouseId ? warehouseById.get(row.warehouseId) : row.fromCommonWarehouse ? null : route;
        if (row.warehouseId && !warehouse) throw new BadRequestException('Склад рецептуры недоступен');
        const parts = await resolver.expand(row.ingredientId, row.consumed, warehouse ?? null);
        for (const part of parts) {
          const change = part.amount.toDecimalPlaces(3).negated();
          if (change.isZero()) continue;
          plan.push({ ingredient: part.ingredient, warehouse: part.warehouse, lineId: line.id!, quantity: line.quantity!, cycle: 0, change,
            comment: (directId ? 'Прямая продажа: ' : 'Списание по техкарте: ') + dish.name + ' × ' + line.quantity,
            snapshot: { dishId: dish.id, dishName: dish.name, recipeVersion: dish.recipeVersion, variantId: serving.variantId ?? null,
              kind: row.modifier ? 'modifier' : directId ? 'direct' : 'recipe', modifier: row.modifier as unknown as Prisma.InputJsonValue ?? null,
              excludedIngredientIds: [...exclusions], componentId: serving.componentId ?? null, path: part.path, preparationRecipes: part.preparations,
              amount: part.amount.toString(), warehouseId: part.warehouse?.id ?? null } });
        }
      }
      }
      lineWarnings.set(line.id!, warnings.slice(warningsStart).map((warning) => warning.message ?? warning.kind ?? ''));
    }
    await lockIngredients(tx, plan.map((row) => row.ingredient.id));
    const postedWarnings = await this.post(tx, orderId, this.aggregate(plan), 'sale');
    for (const [id, snapshot] of recordedSnapshots) await tx.orderItem.update({ where: { id }, data: {
      stockAccountingSnapshot: { ...(snapshot as Prisma.InputJsonObject), consumed: plan.some((row) => row.lineId === id),
        parts: plan.filter((row) => row.lineId === id).map((row) => row.snapshot!),
        warnings: lineWarnings.get(id) ?? [] },
    } });
    return [...warnings, ...postedWarnings];
  }

  async restoreDishSale(tx: Prisma.TransactionClient, orderId: string, lines: OrderLine[], reason?: string) {
    await this.lockOrderStock(tx, orderId);
    const sourceIds = [...new Set(lines.flatMap((line) => [line.sourceLineId, line.stockSourceLineId, line.id].filter((id): id is string => !!id)))];
    if (!sourceIds.length) return [];
    const sales = await tx.stockMovement.findMany({
      where: { sourceType: 'order', sourceId: orderId, type: 'sale', orderItemId: { in: sourceIds } },
      include: { ingredient: true, warehouse: true },
    });
    if (!sales.length) return [];
    const sourceIdFor = (line: OrderLine) => line.sourceLineId ?? (sales.some((sale) => sale.orderItemId === line.id) ? line.id : line.stockSourceLineId ?? line.id);
    await lockIngredients(tx, sales.map((sale) => sale.ingredientId));
    const expandedLines: OrderLine[] = [];
    for (const line of lines) {
      const sourceId = sourceIdFor(line);
      const recordedComponents = new Set(sales.filter((sale) => sale.orderItemId === sourceId).flatMap((sale) => {
        const snapshot = sale.recipeSnapshot as { componentId?: string; parts?: { componentId?: string }[] } | null;
        return (snapshot?.parts ?? (snapshot ? [snapshot] : [])).flatMap((part) => part.componentId ? [part.componentId] : []);
      }));
      if (!line.componentId && recordedComponents.size && sourceId) {
        const components = await tx.orderItemSetComponent.findMany({ where: { orderItemId: sourceId, id: { in: [...recordedComponents] } } });
        if (components.length) {
          for (const component of components) expandedLines.push({ ...line, id: line.id + ':' + component.id, sourceLineId: sourceId,
            sourceStatus: component.status, componentId: component.id });
          if (recordedComponents.has('__parent__')) expandedLines.push({ ...line, id: line.id + ':__parent__', sourceLineId: sourceId, componentId: '__parent__' });
          continue;
        }
      }
      expandedLines.push(line);
    }
    const returns = await tx.stockMovement.findMany({ where: {
      sourceType: 'order', sourceId: orderId, type: { in: ['return', 'writeoff'] }, OR: [{ orderItemId: { in: sourceIds } }, { saleLineId: { in: sourceIds } }],
    } });
    const originals = await tx.orderItem.findMany({ where: { orderId, id: { in: sourceIds } }, select: { id: true, quantity: true, status: true, prepStation: true } });
    const originalById = new Map(originals.map((line) => [line.id, line]));
    const recorded = new Set(returns.map((row) => [row.orderItemId, row.ingredientId, row.saleCycle, row.warehouseKey].join(':')));
    const refunded = new Map<string, Prisma.Decimal>();
    for (const row of returns) {
      const key = [row.saleLineId ?? row.orderItemId, row.ingredientId, row.saleCycle, row.warehouseKey].join(':');
      const loss = row.type === 'writeoff' ? new Prisma.Decimal(String((row.recipeSnapshot as { lossQuantity?: string } | null)?.lossQuantity ?? 0)) : new Prisma.Decimal(0);
      refunded.set(key, (refunded.get(key) ?? new Prisma.Decimal(0)).add(row.change).add(loss));
    }
    const plan: Movement[] = [];
    for (const line of expandedLines) {
      if (!line.id || !line.quantity || line.quantity <= 0) continue;
      const sourceId = sourceIdFor(line)!;
      const original = originalById.get(sourceId);
      const status = line.sourceStatus ?? (line.sourceLineId ? original?.status : line.status ?? original?.status);
      const sourceSales = sales.filter((sale) => sale.orderItemId === sourceId);
      const latestCycle = Math.max(...sourceSales.map((sale) => sale.saleCycle));
      for (const sale of sourceSales) {
        // A prepared portion's cancellation is a loss, already recorded by the order/kitchen audit.
        // Returning money must not replenish consumed ingredients.
        const snapshot = sale.recipeSnapshot as { kind?: string; parts?: { kind?: string }[] } | null;
        const direct = snapshot?.kind === 'direct' || (snapshot?.parts?.length && snapshot.parts.every((part) => part.kind === 'direct'));
        const unstarted = status === 'new' || status === 'accepted';
        const restorable = unstarted || (direct && (line.prepStation ?? original?.prepStation) === 'none' && status === 'ready');
        const key = [sourceId, sale.ingredientId, sale.saleCycle, sale.warehouseKey].join(':');
        if (sale.saleCycle !== latestCycle || recorded.has([line.id, sale.ingredientId, sale.saleCycle, sale.warehouseKey].join(':'))) continue;
        const quantity = sale.saleQuantity ?? line.sourceLineQuantity ?? original?.quantity ?? line.quantity;
        const remaining = sale.change.abs().sub(refunded.get(key) ?? 0);
        const snapshotParts = sale.recipeSnapshot as { componentId?: string; amount?: string; parts?: { componentId?: string; amount?: string }[] } | null;
        const componentAmount = line.componentId ? (snapshotParts?.parts ?? (snapshotParts ? [snapshotParts] : []))
          .filter((part) => part.componentId === line.componentId).reduce((sum, part) => sum.add(part.amount ?? 0), new Prisma.Decimal(0)) : null;
        const target = componentAmount ?? sale.change.abs();
        const change = Prisma.Decimal.min(remaining, target.mul(line.quantity).div(quantity).toDecimalPlaces(3));
        if (change.lte(0)) continue;
        refunded.set(key, (refunded.get(key) ?? new Prisma.Decimal(0)).add(change));
        if (!restorable) {
          await postStockMovement(tx, { ingredientId: sale.ingredientId, warehouse: sale.warehouse, change: new Prisma.Decimal(0), cost: sale.costAtMoment, costKnown: sale.costKnown, allowNegative: true,
            movement: { type: 'writeoff', sourceType: 'order', sourceId: orderId, orderItemId: line.id, saleLineId: sourceId, saleCycle: sale.saleCycle,
              comment: reason ?? line.rejectReason ?? 'Отмена после начала приготовления',
              recipeSnapshot: { kind: 'prepared_loss', lossQuantity: change.toString(), reason: reason ?? line.rejectReason ?? 'Отмена после начала приготовления', sourceLineId: sourceId,
                originalRecipe: sale.recipeSnapshot ?? null, status: status ?? 'unknown' } } });
          continue;
        }
        plan.push({ ingredient: sale.ingredient, warehouse: sale.warehouse, lineId: line.id, quantity: line.quantity, cycle: sale.saleCycle,
          sourceLineId: sourceId, change, cost: sale.costAtMoment, costKnown: sale.costKnown, comment: 'Возврат до начала приготовления',
          snapshot: sale.recipeSnapshot as Prisma.InputJsonValue ?? undefined });
      }
    }
    return this.post(tx, orderId, plan, 'return');
  }

  private aggregate(plan: Movement[]) {
    const grouped = new Map<string, Movement>();
    for (const row of plan) {
      const key = [row.lineId, row.ingredient.id, warehouseKey(row.warehouse), row.cycle].join(':');
      const previous = grouped.get(key);
      if (previous) {
        previous.change = previous.change.add(row.change);
        const existing = previous.snapshot as { parts?: Prisma.InputJsonValue[] };
        previous.snapshot = { parts: [...(existing.parts ?? [previous.snapshot!]), row.snapshot!] };
      } else grouped.set(key, { ...row });
    }
    return [...grouped.values()];
  }

  private async lockOrderStock(tx: Prisma.TransactionClient, orderId: string) {
    const key = 'warehouse-order:' + (getCafeId() ?? 'legacy') + ':' + orderId;
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS order_stock_lock`;
  }

  private async post(tx: Prisma.TransactionClient, orderId: string, plan: Movement[], type: 'sale' | 'return') {
    if (!plan.length) return [];
    const fresh = await tx.ingredient.findMany({ where: { id: { in: [...new Set(plan.map((row) => row.ingredient.id))] } } });
    const ingredients = new Map(fresh.map((ingredient) => [ingredient.id, ingredient]));
    const grouped = new Map<string, Movement[]>();
    for (const row of plan) {
      const key = warehouseKey(row.warehouse) + ':' + row.ingredient.id;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    const warnings: IngredientStockWarning[] = [];
    for (const rows of grouped.values()) {
      const { warehouse, ingredient } = rows[0];
      const current = ingredients.get(ingredient.id);
      if (!current) throw new BadRequestException('Позиция склада не найдена');
      const balance = await getWarehouseBalance(tx, warehouse, current);
      const total = rows.reduce((sum, row) => sum.add(row.change), new Prisma.Decimal(0));
      if (type === 'sale' && balance.stock.add(total).isNegative()) {
        const unit = ingredient.displayUnit as UnitCode;
        const display = (amount: Prisma.Decimal) => Math.round(fromBase(Number(amount), unit) * 1000) / 1000;
        warnings.push({ kind: 'shortage', ingredientId: ingredient.id, ingredient: ingredient.name, warehouseId: warehouse?.id ?? null,
          warehouseName: warehouse?.name, unit: unitLabel(unit), needed: display(total.abs()), available: display(balance.stock), missing: display(balance.stock.add(total).abs()) });
      }
    }
    const settings = warnings.length ? await tx.settings.findFirst({ select: { allowNegativeIngredientStock: true } }) : null;
    if (warnings.length && settings?.allowNegativeIngredientStock !== true) throw new BadRequestException({ message: 'Недостаточно сырья', shortages: warnings });
    for (const row of plan) await postStockMovement(tx, {
      ingredientId: row.ingredient.id, warehouse: row.warehouse, change: row.change, cost: row.cost, costKnown: row.costKnown,
      valuation: type === 'return' ? 'average' : 'preserve', allowNegative: type === 'return' || settings?.allowNegativeIngredientStock === true,
      movement: { orderItemId: row.lineId, saleQuantity: type === 'sale' ? row.quantity : null, saleCycle: row.cycle,
        saleLineId: row.sourceLineId, type, sourceType: 'order', sourceId: orderId, comment: row.comment, recipeSnapshot: row.snapshot },
    });
    return warnings;
  }
}
