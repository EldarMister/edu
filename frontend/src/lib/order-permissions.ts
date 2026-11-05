import type { Order, OrderItem } from '@/types';

export const ORDER_PERMISSION_STAGES = [
  ['draft', 'Черновик'], ['sent_to_kitchen', 'Отправлен на кухню'],
  ['accepted_by_kitchen', 'Принят кухней'], ['cooking', 'Готовится'],
  ['ready', 'Готов'], ['picked_up', 'Забран'], ['served', 'Подан гостям'],
  ['waiting_payment', 'Ожидает оплаты'],
] as const;
export type PermissionStage = typeof ORDER_PERMISSION_STAGES[number][0];
export type WaiterOrderPermissions = Record<PermissionStage, { cancel: boolean; edit: boolean }>;
export const DEFAULT_WAITER_PERMISSIONS = Object.fromEntries(ORDER_PERMISSION_STAGES.map(([stage], index) =>
  [stage, { cancel: index < 4, edit: index < 4 }],
)) as WaiterOrderPermissions;

export function itemPermissionStage(order: Order, item: OrderItem): PermissionStage {
  if (order.status === 'waiting_payment') return 'waiting_payment';
  if (order.status === 'draft') return 'draft';
  if ((item.status === 'ready' || item.status === 'served') &&
      order.status === 'picked_up') return order.status;
  if (item.status === 'new') return 'sent_to_kitchen';
  if (item.status === 'accepted') return 'accepted_by_kitchen';
  if (item.status === 'cooking' || item.status === 'ready' || item.status === 'served') return item.status;
  return 'sent_to_kitchen';
}

export function waiterItemPermission(order: Order, item: OrderItem, action: 'cancel' | 'edit', policies?: WaiterOrderPermissions) {
  if (order.status === 'paid' || order.payments?.some((p) => Number(p.amount) > 0)) {
    return { allowed: false, reason: 'Сначала выполните отмену оплаты / возврат через администратора.' };
  }
  if (['cancelled', 'rejected'].includes(order.status) || ['cancelled', 'rejected'].includes(item.status)) {
    return { allowed: false, reason: 'Позиция уже завершена.' };
  }
  const stage = itemPermissionStage(order, item);
  const allowed = (policies ?? DEFAULT_WAITER_PERMISSIONS)[stage]?.[action] ?? false;
  const label = ORDER_PERMISSION_STAGES.find(([key]) => key === stage)?.[1];
  return { allowed, reason: allowed ? '' : `${action === 'cancel' ? 'Отмена запрещена' : 'Редактирование запрещено'}: этап «${label}».` };
}

export function waiterOrderPermission(order: Order, action: 'cancel' | 'edit', policies?: WaiterOrderPermissions) {
  const items = order.items.filter((item) => !['cancelled', 'rejected'].includes(item.status));
  const results = items.map((item) => waiterItemPermission(order, item, action, policies));
  const allowed = results.length > 0 && (action === 'cancel' ? results.every((p) => p.allowed) : results.some((p) => p.allowed));
  return { allowed, reason: allowed ? '' : results.find((p) => !p.allowed)?.reason ?? 'Нет действующих позиций.' };
}
