import { waiterOrderPermission, type WaiterOrderPermissions } from '@/lib/order-permissions';
import type { Order, OrderStatus } from '@/types';
import { hallSuffix } from '@/utils/format';

export const ORDER_TYPES = [
  { value: 'dine_in', label: 'В зале' },
  { value: 'delivery', label: 'Доставка' },
  { value: 'pickup', label: 'Самовывоз' },
] as const;
export type OrderType = typeof ORDER_TYPES[number]['value'];
export type TerminalOrderType = Exclude<OrderType, 'pickup'>;
export const TERMINAL_ORDER_TYPES = ORDER_TYPES.filter(
  (item): item is Exclude<typeof ORDER_TYPES[number], { value: 'pickup' }> => item.value !== 'pickup',
);
export const orderTypeLabel = (type: OrderType) => ORDER_TYPES.find(({ value }) => value === type)!.label;
export const isOffsite = (source?: string): source is 'delivery' | 'pickup' => source === 'delivery' || source === 'pickup';
export const orderType = (source?: string): OrderType => isOffsite(source) ? source : 'dine_in';

const PRELIMINARY: OrderStatus[] = [
  'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready',
  'picked_up', 'served', 'partially_rejected', 'waiting_payment',
];

export function canWaiterCancelOrder(order: Order, policies?: WaiterOrderPermissions): boolean {
  return waiterOrderPermission(order, 'cancel', policies).allowed;
}

export function canRequestPreliminaryBill(order: Order): boolean {
  return !!order.waiter && !order.requiresWaiterDecision && PRELIMINARY.includes(order.status);
}

/** Доставка использует общий скрытый стол 0; идентичность заказа задаёт его id. */
export function orderLocation(order: Order): string {
  return isOffsite(order.source)
    ? `${orderTypeLabel(orderType(order.source))}${order.externalOrderId ? ` · ${order.externalOrderId}` : ''}`
    : `Стол ${order.table.number}${hallSuffix(order.table)}`;
}

export function deliveryDetails(order: Order): string | null {
  if (!isOffsite(order.source)) return null;
  return [order.deliveryCustomerName, order.deliveryCustomerPhone, order.deliveryAddress, order.pickupTime]
    .filter(Boolean).join(' · ') || null;
}
