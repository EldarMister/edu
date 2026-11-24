import type { FoodCostMetric, FoodCostPosition, FoodCostReport } from './food-cost-api';

export const DEFAULT_TARGET_FOOD_COST = 30;
export const MAX_MENU_PRICE = 99_999_999.99;
const projectionDays = 30;

export function percentChange(current: number | null, previous: number | null) {
  return current == null || previous == null || previous === 0
    ? null
    : 100 * (current - previous) / Math.abs(previous);
}

export function foodCostPercent(cost: number | null, revenue: number) {
  return cost == null || revenue <= 0 ? null : 100 * cost / revenue;
}

export function aggregateFoodCostMetrics(metrics: readonly FoodCostMetric[]): FoodCostMetric {
  const total: Omit<FoodCostMetric, 'foodCostPercent'> = { quantity: 0, gross: 0, revenue: 0, cost: 0, tax: 0, margin: 0 };
  for (const metric of metrics) {
    total.quantity += metric.quantity;
    total.gross += metric.gross;
    total.revenue += metric.revenue;
    total.cost = addKnown(total.cost, metric.cost);
    total.tax = addKnown(total.tax, metric.tax);
    total.margin = addKnown(total.margin, metric.margin);
  }
  return { ...total, foodCostPercent: foodCostPercent(total.cost, total.revenue) };
}

function addKnown(a: number | null, b: number | null) {
  return a == null || b == null ? null : a + b;
}

function inclusiveDays({ from, to }: FoodCostReport['current']) {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
}

export type FoodCostProjection = Pick<FoodCostMetric, 'revenue' | 'cost' | 'tax' | 'margin' | 'foodCostPercent'> & {
  monthlyMargin: number | null;
  monthlyMarginChange: number | null;
};

type PriceChange = { revenue: number; tax: number | null };

export type FoodCostPriceProjection = { position: FoodCostProjection; category: FoodCostProjection; business: FoodCostProjection };

const unchanged: PriceChange = { revenue: 0, tax: 0 };

function priceSensitivity({ current }: FoodCostPosition) {
  if (current.quantity <= 0) return 0;
  const netShare = current.gross > 0 ? Math.min(1, Math.max(0, current.revenue / current.gross)) : 1;
  return current.quantity * netShare;
}

function positionChange(row: FoodCostPosition, newPrice: number): PriceChange | null {
  if (row.price == null || !Number.isFinite(newPrice) || newPrice < 0 || newPrice > MAX_MENU_PRICE || row.current.quantity <= 0) return null;
  const { current } = row;
  // Reprice the observed sales at the scenario price and retain the observed discount share.
  const revenue = newPrice * priceSensitivity(row) - current.revenue;
  if (revenue === 0) return unchanged;
  const tax = current.tax == null || current.revenue <= 0 ? null : revenue * current.tax / current.revenue;
  return { revenue, tax };
}

function addPriceChange(a: PriceChange, b: PriceChange): PriceChange {
  return { revenue: a.revenue + b.revenue, tax: addKnown(a.tax, b.tax) };
}

function project(base: FoodCostMetric, change: PriceChange, days: number): FoodCostProjection {
  const revenue = base.revenue + change.revenue;
  const marginChange = change.tax == null ? null : change.revenue - change.tax;
  const margin = addKnown(base.margin, marginChange);
  return { revenue, cost: base.cost, tax: addKnown(base.tax, change.tax), margin,
    foodCostPercent: foodCostPercent(base.cost, revenue),
    monthlyMargin: margin == null ? null : margin * projectionDays / days,
    monthlyMarginChange: margin == null || marginChange == null ? null : marginChange * projectionDays / days };
}

export function projectFoodCostBasket(report: FoodCostReport, changes: Readonly<Record<string, number>>) {
  const days = inclusiveDays(report.current);
  const positions: Record<string, FoodCostProjection> = Object.create(null);
  const categories: Record<string, FoodCostProjection> = Object.create(null);
  const groups = new Map<string, { metrics: FoodCostMetric[]; change: PriceChange }>();
  let totalChange = unchanged;
  for (const row of report.positions) {
    const group = groups.get(row.categoryId) ?? { metrics: [], change: unchanged };
    group.metrics.push(row.current);
    groups.set(row.categoryId, group);
    if (!Object.prototype.hasOwnProperty.call(changes, row.id)) continue;
    const change = positionChange(row, changes[row.id]);
    if (!change) continue;
    positions[row.id] = project(row.current, change, days);
    group.change = addPriceChange(group.change, change);
    totalChange = addPriceChange(totalChange, change);
  }
  for (const [key, group] of groups) {
    categories[key] = project(aggregateFoodCostMetrics(group.metrics), group.change, days);
  }
  return { positions, categories, business: project(report.current.totals, totalChange, days) };
}

