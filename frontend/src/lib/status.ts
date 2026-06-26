import type { Order, OrderItem, OrderItemStatus, TableStatus, OrderStatus } from '@/types';

interface StatusMeta {
  label: string;
  /** tailwind-классы для бейджа */
  badge: string;
  /** цвет точки/заливки стола */
  dot: string;
}

// Цвета статусов по ТЗ §4.2: свободен — зелёный, занят — жёлтый,
// готовится — оранжевый, готов — синий, отказ — красный, оплачен — серый.
export const TABLE_STATUS: Record<TableStatus, StatusMeta> = {
  free: { label: 'Свободен', badge: 'bg-success/10 text-success', dot: 'bg-success' },
  occupied: { label: 'Занят', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  sent_to_kitchen: { label: 'На кухне', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  accepted: { label: 'Готовится', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  cooking: { label: 'Готовится', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  ready: { label: 'Готов', badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  served: { label: 'Подан', badge: 'bg-purple-100 text-purple-600', dot: 'bg-purple-500' },
  waiting_payment: { label: 'Оплата', badge: 'bg-pink-100 text-pink-600', dot: 'bg-pink-500' },
  paid: { label: 'Оплачен', badge: 'bg-slate-100 text-text-muted', dot: 'bg-text-light' },
};

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  draft: { label: 'Черновик', badge: 'bg-slate-100 text-text-muted', dot: 'bg-text-light' },
  sent_to_kitchen: { label: 'Отправлен на кухню', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  accepted_by_kitchen: { label: 'Принят кухней', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  cooking: { label: 'Готовится', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  ready: { label: 'Готов', badge: 'bg-primary text-white', dot: 'bg-primary' },
  picked_up: { label: 'Забран', badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  served: { label: 'Подан гостям', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  waiting_payment: { label: 'Ожидает оплаты', badge: 'bg-purple-100 text-purple-600', dot: 'bg-purple-500' },
  paid: { label: 'Оплачен', badge: 'bg-success/10 text-success', dot: 'bg-success' },
  rejected: { label: 'Отказан', badge: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  partially_rejected: { label: 'Частичный отказ', badge: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  cancelled: { label: 'Отменён', badge: 'bg-slate-100 text-text-muted', dot: 'bg-text-light' },
};

// ---- Статусы по станциям (кухня / бар) -------------------------------------
// Глобальный статус заказа один на всех, поэтому он не может одновременно
// показать «кухня готовит» и «бар только отправлен». Когда позиции заказа живут
// сразу на двух станциях в разных состояниях, считаем агрегатный статус по
// каждой станции отдельно и показываем парой бейджей.

type Station = 'kitchen' | 'bar';

const STATION_LABEL: Record<Station, string> = { kitchen: 'Кухня', bar: 'Бар' };

// Подпись/цвет агрегатного статуса станции. «new» для станции — это «отправлен»
// (официант отправил, станция ещё не приняла).
const STATION_ITEM_STATUS: Partial<Record<OrderItemStatus, StatusMeta>> = {
  new: { label: 'Отправлен', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  accepted: { label: 'Принят', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  cooking: { label: 'Готовится', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  ready: { label: 'Готов', badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  served: { label: 'Подан', badge: 'bg-purple-100 text-purple-600', dot: 'bg-purple-500' },
};

/** Агрегатный статус позиций одной станции (как statusFromActiveItems на бэке). */
function aggregateStationStatus(items: OrderItem[]): OrderItemStatus | null {
  const active = items.filter((i) => i.status !== 'rejected' && i.status !== 'cancelled');
  if (active.length === 0) return null;
  const set = new Set(active.map((i) => i.status));
  if (set.has('cooking')) return 'cooking';
  if (set.has('accepted')) return 'accepted';
  if (set.has('new')) return 'new';
  if (set.has('ready')) return 'ready';
  if (set.has('served')) return 'served';
  return null;
}

export interface StationStatusChip {
  station: Station;
  stationLabel: string;
  label: string;
  badge: string;
}

/**
 * Чипы статусов по станциям. Возвращает их только когда у заказа есть активные
 * позиции сразу на двух станциях (кухня И бар) — именно в этом случае один
 * глобальный статус вводит в заблуждение. Если активна одна станция, глобального
 * бейджа достаточно — возвращаем пустой массив.
 */
export function orderStationStatuses(order: Pick<Order, 'items'>): StationStatusChip[] {
  const chips: StationStatusChip[] = [];
  for (const station of ['kitchen', 'bar'] as Station[]) {
    const agg = aggregateStationStatus(order.items.filter((i) => i.prepStation === station));
    const meta = agg ? STATION_ITEM_STATUS[agg] : undefined;
    if (!meta) continue;
    chips.push({ station, stationLabel: STATION_LABEL[station], label: meta.label, badge: meta.badge });
  }
  return chips.length >= 2 ? chips : [];
}

export const REJECT_REASONS = [
  'Нет ингредиентов',
  'Блюдо временно недоступно',
  'Большая загруженность',
  'Ошибка в заказе',
  'Другая причина',
];
