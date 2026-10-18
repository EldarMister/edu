import type { Order, OrderStatus } from '@/types';
import { hallSuffix } from '@/utils/format';

const CANCELLABLE: OrderStatus[] = [
  'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'partially_rejected',
];
const PRELIMINARY: OrderStatus[] = [
  'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready',
  'picked_up', 'served', 'partially_rejected', 'waiting_payment',
];

export function canWaiterCancelOrder(order: Order): boolean {
  return CANCELLABLE.includes(order.status);
}

export function canRequestPreliminaryBill(order: Order): boolean {
  return !!order.waiter && !order.requiresWaiterDecision && PRELIMINARY.includes(order.status);
}

/** Доставка использует общий скрытый стол 0; идентичность заказа задаёт его id. */
export function orderLocation(order: Order): string {
  return order.source === 'delivery'
    ? `Доставка${order.externalOrderId ? ` · ${order.externalOrderId}` : ''}`
    : `Стол ${order.table.number}${hallSuffix(order.table)}`;
}

export function deliveryDetails(order: Order): string | null {
  if (order.source !== 'delivery') return null;
  return [order.deliveryCustomerName, order.deliveryCustomerPhone, order.deliveryAddress]
    .filter(Boolean).join(' · ') || null;
}
