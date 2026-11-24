import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { activeCostRoutes, historicalCostRoutes, historicalCosts, orderProductSales,
  statisticsMovementSelect, statisticsOrderSelect } from '../admin/statistics-reports';
import { getCafeId } from '../tenant/tenant-context';
import { warehouseDateRange, warehouseDay } from './report-range';
import { normalizeUnit, unitDef, unitLabel } from './units';

type ReportDates = { from: string; to: string };
type PeriodName = 'current' | 'previous';
type Totals = { quantity: number; gross: number; revenue: number; cost: number | null; tax: number | null };
type IngredientFlow = { quantity: number; cost: number | null };
type PurchaseTotals = { quantity: Prisma.Decimal; total: Prisma.Decimal };
type DailyPurchase = PurchaseTotals & { ingredientId: string; date: string };
type IngredientPeriods = Record<PeriodName, IngredientFlow>;
type Position = {
  id: string;
  dishId: string | null;
  variantId: string | null;
  name: string;
  categoryId: string;
  category: string;
  price: number | null;
  priceBasis: number;
  priceUnit: 'pcs' | 'g' | 'ml';
  active: boolean;
  catalogKind: 'goods' | 'recipe';
  isSet: boolean;
  current: Totals;
  previous: Totals;
  days: Map<string, Totals>;
  ingredients: Map<string, IngredientPeriods>;
};

const elapsedDay = 24 * 60 * 60 * 1000;
const emptyTotals = (): Totals => ({ quantity: 0, gross: 0, revenue: 0, cost: 0, tax: 0 });
const emptyIngredientFlow = (): IngredientFlow => ({ quantity: 0, cost: 0 });
const emptyIngredientPeriods = (): IngredientPeriods => ({ current: emptyIngredientFlow(), previous: emptyIngredientFlow() });
const zero = new Prisma.Decimal(0);
const fixed = (value: number, places: number) => Number(new Prisma.Decimal(value).toDecimalPlaces(places));
const money = (value: number) => fixed(value, 2);
const addKnown = (left: number | null, right: number | null) => left == null || right == null ? null : left + right;
const nullableMoney = (value: number | null) => value == null ? null : money(value);

function addTotals(total: Totals, line: Totals) {
  total.quantity += line.quantity;
  total.gross += line.gross;
  total.revenue += line.revenue;
  total.cost = addKnown(total.cost, line.cost);
  total.tax = addKnown(total.tax, line.tax);
}

function asMetric(totals: Totals) {
  return {
    quantity: fixed(totals.quantity, 6),
    gross: money(totals.gross),
    revenue: money(totals.revenue),
    cost: nullableMoney(totals.cost),
    tax: nullableMoney(totals.tax),
    margin: totals.cost == null || totals.tax == null ? null : money(totals.revenue - totals.cost - totals.tax),
    foodCostPercent: totals.cost == null || totals.revenue <= 0 ? null : fixed(totals.cost / totals.revenue * 100, 4),
  };
}

function addIngredient(map: Map<string, IngredientPeriods>, id: string, period: PeriodName, quantity: number, cost: number | null) {
  const flows = map.get(id) ?? emptyIngredientPeriods();
  flows[period].quantity += quantity;
  flows[period].cost = addKnown(flows[period].cost, cost);
  map.set(id, flows);
}

function reportScope(dates: ReportDates) {
  const { gte, lte } = warehouseDateRange(dates.from, dates.to) ?? {};
  if (!gte || !lte) throw new BadRequestException('Укажите начало и конец периода');
  const length = Math.round((lte.getTime() + 1 - gte.getTime()) / elapsedDay);
  // Compared periods and their series are read together in one reporting snapshot.
  if (length > 366) throw new BadRequestException('Выберите период не длиннее 366 дней');
  const precedingEnd = new Date(gte.getTime() - 1);
  const precedingStart = new Date(gte.getTime() - length * elapsedDay);
  return {
    range: { gte: precedingStart, lte },
    periods: {
      current: dates,
      previous: { from: warehouseDay(precedingStart), to: warehouseDay(precedingEnd) },
    },
    getPeriod: (date: string): PeriodName => date >= dates.from ? 'current' : 'previous',
  };
}

const foodCostOrderSelect = {
  ...statisticsOrderSelect,
  items: {
    ...statisticsOrderSelect.items,
    select: {
      ...statisticsOrderSelect.items.select,
      weightGrams: true,
      dish: { select: { category: { select: { id: true, name: true, cafeId: true } }, name: true, price: true,
        cafeId: true, catalogKind: true, isWeighted: true, weightedMeasure: true, weightedPriceBase: true, isActive: true, isSet: true } },
      dishVariant: { select: { dishId: true, cafeId: true, name: true, price: true } },
    },
  },
} satisfies Prisma.OrderSelect;

type FoodCostItem = Prisma.OrderGetPayload<{ select: typeof foodCostOrderSelect }>['items'][number];