export function projectFoodCostPrice(report: FoodCostReport, positionId: string, newPrice: number): FoodCostPriceProjection | null {
  const row = report.positions.find(({ id }) => id === positionId);
  const change = row && positionChange(row, newPrice);
  if (!row || !change) return null;
  const days = inclusiveDays(report.current);
  const categoryMetrics = report.positions.filter(({ categoryId }) => categoryId === row.categoryId).map(({ current }) => current);
  return {
    position: project(row.current, change, days),
    category: project(aggregateFoodCostMetrics(categoryMetrics), change, days),
    business: project(report.current.totals, change, days),
  };
}

export type FoodCostDriver = {
  kind: 'ingredients' | 'mix' | 'composition';
  title: string;
  text: string;
};

export type FoodCostRecommendation = {
  id: string;
  kind: 'price' | 'purchase' | 'promotion';
  priority: 'critical' | 'important' | 'opportunity';
  title: string;
  text: string;
  monthlyMarginChange: number | null;
  positionId?: string;
  newPrice?: number;
};

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const decimals = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const som = (value: number) => money.format(value) + ' с';
const percent = (value: number) => decimals.format(value) + '%';

function pricesAndVolumes(report: FoodCostReport) {
  return report.ingredients.flatMap(({ id, name, unit, current, previous }) => {
    if (current.purchasePrice == null || previous.purchasePrice == null) return [];
    const change = current.purchasePrice - previous.purchasePrice;
    if (Math.abs(change) < 0.005) return [];
    return [{ id, name, unit, before: previous.purchasePrice, now: current.purchasePrice,
      change, quantity: current.quantity, turnover: current.cost ?? 0 }];
  }).sort((a, b) => Math.abs(b.change * b.quantity) - Math.abs(a.change * a.quantity) || b.turnover - a.turnover);
}

function ingredientDriver(changes: ReturnType<typeof pricesAndVolumes>): FoodCostDriver | undefined {
  const changesText = changes.slice(0, 3).map(({ name, before, now, unit }) =>
    `${name} — ${som(before)} → ${som(now)} за ${unit}`);
  if (!changesText.length) return undefined;
  return { kind: 'ingredients', title: 'Закупочные цены', text: changesText.join(', ') + '.' };
}

function salesMixDriver(report: FoodCostReport): FoodCostDriver | undefined {
  if (report.current.totals.revenue <= 0) return undefined;
  const categories = new Map<string, { name: string; current: number; previous: number }>();
  for (const row of report.positions) {
    const group = categories.get(row.categoryId) ?? { name: row.category, current: 0, previous: 0 };
    group.current += row.current.revenue;
    group.previous += row.previous.revenue;
    categories.set(row.categoryId, group);
  }
  const [leading] = [...categories.values()].sort((a, b) => b.current - a.current);
  if (!leading || leading.current <= 0) return undefined;
  const currentShare = 100 * leading.current / report.current.totals.revenue;
  const previousShare = report.previous.totals.revenue > 0 ? 100 * leading.previous / report.previous.totals.revenue : null;
  const movement = previousShare == null ? '' : ` Доля в прошлом периоде составляла ${percent(previousShare)}.`;
  return { kind: 'mix', title: 'Структура продаж',
    text: `«${leading.name}» дала ${percent(currentShare)} выручки (${som(leading.current)}).${movement}` };
}

