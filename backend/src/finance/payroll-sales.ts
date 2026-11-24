import { OrderItemStatus, OrderRefundStatus, Prisma } from '@prisma/client';
import { allocateCents, allocateOrderItemCents, netOrderAmount } from '../orders/order-net';

export type CategoryCommission = { categoryId: string; personalPercent?: number; shiftPercent?: number };
export type CommissionKind = 'personalPercent' | 'shiftPercent';

export const payrollOrderSelect = {
  id: true, orderNumber: true, closedAt: true, waiterId: true, payrollOpenedById: true, finalAmount: true, refundedAmount: true,
  items: {
    where: { status: { notIn: [OrderItemStatus.cancelled, OrderItemStatus.rejected] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, finalPrice: true, quantity: true, payrollCategoryId: true },
  },
  refunds: {
    where: { status: OrderRefundStatus.approved },
    select: { items: true },
  },
} satisfies Prisma.OrderSelect;

const zero = new Prisma.Decimal(0);

export function categoryCommissions(value?: Prisma.JsonValue | Prisma.InputJsonArray): CategoryCommission[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const { categoryId, personalPercent, shiftPercent } = entry as Record<string, unknown>;
    if (typeof categoryId !== 'string') return [];
    return [{
      categoryId,
      ...(typeof personalPercent === 'number' ? { personalPercent } : {}),
      ...(typeof shiftPercent === 'number' ? { shiftPercent } : {}),
    }];
  });
}

export function payrollSale(order: Prisma.OrderGetPayload<{ select: typeof payrollOrderSelect }>) {
  const amount = netOrderAmount(order);
  const categories = new Map<string | null, Prisma.Decimal>();
  const items = order.items ?? [];
  if (amount.gt(0) && items.length && items.some((item) => item.payrollCategoryId)) {
    const netCents = amount.mul(100).toNumber();
    const originalCents = allocateOrderItemCents(order.finalAmount, items);
    const itemRefunds = new Map<string, number>();
    for (const refund of order.refunds ?? []) {
      if (!Array.isArray(refund.items)) continue;
      for (const line of refund.items) {
        if (!line || typeof line !== 'object' || Array.isArray(line)) continue;
        if (typeof line.itemId !== 'string' || (typeof line.amount !== 'string' && typeof line.amount !== 'number')) continue;
        itemRefunds.set(line.itemId, (itemRefunds.get(line.itemId) ?? 0) + new Prisma.Decimal(line.amount).mul(100).round().toNumber());
      }
    }
    const remaining = items.map((item, index) => Math.max(0, originalCents[index] - (itemRefunds.get(item.id) ?? 0)));
    const remainingTotal = remaining.reduce((sum, item) => sum + item, 0);
    const values = remainingTotal === netCents ? remaining : allocateCents(netCents, remainingTotal ? remaining : originalCents);
    for (const [index, item] of items.entries()) {
      const category = item.payrollCategoryId;
      categories.set(category, (categories.get(category) ?? zero).add(new Prisma.Decimal(values[index]).div(100)));
    }
    const distributed = [...categories.values()].reduce((sum, value) => sum.add(value), zero);
    if (!distributed.eq(amount)) categories.set(null, (categories.get(null) ?? zero).add(amount.sub(distributed)));
  } else {
    categories.set(null, amount);
  }
  return {
    id: order.id, number: order.orderNumber, at: order.closedAt!.getTime(),
    openerId: order.payrollOpenedById ?? order.waiterId, openerRecorded: !!order.payrollOpenedById,
    amount, categories,
  };
}

export type PayrollSale = ReturnType<typeof payrollSale>;

export function salesBetween(sales: PayrollSale[], start: number, end: number) {
  function before(time: number) {
    let left = 0;
    let right = sales.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (sales[mid].at < time) left = mid + 1;
      else right = mid;
    }
    return left;
  }
  return sales.slice(before(start), before(end));
}

export function salesCommission(
  sale: PayrollSale, kind: CommissionKind, defaultPercent: number, rates: Map<string, CategoryCommission>,
) {
  return [...sale.categories].map(([categoryId, base]) => {
    const percent = (categoryId ? rates.get(categoryId)?.[kind] : undefined) ?? defaultPercent;
    return { categoryId, base, percent, amount: base.mul(percent).div(100) };
  });
}