function positionId(item: FoodCostItem) {
  // For a weighted dish, the variant snapshot is the selected weight/volume, not a menu variant.
  return JSON.stringify([item.dishId ?? item.dishNameSnapshot,
    item.weightGrams != null ? 'weighted' : 'unit',
    item.weightGrams != null ? null : item.dishVariantId ?? item.dishVariantNameSnapshot]);
}

function menuPosition(item: FoodCostItem, id: string, cafeId: string): Position {
  const dish = item.dish?.cafeId === cafeId ? item.dish : null;
  const category = dish?.category.cafeId === cafeId ? dish.category : null;
  const weightedSale = item.weightGrams != null;
  const variant = !weightedSale && item.dishVariant?.cafeId === cafeId && item.dishVariant.dishId === item.dishId ? item.dishVariant : null;
  const variantName = weightedSale ? null : variant?.name ?? item.dishVariantNameSnapshot;
  const dishName = dish?.name ?? item.dishNameSnapshot;
  const menuPrice = !dish || dish.isWeighted !== weightedSale ? null
    : weightedSale ? dish.price : variantName || item.dishVariantId ? variant?.price : dish.price;
  return {
    id,
    dishId: dish ? item.dishId : null,
    variantId: variant ? item.dishVariantId : null,
    name: variantName ? `${dishName} · ${variantName}` : dishName,
    categoryId: category?.id ?? 'uncategorized',
    category: category?.name ?? 'Без категории',
    price: menuPrice == null ? null : Number(menuPrice),
    priceBasis: weightedSale && dish?.isWeighted ? dish.weightedPriceBase || 1 : 1,
    priceUnit: weightedSale && dish?.isWeighted ? dish.weightedMeasure === 'volume' ? 'ml' : 'g' : 'pcs',
    active: !!dish?.isActive && menuPrice != null,
    catalogKind: dish?.catalogKind === 'goods' && !dish.isSet ? 'goods' : 'recipe',
    isSet: !!dish?.isSet,
    current: emptyTotals(),
    previous: emptyTotals(),
    days: new Map(),
    ingredients: new Map(),
  };
}

async function purchasesByDay(db: Prisma.TransactionClient, cafeId: string, range: { gte: Date; lte: Date }) {
  return db.$queryRaw<DailyPurchase[]>`
    SELECT pi.ingredient_id AS "ingredientId",
      (COALESCE(p.effective_at, p.stock_posted_at, p.date) + INTERVAL '6 hours')::date::text AS "date",
      SUM(pi.quantity_base) AS "quantity", SUM(pi.total) AS "total"
    FROM purchases p JOIN purchase_items pi ON pi.purchase_id = p.id
    WHERE p.cafe_id = ${cafeId} AND pi.cafe_id = ${cafeId} AND p.status = 'completed'
      AND COALESCE(p.effective_at, p.stock_posted_at, p.date) BETWEEN (${range.gte} AT TIME ZONE 'UTC') AND (${range.lte} AT TIME ZONE 'UTC')
      AND pi.quantity_base > 0
    GROUP BY pi.ingredient_id, 2
    ORDER BY "date"
  `;
}

