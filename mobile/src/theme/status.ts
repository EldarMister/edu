import type { Order, OrderItem, OrderItemStatus, OrderStatus, TableStatus } from '@/types';
import { colors } from './index';

export interface StatusMeta {
  label: string;
  /** Цвет фона бейджа. */
  bg: string;
  /** Цвет текста бейджа. */
  fg: string;
  /** Цвет точки статуса (для столов/легенды). */
  dot: string;
}

// Зеркало frontend/src/lib/status.ts (цвета статусов по ТЗ §4.2).
export const TABLE_STATUS: Record<TableStatus, StatusMeta> = {
  free: { label: 'Свободен', bg: colors.successSoft, fg: colors.success, dot: colors.success },
  occupied: { label: 'Занят', bg: colors.warningSoft, fg: colors.warning, dot: colors.warning },
  sent_to_kitchen: { label: 'На кухне', bg: colors.orange100, fg: colors.orange600, dot: colors.orange500 },
  accepted: { label: 'Готовится', bg: colors.orange100, fg: colors.orange600, dot: colors.orange500 },
  cooking: { label: 'Готовится', bg: colors.orange100, fg: colors.orange600, dot: colors.orange500 },
  ready: { label: 'Готов', bg: colors.primarySoft, fg: colors.primary, dot: colors.primary },
  served: { label: 'Подан', bg: colors.purple100, fg: colors.purple600, dot: colors.purple500 },
  waiting_payment: { label: 'Оплата', bg: colors.pink100, fg: colors.pink600, dot: colors.pink500 },
  paid: { label: 'Оплачен', bg: colors.slate100, fg: colors.textMuted, dot: colors.textLight },
};

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  draft: { label: 'Черновик', bg: colors.slate100, fg: colors.textMuted, dot: colors.textLight },
  sent_to_kitchen: { label: 'Отправлен на кухню', bg: colors.warningSoft, fg: colors.warning, dot: colors.warning },
  accepted_by_kitchen: { label: 'Принят кухней', bg: colors.orange100, fg: colors.orange600, dot: colors.orange500 },
  cooking: { label: 'Готовится', bg: colors.orange100, fg: colors.orange600, dot: colors.orange500 },
  ready: { label: 'Готов', bg: colors.primary, fg: colors.white, dot: colors.primary },
  picked_up: { label: 'Забран', bg: colors.primarySoft, fg: colors.primary, dot: colors.primary },
  served: { label: 'Подан гостям', bg: colors.warningSoft, fg: colors.warning, dot: colors.warning },
  waiting_payment: { label: 'Ожидает оплаты', bg: colors.purple100, fg: colors.purple600, dot: colors.purple500 },
  paid: { label: 'Оплачен', bg: colors.successSoft, fg: colors.success, dot: colors.success },
  rejected: { label: 'Отказан', bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
  partially_rejected: { label: 'Частичный отказ', bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
  cancelled: { label: 'Отменён', bg: colors.slate100, fg: colors.textMuted, dot: colors.textLight },
};

type Station = 'kitchen' | 'bar';

const STATION_LABEL: Record<Station, string> = { kitchen: 'Кухня', bar: 'Бар' };

const STATION_ITEM_STATUS: Partial<Record<OrderItemStatus, StatusMeta>> = {
  new: { label: 'Отправлен', bg: colors.warningSoft, fg: colors.warning, dot: colors.warning },
  accepted: { label: 'Принят', bg: colors.orange100, fg: colors.orange600, dot: colors.orange500 },
  cooking: { label: 'Готовится', bg: colors.orange100, fg: colors.orange600, dot: colors.orange500 },
  ready: { label: 'Готов', bg: colors.primarySoft, fg: colors.primary, dot: colors.primary },
  served: { label: 'Подан', bg: colors.purple100, fg: colors.purple600, dot: colors.purple500 },
};

function aggregateStationStatus(items: OrderItem[]): OrderItemStatus | null {
  const active = items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');
  if (active.length === 0) return null;
  const statuses = new Set(active.map((item) => item.status));
  if (statuses.has('cooking')) return 'cooking';
  if (statuses.has('accepted')) return 'accepted';
  if (statuses.has('new')) return 'new';
  if (statuses.has('ready')) return 'ready';
  if (statuses.has('served')) return 'served';
  return null;
}

export interface StationStatusChip {
  station: Station;
  stationLabel: string;
  label: string;
  bg: string;
  fg: string;
}

export function orderStationStatuses(order: Pick<Order, 'items' | 'status'>): StationStatusChip[] {
  if (['paid', 'cancelled', 'rejected', 'waiting_payment'].includes(order.status)) return [];

  const kitchen = aggregateStationStatus(order.items.filter((item) => item.prepStation === 'kitchen'));
  const bar = aggregateStationStatus(order.items.filter((item) => item.prepStation === 'bar'));
  if (!kitchen || !bar || kitchen === bar) return [];

  const chips: StationStatusChip[] = [];
  for (const [station, status] of [['kitchen', kitchen], ['bar', bar]] as [Station, OrderItemStatus][]) {
    const meta = STATION_ITEM_STATUS[status];
    if (!meta) return [];
    chips.push({ station, stationLabel: STATION_LABEL[station], label: meta.label, bg: meta.bg, fg: meta.fg });
  }
  return chips;
}

export const REJECT_REASONS = [
  'Нет ингредиентов',
  'Блюдо временно недоступно',
  'Большая загруженность',
  'Ошибка в заказе',
  'Другая причина',
];
