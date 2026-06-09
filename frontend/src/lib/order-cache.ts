import type { QueryClient } from '@tanstack/react-query';
import type { Order, OrderStatus } from '@/types';

type OrdersPageData = {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

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

const ADMIN_ACTIVE = new Set<OrderStatus>([
  'draft',
  'sent_to_kitchen',
  'accepted_by_kitchen',
  'cooking',
  'ready',
  'picked_up',
  'served',
  'waiting_payment',
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

function adminTabMatches(tab: unknown, status: OrderStatus) {
  if (tab === 'active') return ADMIN_ACTIVE.has(status);
  if (tab === 'paid') return status === 'paid';
  if (tab === 'cancelled') return status === 'cancelled' || status === 'rejected';
  return true;
}

export function applyOrderStatusToCache(qc: QueryClient, order: Order) {
  qc.setQueryData<Order[]>(['orders', 'active'], (current) =>
    WAITER_ACTIVE.has(order.status) ? upsertOrder(current, order) : removeOrder(current, order.id),
  );

  // Кухня/бар обновляются через invalidate (сервер фильтрует позиции по станции).

  qc.getQueryCache().findAll({ queryKey: ['admin', 'orders', 'list'] }).forEach((query) => {
    qc.setQueryData<OrdersPageData>(query.queryKey, (current) => {
      if (!current) return current;
      const params = query.queryKey[3] as { tab?: unknown } | undefined;
      const matches = adminTabMatches(params?.tab, order.status);
      const hadOrder = current.items.some((item) => item.id === order.id);
      const items = matches ? upsertOrder(current.items, order) ?? [] : removeOrder(current.items, order.id) ?? [];
      const total =
        matches && !hadOrder
          ? current.total + 1
          : !matches && hadOrder
            ? Math.max(0, current.total - 1)
            : current.total;
      return { ...current, items, total };
    });
  });
}