export async function readFoodCostReport(db: Prisma.TransactionClient, input: ReportDates) {
  const cafeId = getCafeId();
  if (!cafeId) throw new BadRequestException('Заведение не назначено');
  const asOf = new Date().toISOString();
  const { range, periods, getPeriod } = reportScope({ from: input.from, to: input.to });
  const [orders, purchases] = await Promise.all([
    db.order.findMany({ where: { cafeId, status: 'paid', closedAt: range }, select: foodCostOrderSelect }),
    purchasesByDay(db, cafeId, range),
  ]);

  const movements: Prisma.StockMovementGetPayload<{ select: typeof statisticsMovementSelect }>[] = [];
  for (let offset = 0; offset < orders.length; offset += 5000) {
    const batch = await db.stockMovement.findMany({
      where: { cafeId, sourceType: 'order', sourceId: { in: orders.slice(offset, offset + 5000).map(({ id }) => id) },
        type: { in: ['sale', 'return', 'writeoff'] } },
      select: statisticsMovementSelect,
    });
    for (const movement of batch) movements.push(movement);
  }

  const routes = historicalCostRoutes(movements);
  const costs = historicalCosts(routes);
  const ingredients = new Map<string, IngredientPeriods>();
  const purchaseByIngredient = new Map<string, DailyPurchase[]>();
  for (const purchase of purchases) {
    if (!purchaseByIngredient.has(purchase.ingredientId)) purchaseByIngredient.set(purchase.ingredientId, []);
    purchaseByIngredient.get(purchase.ingredientId)!.push(purchase);
    if (!ingredients.has(purchase.ingredientId)) ingredients.set(purchase.ingredientId, emptyIngredientPeriods());
  }

  const positions = new Map<string, Position>();
  const days = new Map<string, Totals>();
  const totals: Record<PeriodName, Totals> = { current: emptyTotals(), previous: emptyTotals() };

  for (const order of orders) {
    if (!order.closedAt) continue;
    const date = warehouseDay(order.closedAt);
    const period = getPeriod(date);
    const day = days.get(date) ?? emptyTotals();
    const { lines } = orderProductSales(order, costs, true);
    for (const line of lines) {
      if (!line.quantity && !line.revenue && !line.cost) continue;
      const key = positionId(line.item);
      const position = positions.get(key) ?? menuPosition(line.item, key, cafeId);
      const quantity = position.priceUnit !== 'pcs' && line.item.weightGrams != null
        ? line.quantity * line.item.weightGrams / position.priceBasis : line.quantity;
      const amounts = { ...line, quantity };
      const positionDay = position.days.get(date) ?? emptyTotals();
      addTotals(position[period], amounts);
      addTotals(positionDay, amounts);
      addTotals(totals[period], amounts);
      addTotals(day, amounts);
      position.days.set(date, positionDay);
      positions.set(key, position);
      const byLine = line.costOrigin ? routes.get(line.costOrigin) : null;
      if (!byLine || !line.costShare) continue;
      for (const route of activeCostRoutes(byLine.values())) {
        const consumed = (route.sold - route.released) * line.costShare;
        const cost = route.unknown ? null : route.cost * line.costShare;
        addIngredient(ingredients, route.ingredientId, period, consumed, cost);
        addIngredient(position.ingredients, route.ingredientId, period, consumed, cost);
      }
    }
    days.set(date, day);
  }

  const ingredientNames = ingredients.size ? await db.ingredient.findMany({ where: { cafeId, id: { in: [...ingredients.keys()] } },
    select: { id: true, name: true, displayUnit: true } }) : [];
  const details = new Map(ingredientNames.map(({ id, name, displayUnit }) => {
    const unit = normalizeUnit(displayUnit);
    return [id, { id, name, unit: unitLabel(unit), factor: unitDef(unit).factor }];
  }));
  const series = (values: Map<string, Totals>) => [...values].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, ...asMetric(value) }));
  const allDays = Array.from({ length: Math.round((range.lte.getTime() + 1 - range.gte.getTime()) / elapsedDay) }, (_, offset) => {
    const date = warehouseDay(new Date(range.gte.getTime() + offset * elapsedDay));
    return { date, ...asMetric(days.get(date) ?? emptyTotals()) };
  });
  const periodResult = (period: PeriodName) => ({ ...periods[period], totals: asMetric(totals[period]),
    days: allDays.filter(({ date }) => getPeriod(date) === period) });
  return {
    asOf,
    current: periodResult('current'),
    previous: periodResult('previous'),
    positions: [...positions.values()].sort((a, b) => b.current.revenue - a.current.revenue || a.name.localeCompare(b.name, 'ru'))
      .map(({ current, previous, days, ingredients, ...position }) => ({
        ...position, current: asMetric(current), previous: asMetric(previous), days: series(days),
        ingredients: [...ingredients].flatMap(([id, flows]) => {
          const ingredient = details.get(id);
          if (!ingredient) return [];
          const currentCost = flows.current.cost;
          const previousCost = flows.previous.cost;
          return [{ id, name: ingredient.name, unit: ingredient.unit,
            currentCost: nullableMoney(currentCost), previousCost: nullableMoney(previousCost),
            currentUnitCost: currentCost != null && current.quantity > 0 ? fixed(currentCost / current.quantity, 4) : null,
            previousUnitCost: previousCost != null && previous.quantity > 0 ? fixed(previousCost / previous.quantity, 4) : null }];
        }).sort((a, b) => (b.currentCost ?? -1) - (a.currentCost ?? -1) || a.name.localeCompare(b.name, 'ru')),
      })),
    ingredients: ingredientNames.map(({ id }) => {
      const { factor, ...ingredient } = details.get(id)!;
      const flow = ingredients.get(id)!;
      const receipts = purchaseByIngredient.get(id) ?? [];
      const costFor = (period: PeriodName) => {
        const sums = receipts.filter(({ date }) => getPeriod(date) === period)
          .reduce((sum, row) => ({ quantity: sum.quantity.add(row.quantity), total: sum.total.add(row.total) }), { quantity: zero, total: zero });
        return { quantity: fixed(flow[period].quantity / factor, 6), cost: nullableMoney(flow[period].cost),
          purchasePrice: sums.quantity.gt(0) ? sums.total.div(sums.quantity).mul(factor).toDecimalPlaces(6).toNumber() : null };
      };
      return { ...ingredient, current: costFor('current'), previous: costFor('previous'),
        prices: receipts.map(({ date, quantity, total }) => ({ date, price: total.div(quantity).mul(factor).toDecimalPlaces(6).toNumber() })) };
    }).sort((a, b) => (b.current.cost ?? -1) - (a.current.cost ?? -1) || a.name.localeCompare(b.name, 'ru')),
  };
}

export type FoodCostReport = Awaited<ReturnType<typeof readFoodCostReport>>;
