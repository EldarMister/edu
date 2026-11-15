import { Prisma } from '@prisma/client';
import { preparedLossQuantity } from '../warehouse/movement-cost';
import { warehouseDay } from '../warehouse/report-range';

export const statisticsOrderSelect = {
  id: true, createdAt: true, closedAt: true, waiterId: true, finalAmount: true,
  paymentMethod: true, discountAmount: true, serviceChargeAmount: true,
  waiter: { select: { name: true } },
  payments: { select: { method: true, amount: true, status: true } },
  items: {
    where: { status: { notIn: ['cancelled', 'rejected'] } },
    select: {
      id: true, dishId: true, dishVariantId: true, dishNameSnapshot: true, dishVariantNameSnapshot: true,
      quantity: true, priceSnapshot: true, discountAmount: true, finalPrice: true,
      stockSourceLineId: true, stockAccountingSnapshot: true,
      dish: { select: { category: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.OrderSelect;

export const statisticsMovementSelect = {
  type: true, sourceType: true, sourceId: true, orderItemId: true, saleLineId: true,
  saleCycle: true, warehouseKey: true, ingredientId: true, change: true,
  recipeSnapshot: true, costAtMoment: true, costKnown: true,
} satisfies Prisma.StockMovementSelect;

type Order = Prisma.OrderGetPayload<{ select: typeof statisticsOrderSelect }>;
type Movement = Prisma.StockMovementGetPayload<{ select: typeof statisticsMovementSelect }>;
type Item = Order['items'][number];
type SaleCost = { cost: number; sold: number; released: number; unknown: boolean };
type Product = { id: string; name: string; categoryId: string; category: string; waiterId: string; waiter: string;
  quantity: number; gross: number; discount: number; revenue: number; cost: number | null };
type Category = { id: string; name: string; quantity: number; revenue: number; cost: number | null };
type Staff = { id: string; name: string; orders: number; revenue: number; seconds: number; cost: number | null };
type Sale = { date: string; orders: number; revenue: number; discount: number; serviceCharge: number };
type Payments = { date: string; orders: number; cash: number; card: number; qr: number; other: number };

const money = (value: number) => Number(new Prisma.Decimal(value).toDecimalPlaces(2));
const plusCost = (left: number | null, right: number | null) => left == null || right == null ? null : left + right;
const profit = (revenue: number, cost: number | null) => cost == null ? null : money(revenue - cost);
const byRevenue = (left: { revenue: number }, right: { revenue: number }) => right.revenue - left.revenue;
const byDate = (left: { date: string }, right: { date: string }) => right.date.localeCompare(left.date);

/** Keep sale, return and prepared loss together by original stock route and posting cycle. */
function historicalCosts(movements: Movement[]) {
  const routesByLine = new Map<string, Map<string, SaleCost>>();
  for (const movement of movements) {
    const origin = movement.type === 'sale' ? movement.orderItemId : movement.saleLineId ?? movement.orderItemId;
    if (!origin) continue;
    const released = movement.type === 'return' ? Math.max(0, Number(movement.change)) : Number(preparedLossQuantity(movement));
    const sold = movement.type === 'sale' ? -Number(movement.change) : 0;
    if (!released && !sold) continue;
    const routes = routesByLine.get(origin) ?? new Map<string, SaleCost>();
    const route = JSON.stringify([movement.sourceId, movement.ingredientId, movement.warehouseKey, movement.saleCycle]);
    const entry = routes.get(route) ?? { sold: 0, released: 0, cost: 0, unknown: false };
    entry.sold += sold;
    entry.released += released;
    entry.cost += (sold - released) * Number(movement.costAtMoment);
    entry.unknown ||= sold > 0 && !movement.costKnown;
    routes.set(route, entry);
    routesByLine.set(origin, routes);
  }
  const costs = new Map<string, number | null>();
  for (const [origin, routes] of routesByLine) {
    const active = [...routes.values()].filter(({ sold, released }) => sold - released > 0.000_000_1);
    const hasSale = [...routes.values()].some(({ sold }) => sold > 0);
    if (hasSale) costs.set(origin, active.every(({ unknown }) => !unknown) ? active.reduce((sum, route) => sum + route.cost, 0) : null);
  }
  return costs;
}

function itemSnapshot(item: Item) {
  const snapshot = item.stockAccountingSnapshot;
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null;
}

function costsForOrder(items: Item[], costs: Map<string, number | null>, showCosts: boolean) {
  if (!showCosts) return new Map<string, number>();
  const originFor = (item: Item) => costs.has(item.id) ? item.id : item.stockSourceLineId ?? item.id;
  const quantityByOrigin = new Map<string, number>();
  for (const item of items) {
    const origin = originFor(item);
    quantityByOrigin.set(origin, (quantityByOrigin.get(origin) ?? 0) + item.quantity);
  }
  const itemCosts = new Map<string, number>();
  for (const item of items) {
    const origin = originFor(item);
    const snapshot = itemSnapshot(item);
    if (Array.isArray(snapshot?.warnings) && snapshot.warnings.length) continue;
    const knownEmpty = snapshot?.consumed === false && Array.isArray(snapshot.warnings) && !snapshot.legacyRecorded;
    const cost = costs.get(origin);
    if (cost != null && quantityByOrigin.get(origin)) {
      itemCosts.set(item.id, cost * item.quantity / quantityByOrigin.get(origin)!);
    } else if (!costs.has(origin) && knownEmpty) itemCosts.set(item.id, 0);
  }
  return itemCosts;
}

function addPayments(report: Payments, order: Order) {
  const confirmed = order.payments.filter(({ status }) => status === 'paid');
  // Older closed checks can have only a method and a check total.
  const payments = order.payments.length ? confirmed : [{ method: order.paymentMethod, amount: order.finalAmount }];
  for (const { method, amount } of payments) {
    const column = method === 'cash' || method === 'card' || method === 'qr' ? method : 'other';
    report[column] += Number(amount);
  }
}

export function buildStatisticsReports(orders: Order[], movements: Movement[], showCosts: boolean) {
  const sales = new Map<string, Sale>();
  const payments = new Map<string, Payments>();
  const staff = new Map<string, Staff>();
  const categories = new Map<string, Category>();
  const products = new Map<string, Product>();
  const costs = historicalCosts(movements);

  for (const order of orders) {
    if (!order.closedAt) continue;
    const date = warehouseDay(order.closedAt);
    const sale = sales.get(date) ?? { date, orders: 0, revenue: 0, discount: 0, serviceCharge: 0 };
    sale.orders++;
    sale.revenue += Number(order.finalAmount);
    sale.discount += Number(order.discountAmount);
    sale.serviceCharge += Number(order.serviceChargeAmount);
    sales.set(date, sale);
    const payment = payments.get(date) ?? { date, orders: 0, cash: 0, card: 0, qr: 0, other: 0 };
    payment.orders++;
    addPayments(payment, order);
    payments.set(date, payment);

    const waiterId = order.waiterId ?? 'qr';
    const waiter = order.waiter?.name ?? 'QR-меню';
    const employee = staff.get(waiterId) ?? { id: waiterId, name: waiter, orders: 0, revenue: 0, seconds: 0, cost: 0 };
    employee.orders++;
    employee.revenue += Number(order.finalAmount);
    employee.seconds += Math.max(0, (order.closedAt.getTime() - order.createdAt.getTime()) / 1000);
    if (!order.items.length || !showCosts) employee.cost = null;
    staff.set(waiterId, employee);

    const itemCosts = costsForOrder(order.items, costs, showCosts);
    for (const item of order.items) {
      const categoryId = item.dish?.category.id ?? 'uncategorized';
      const category = item.dish?.category.name ?? 'Без категории';
      const categoryRow = categories.get(categoryId) ?? { id: categoryId, name: category, quantity: 0, revenue: 0, cost: 0 };
      const name = item.dishVariantNameSnapshot ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}` : item.dishNameSnapshot;
      const id = JSON.stringify([item.dishId, item.dishVariantId, name, categoryId, waiterId]);
      const product = products.get(id) ?? { id, name, categoryId, category, waiterId, waiter, quantity: 0, gross: 0, discount: 0, revenue: 0, cost: 0 };
      const revenue = Number(item.finalPrice);
      const cost = itemCosts.get(item.id) ?? null;
      product.quantity += item.quantity;
      product.gross += Number(item.priceSnapshot) * item.quantity;
      product.discount += Number(item.discountAmount);
      product.revenue += revenue;
      product.cost = plusCost(product.cost, cost);
      products.set(id, product);
      categoryRow.quantity += item.quantity;
      categoryRow.revenue += revenue;
      categoryRow.cost = plusCost(categoryRow.cost, cost);
      categories.set(categoryId, categoryRow);
      employee.cost = plusCost(employee.cost, cost);
    }
  }

  return {
    sales: [...sales.values()].sort(byDate).map((row) => ({ ...row, revenue: money(row.revenue), avgCheck: money(row.revenue / row.orders),
      discount: money(row.discount), serviceCharge: money(row.serviceCharge) })),
    payments: [...payments.values()].sort(byDate).map((row) => ({ ...row, cash: money(row.cash), card: money(row.card),
      qr: money(row.qr), other: money(row.other), total: money(row.cash + row.card + row.qr + row.other) })),
    staff: [...staff.values()].sort(byRevenue).map(({ cost, seconds, ...row }) => ({ ...row, revenue: money(row.revenue),
      avgCheck: money(row.revenue / row.orders), avgSeconds: Math.round(seconds / row.orders), profit: profit(row.revenue, cost) })),
    products: [...products.values()].sort(byRevenue).map((row) => ({ ...row, gross: money(row.gross), discount: money(row.discount),
      revenue: money(row.revenue), cost: row.cost == null ? null : money(row.cost), profit: profit(row.revenue, row.cost) })),
    categories: [...categories.values()].sort(byRevenue).map((row) => ({ ...row, revenue: money(row.revenue),
      cost: row.cost == null ? null : money(row.cost), profit: profit(row.revenue, row.cost) })),
  };
}
