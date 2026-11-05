import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderItemStatus, OrderStatus } from '@prisma/client';

export const WAITER_ORDER_STAGES = ['draft', 'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready', 'picked_up', 'served', 'waiting_payment'] as const;
export type WaiterOrderStage = typeof WAITER_ORDER_STAGES[number];
export type WaiterOrderPermissions = Record<WaiterOrderStage, { cancel: boolean; edit: boolean }>;
export const STAGE_LABELS: Record<WaiterOrderStage, string> = {
  draft: 'заказ создан', sent_to_kitchen: 'блюдо отправлено на кухню', accepted_by_kitchen: 'блюдо принято поваром',
  cooking: 'блюдо уже готовится', ready: 'блюдо готово', picked_up: 'блюдо забрано с кухни', served: 'блюдо подано', waiting_payment: 'заказ ожидает оплаты',
};

export function normalizeWaiterOrderPermissions(value: unknown): WaiterOrderPermissions {
  const source = value && typeof value === 'object' ? value as Record<string, any> : {};
  return Object.fromEntries(WAITER_ORDER_STAGES.map((stage, i) => [stage, {
    cancel: typeof source[stage]?.cancel === 'boolean' ? source[stage].cancel : i < 4,
    edit: typeof source[stage]?.edit === 'boolean' ? source[stage].edit : i < 4,
  }])) as WaiterOrderPermissions;
}

export function validateWaiterOrderPermissions(value: unknown): WaiterOrderPermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Некорректные права официантов');
  const entries = Object.entries(value);
  if (entries.length !== WAITER_ORDER_STAGES.length || entries.some(([stage, rule]) =>
    !WAITER_ORDER_STAGES.includes(stage as WaiterOrderStage) || !rule || typeof rule !== 'object' || Array.isArray(rule) ||
    Object.keys(rule).some(key => key !== 'cancel' && key !== 'edit') || typeof rule.cancel !== 'boolean' || typeof rule.edit !== 'boolean')) {
    throw new BadRequestException('Укажите отдельные разрешения отмены и редактирования для каждого этапа');
  }
  return normalizeWaiterOrderPermissions(value);
}

export function waiterItemStage(orderStatus: OrderStatus, itemStatus: OrderItemStatus): WaiterOrderStage {
  if (orderStatus === OrderStatus.waiting_payment) return 'waiting_payment';
  if (orderStatus === OrderStatus.draft) return 'draft';
  if (orderStatus === OrderStatus.picked_up && (itemStatus === OrderItemStatus.ready || itemStatus === OrderItemStatus.served)) return 'picked_up';
  switch (itemStatus) {
    case OrderItemStatus.accepted: return 'accepted_by_kitchen';
    case OrderItemStatus.cooking: return 'cooking';
    case OrderItemStatus.ready: return 'ready';
    case OrderItemStatus.served: return 'served';
    default: return 'sent_to_kitchen';
  }
}

export function assertWaiterItemOperation(policy: WaiterOrderPermissions, orderStatus: OrderStatus, item: { status: OrderItemStatus; dishNameSnapshot?: string }, operation: 'cancel' | 'edit') {
  const stage = waiterItemStage(orderStatus, item.status);
  if (!policy[stage][operation]) throw new ForbiddenException(`${operation === 'cancel' ? 'Отмена запрещена' : 'Редактирование запрещено'}: ${STAGE_LABELS[stage]}${item.dishNameSnapshot ? ` («${item.dishNameSnapshot}»)` : ''}`);
}

export function aggregateOrderStatus(items: { status: OrderItemStatus }[]): OrderStatus {
  const active = items.filter(i => i.status !== OrderItemStatus.cancelled && i.status !== OrderItemStatus.rejected);
  if (!active.length) return items.some(i => i.status === OrderItemStatus.cancelled) ? OrderStatus.cancelled : OrderStatus.rejected;
  const done = active.filter(i => i.status === OrderItemStatus.ready || i.status === OrderItemStatus.served).length;
  if (active.every(i => i.status === OrderItemStatus.served)) return OrderStatus.served;
  if (done === active.length) return OrderStatus.ready;
  if (active.some(i => i.status === OrderItemStatus.cooking)) return OrderStatus.cooking;
  if (active.some(i => i.status === OrderItemStatus.accepted)) return OrderStatus.accepted_by_kitchen;
  return OrderStatus.sent_to_kitchen;
}
