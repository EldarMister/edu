import type { QueryClient } from '@tanstack/react-query';
import type { Order, OrderStatus } from '@/types';

const WAITER_ACTIVE = new Set<OrderStatus>([
  'draft',
  'sent_to_kitchen',
  'accepted_by_kitchen',
  'cooking',
  'ready',
  'picked_up',
  'served',
  'waiting_payment',
  'rejected',
  'partially_rejected',
]);

function upsertOrder(list: Order[] | undefined, order: Order) {
  if (!list) return list;
  const exists = list.some((item) => item.id === order.id);
  if (!exists) return [order, ...list];
  return list.map((item) => (item.id === order.id ? order : item));
}

function removeOrder(list: Order[] | undefined, orderId: string) {
  return list?.filter((item) => item.id !== orderId);
}

export function applyOrderStatusToCache(qc: QueryClient, order: Order) {
  qc.setQueryData<Order[]>(['orders', 'active'], (current) =>
    WAITER_ACTIVE.has(order.status) ? upsertOrder(current, order) : removeOrder(current, order.id),
  );
}
