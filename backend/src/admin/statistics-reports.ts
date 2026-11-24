import { Prisma } from '@prisma/client';
import { allocateOrderItemCents, netItemAmount, netItemQuantity, netOrderAmount, netPaymentAmount } from '../orders/order-net';
import type { RefundTaxReversal } from '../orders/order-refund-plan';
import { preparedLossQuantity } from '../warehouse/movement-cost';
import { warehouseDay } from '../warehouse/report-range';

export const statisticsOrderSelect = {
  id: true, createdAt: true, closedAt: true, waiterId: true, finalAmount: true,
  paymentMethod: true, discountAmount: true, refundedAmount: true, serviceChargeAmount: true,
  waiter: { select: { name: true } },
  payments: { select: { method: true, amount: true, status: true, refundedAmount: true } },
  taxes: { where: { reversedAt: null }, select: { taxId: true, salesAmount: true, amount: true, itemAmounts: true } },
  refunds: { where: { status: 'approved' }, select: { taxReversals: true } },
  items: {
    where: { status: { notIn: ['cancelled', 'rejected'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, dishId: true, dishVariantId: true, dishNameSnapshot: true, dishVariantNameSnapshot: true,
      quantity: true, refundedQuantity: true, priceSnapshot: true, discountAmount: true, finalPrice: true,
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
type SaleCost = { ingredientId: string; cost: number; sold: number; released: number; unknown: boolean };
type Product = { id: string; productKey: string; variantKey: string; baseName: string; name: string; categoryId: string; category: string; waiterId: string; waiter: string;
  quantity: number; gross: number; discount: number; revenue: number; cost: number | null; tax: number | null };
type Category = { id: string; name: string; quantity: number; revenue: number; cost: number | null; tax: number | null };
type Staff = { id: string; name: string; orders: number; revenue: number; seconds: number; cost: number | null; tax: number };
type Sale = { date: string; orders: number; paidAmount: number; refundedAmount: number; discount: number };
type Payments = { date: string; orders: number; cash: number; card: number; qr: number; other: number };

const money = (value: number) => Number(new Prisma.Decimal(value).toDecimalPlaces(2));
const plusCost = (left: number | null, right: number | null) => left == null || right == null ? null : left + right;
const profitBeforeRounding = (revenue: number, cost: number | null, tax: number | null) =>
  cost == null || tax == null ? null : revenue - cost - tax;
const profit = (revenue: number, cost: number | null, tax: number | null) => {
  const value = profitBeforeRounding(revenue, cost, tax);
  return value == null ? null : money(value);
};
const byRevenue = (left: { revenue: number }, right: { revenue: number }) => right.revenue - left.revenue;
const byDate = (left: { date: string }, right: { date: string }) => right.date.localeCompare(left.date);

/** Keep sale, return and prepared loss together by original stock route and posting cycle. */
export function historicalCostRoutes(movements: Movement[]) {
  const routesByLine = new Map<string, Map<string, SaleCost>>();
  for (const movement of movements) {
    const origin = movement.type === 'sale' ? movement.orderItemId : movement.saleLineId ?? movement.orderItemId;
    if (!origin) continue;
    const released = movement.type === 'return' ? Math.max(0, Number(movement.change)) : Number(preparedLossQuantity(movement));
    const sold = movement.type === 'sale' ? -Number(movement.change) : 0;
    if (!released && !sold) continue;
    const routes = routesByLine.get(origin) ?? new Map<string, SaleCost>();
    const route = JSON.stringify([movement.sourceId, movement.ingredientId, movement.warehouseKey, movement.saleCycle]);
    const entry = routes.get(route) ?? { ingredientId: movement.ingredientId, sold: 0, released: 0, cost: 0, unknown: false };
    entry.sold += sold;
    entry.released += released;
    entry.cost += (sold - released) * Number(movement.costAtMoment);
    entry.unknown ||= sold > 0 && !movement.costKnown;
    routes.set(route, entry);
    routesByLine.set(origin, routes);
  }
  return routesByLine;
}

export function activeCostRoutes(routes: Iterable<SaleCost>) {
  return [...routes].filter(({ sold, released }) => sold - released > 0.000_000_1);
}

export function historicalCosts(routesByLine: ReturnType<typeof historicalCostRoutes>) {
  const costs = new Map<string, number | null>();
  for (const [origin, routes] of routesByLine) {
    const active = activeCostRoutes(routes.values());
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
  const itemCosts = new Map<string, { origin: string; share: number; cost: number | null }>();
  if (!showCosts) return itemCosts;
  const originFor = (item: Item) => costs.has(item.id) ? item.id : item.stockSourceLineId ?? item.id;
  const quantityByOrigin = new Map<string, number>();
  for (const item of items) {
    const origin = originFor(item);
    quantityByOrigin.set(origin, (quantityByOrigin.get(origin) ?? 0) + item.quantity);
  }
  for (const item of items) {
    const origin = originFor(item);
    const snapshot = itemSnapshot(item);
    const knownEmpty = snapshot?.consumed === false && Array.isArray(snapshot.warnings) && !snapshot.legacyRecorded;
    const missingParts = Array.isArray(snapshot?.warnings) && snapshot.warnings.length > 0;
    const cost = costs.get(origin);
    const quantity = quantityByOrigin.get(origin) ?? 0;
    const share = quantity ? item.quantity / quantity : 0;
    const allocated = !missingParts && cost != null && quantity ? cost * share
      : !missingParts && !costs.has(origin) && knownEmpty ? 0 : null;
    itemCosts.set(item.id, { origin, share, cost: allocated });
  }
  return itemCosts;
}

function addPayments(report: Payments, order: Order) {
  const confirmed = order.payments.filter(({ status }) => status === 'paid');
  // Older closed checks can have only a method and a check total.
  const payments = order.payments.length ? confirmed : [{ method: order.paymentMethod, amount: order.finalAmount, refundedAmount: order.refundedAmount }];
  for (const payment of payments) {
    const { method } = payment;
    const column = method === 'cash' || method === 'card' || method === 'qr' ? method : 'other';
    report[column] += Number(netPaymentAmount(payment));
  }
}

function taxesForOrder(order: Order) {
  const refunds = new Map<string, Prisma.Decimal>();
  for (const { taxReversals } of order.refunds) {
    for (const { taxId, amount } of taxReversals as RefundTaxReversal[]) {
      refunds.set(taxId, new Prisma.Decimal(refunds.get(taxId) ?? 0).add(amount));
    }
  }
  const byItem = new Map<string, number>();
  let totalTax = new Prisma.Decimal(0);
  let allAttributed = true;
  for (const tax of order.taxes) {
    const amount = tax.amount.sub(refunds.get(tax.taxId) ?? 0);
    if (amount.isZero()) continue;
    totalTax = totalTax.add(amount);
    const saved = tax.itemAmounts;
    // A legacy receipt may only have a check-level tax. Its rate can be attributed
    // to every line only when its recorded base covers the entire receipt.
    const baseById = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : null;
    if (!baseById && (order.taxes.length !== 1 || !tax.salesAmount.eq(order.finalAmount))) {
      allAttributed = false;
      continue;
    }
    const weights = order.items.map((item) => {
      if (!baseById) return netItemAmount(item, item.finalPrice);
      const base = baseById[item.id];
      return netItemAmount(item, typeof base === 'string' || typeof base === 'number' ? base : 0);
    });
    const total = weights.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
    if (total.isZero()) {
      allAttributed = false;
      continue;
    }
    // Allocate the stored tax once so that reporting pennies add up to the receipt.
    let accumulated = new Prisma.Decimal(0);
    let assigned = new Prisma.Decimal(0);
    for (const [index, { id }] of order.items.entries()) {
      accumulated = accumulated.add(weights[index]);
      const through = amount.mul(accumulated).div(total).toDecimalPlaces(2);
      byItem.set(id, (byItem.get(id) ?? 0) + through.sub(assigned).toNumber());
      assigned = through;
    }
  }
  return { total: totalTax.toNumber(), byItem, allAttributed };
}

export function orderProductSales<ItemType extends Item>(order: Omit<Order, 'items'> & { items: ItemType[] }, costs: Map<string, number | null>, showCosts: boolean) {
  const taxes = taxesForOrder(order);
  const itemCosts = costsForOrder(order.items, costs, showCosts);
  // Product sales exclude the service charge retained on legacy receipts.
  const productPayable = Prisma.Decimal.max(0, new Prisma.Decimal(order.finalAmount).sub(order.serviceChargeAmount ?? 0));
  const itemPayables = allocateOrderItemCents(productPayable, order.items);
  return {
    totalTax: taxes.total,
    lines: order.items.map((item, index) => {
      const attribution = itemCosts.get(item.id);
      const quantity = netItemQuantity(item);
      return { item, quantity, gross: Number(item.priceSnapshot) * quantity,
        revenue: Number(netItemAmount(item, itemPayables[index] / 100)),
        tax: taxes.allAttributed ? taxes.byItem.get(item.id) ?? 0 : null,
        cost: attribution?.cost ?? null, costOrigin: attribution?.origin, costShare: attribution?.share ?? 0 };
    }),
  };
}

export function buildStatisticsReports(orders: Order[], movements: Movement[], showCosts: boolean) {
  const sales = new Map<string, Sale>();
  const payments = new Map<string, Payments>();
  const staff = new Map<string, Staff>();
  const categories = new Map<string, Category>();
  const products = new Map<string, Product>();
  const costs = historicalCosts(historicalCostRoutes(movements));

  for (const order of orders) {
    if (!order.closedAt) continue;
    const date = warehouseDay(order.closedAt);
    const sale = sales.get(date) ?? { date, orders: 0, paidAmount: 0, refundedAmount: 0, discount: 0 };
    sale.orders++;
    sale.paidAmount += Number(order.finalAmount);
    sale.refundedAmount += Number(order.refundedAmount ?? 0);
    sale.discount += Number(order.discountAmount);
    sales.set(date, sale);
    const payment = payments.get(date) ?? { date, orders: 0, cash: 0, card: 0, qr: 0, other: 0 };
    payment.orders++;
    addPayments(payment, order);
    payments.set(date, payment);

    const waiterId = order.waiterId ?? 'qr';
    const waiter = order.waiter?.name ?? 'QR-меню';
    const employee = staff.get(waiterId) ?? { id: waiterId, name: waiter, orders: 0, revenue: 0, seconds: 0, cost: 0, tax: 0 };
    const { totalTax, lines } = orderProductSales(order, costs, showCosts);
    employee.orders++;
    employee.revenue += Number(netOrderAmount(order));
    employee.tax += totalTax;
    employee.seconds += Math.max(0, (order.closedAt.getTime() - order.createdAt.getTime()) / 1000);
    if (!order.items.length || !showCosts) employee.cost = null;
    staff.set(waiterId, employee);

    for (const { item, revenue, quantity, gross, cost, tax } of lines) {
      const categoryId = item.dish?.category.id ?? 'uncategorized';
      const category = item.dish?.category.name ?? 'Без категории';
      const categoryRow = categories.get(categoryId) ?? { id: categoryId, name: category, quantity: 0, revenue: 0, cost: 0, tax: 0 };
      const name = item.dishVariantNameSnapshot ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}` : item.dishNameSnapshot;
      const productKey = JSON.stringify([item.dishId, item.dishNameSnapshot, categoryId]);
      const variantKey = JSON.stringify([productKey, item.dishVariantId, item.dishVariantNameSnapshot]);
      const id = JSON.stringify([item.dishId, item.dishVariantId, name, categoryId, waiterId]);
      const product = products.get(id) ?? { id, productKey, variantKey, baseName: item.dishNameSnapshot, name, categoryId, category, waiterId, waiter,
        quantity: 0, gross: 0, discount: 0, revenue: 0, cost: 0, tax: 0 };
      product.quantity += quantity;
      product.gross += gross;
      product.discount += Number(netItemAmount(item, item.discountAmount));
      product.revenue += revenue;
      product.cost = plusCost(product.cost, cost);
      product.tax = plusCost(product.tax, tax);
      products.set(id, product);
      categoryRow.quantity += quantity;
      categoryRow.revenue += revenue;
      categoryRow.cost = plusCost(categoryRow.cost, cost);
      categoryRow.tax = plusCost(categoryRow.tax, tax);
      categories.set(categoryId, categoryRow);
      employee.cost = plusCost(employee.cost, cost);
    }
  }

  return {
    sales: [...sales.values()].sort(byDate).map((row) => {
      const paidAmount = money(row.paidAmount);
      const refundedAmount = money(row.refundedAmount);
      const revenue = money(paidAmount - refundedAmount);
      return { ...row, paidAmount, refundedAmount, revenue, avgCheck: money(revenue / row.orders), discount: money(row.discount) };
    }),
    payments: [...payments.values()].sort(byDate).map((row) => ({ ...row, cash: money(row.cash), card: money(row.card),
      qr: money(row.qr), other: money(row.other), total: money(row.cash + row.card + row.qr + row.other) })),
    staff: [...staff.values()].sort(byRevenue).map(({ tax, cost, seconds, ...row }) => ({ ...row, revenue: money(row.revenue),
      avgCheck: money(row.revenue / row.orders), avgSeconds: Math.round(seconds / row.orders), profit: profit(row.revenue, cost, tax) })),
    products: [...products.values()].sort(byRevenue).map(({ tax, ...row }) => {
      const profitBasis = profitBeforeRounding(row.revenue, row.cost, tax);
      return { ...row, gross: money(row.gross), discount: money(row.discount), revenue: money(row.revenue),
        costBasis: row.cost, cost: row.cost == null ? null : money(row.cost), profitBasis, profit: profitBasis == null ? null : money(profitBasis) };
    }),
    categories: [...categories.values()].sort(byRevenue).map((row) => ({ ...row, revenue: money(row.revenue),
      tax: row.tax == null ? null : money(row.tax), cost: row.cost == null ? null : money(row.cost),
      profit: profit(row.revenue, row.cost, row.tax) })),
  };
}
