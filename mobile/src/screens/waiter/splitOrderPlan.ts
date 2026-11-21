import type { Order } from '@/types';

type Line = Order['items'][number];
export type SplitOrderLine = { itemId: string; quantity: number };

export function splitOrderItems(order: Order) {
  return order.items.filter((item) => item.status !== 'cancelled' && item.status !== 'rejected');
}

export function splitItemCanChangeQuantity(item: Line) {
  return item.quantity > 1 && !item.weightGrams;
}

export function canSplitOrder(order: Order) {
  const items = splitOrderItems(order);
  return Boolean(order.updatedAt && order.source !== 'delivery' && (order.source !== 'qr' || order.waiter)
    && (order.status === 'served' || order.status === 'waiting_payment')
    && !order.requiresWaiterDecision && (!order.paymentStatus || order.paymentStatus === 'pending')
    && items.every((item) => item.status === 'served')
    && (items.length > 1 || items.some(splitItemCanChangeQuantity)));
}

export function splitOrderLines(items: Line[], selected: Record<string, string>) {
  const lines: SplitOrderLine[] = [];
  let hasRemainder = false;
  for (const item of items) {
    const value = selected[item.id];
    if (value === undefined) {
      hasRemainder = true;
      continue;
    }
    if (!/^\d+$/.test(value)) return { lines: [], keepsSource: true };
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > item.quantity
      || (quantity !== item.quantity && !splitItemCanChangeQuantity(item))) {
      return { lines: [], keepsSource: true };
    }
    if (quantity < item.quantity) hasRemainder = true;
    lines.push({ itemId: item.id, quantity });
  }
  return { lines, keepsSource: hasRemainder };
}

export function orderCheckFamily(order: Order, activeOrders: Order[]) {
  const familyId = order.splitFromOrderId ?? order.id;
  return activeOrders.filter((candidate) => (candidate.splitFromOrderId ?? candidate.id) === familyId
    && candidate.waiter?.id === order.waiter?.id && candidate.table.id === order.table.id
    && !['paid', 'cancelled', 'rejected'].includes(candidate.status));
}