function componentCostDriver(report: FoodCostReport): FoodCostDriver | undefined {
  let largest: { position: string; ingredient: string; before: number; now: number } | undefined;
  for (const row of report.positions) {
    if (row.current.quantity <= 0 || row.previous.quantity <= 0 || row.current.cost == null || row.previous.cost == null) continue;
    for (const ingredient of row.ingredients) {
      if (ingredient.currentCost == null || ingredient.previousCost == null) continue;
      const before = ingredient.previousUnitCost ?? ingredient.previousCost / row.previous.quantity;
      const now = ingredient.currentUnitCost ?? ingredient.currentCost / row.current.quantity;
      if (Math.abs(now - before) < 0.01) continue;
      if (!largest || Math.abs(now - before) > Math.abs(largest.now - largest.before)) {
        largest = { position: row.name, ingredient: ingredient.name, before, now };
      }
    }
  }
  if (!largest) return undefined;
  return { kind: 'composition', title: 'Себестоимость состава',
    text: `В позиции «${largest.position}» стоимость компонента «${largest.ingredient}» на единицу продажи изменилась с ${som(largest.before)} до ${som(largest.now)}.` };
}

function priceRecommendation(row: FoodCostPosition, target: number, days: number): FoodCostRecommendation | null {
  const { current } = row;
  const sensitivity = priceSensitivity(row);
  if (!row.active || !row.dishId || row.price == null || sensitivity <= 0 || current.revenue <= 0 ||
      current.cost == null || current.foodCostPercent == null || current.foodCostPercent <= target) return null;
  const targetRevenue = 100 * current.cost / target;
  const newPrice = Math.ceil(targetRevenue / sensitivity);
  const change = positionChange(row, newPrice);
  if (!change || newPrice <= row.price) return null;
  const projected = project(current, change, days);
  return { id: 'price:' + row.id, kind: 'price', priority: current.margin != null && current.margin <= 0 ? 'critical' : 'important',
    title: `Проверить цену «${row.name}»`,
    text: `Фудкост за период — ${percent(current.foodCostPercent)}. Цена ${som(newPrice)} приблизит его к цели ${percent(target)} при том же объёме продаж и себестоимости.`,
    monthlyMarginChange: projected.monthlyMarginChange, positionId: row.id, newPrice };
}

export function foodCostInsights(report: FoodCostReport, targetFoodCost = DEFAULT_TARGET_FOOD_COST) {
  const target = targetFoodCost > 0 && targetFoodCost <= 100 ? targetFoodCost : DEFAULT_TARGET_FOOD_COST;
  const changes = pricesAndVolumes(report);
  const drivers = [ingredientDriver(changes), salesMixDriver(report), componentCostDriver(report)]
    .filter((driver): driver is FoodCostDriver => !!driver);
  const days = inclusiveDays(report.current);
  const recommendations = report.positions
    .map((row) => priceRecommendation(row, target, days))
    .filter((recommendation): recommendation is FoodCostRecommendation => recommendation !== null)
    .sort((a, b) => Number(b.priority === 'critical') - Number(a.priority === 'critical') ||
      (b.monthlyMarginChange ?? 0) - (a.monthlyMarginChange ?? 0)).slice(0, 4);
  const increasedPrice = changes.find(({ change, quantity }) => change > 0 && quantity > 0);
  if (increasedPrice) {
    const { id, name, unit, before, now, change, quantity } = increasedPrice;
    recommendations.push({ id: 'purchase:' + id, kind: 'purchase', priority: 'important',
      title: `Проверить закупки «${name}»`,
      text: `Средняя цена выросла с ${som(before)} до ${som(now)} за ${unit}. Оценка экономии рассчитана при прежней закупочной цене и текущем расходе.`,
      monthlyMarginChange: quantity * change * projectionDays / days });
  }
  const profitable = report.positions
    .filter(({ active, current }) => active && current.quantity > 0 && current.margin != null && current.margin > 0 &&
      current.foodCostPercent != null && current.foodCostPercent < target)
    .sort((a, b) => (b.current.margin ?? 0) - (a.current.margin ?? 0))[0];
  if (profitable?.current.margin != null) {
    recommendations.push({ id: 'promotion:' + profitable.id, kind: 'promotion', priority: 'opportunity',
      title: `Предлагать «${profitable.name}» чаще`,
      text: 'Оценка показывает, сколько маржи даст сценарий роста объёма на 20% при текущей марже на единицу продажи.',
      monthlyMarginChange: profitable.current.margin * 0.2 * projectionDays / days, positionId: profitable.id });
  }
  return { drivers, recommendations };
}
