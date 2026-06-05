import type { OrderStatus, TableStatus } from '@/types';

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
  sent_to_kitchen: { label: 'На кухне', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  accepted: { label: 'Готовится', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  cooking: { label: 'Готовится', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  ready: { label: 'Готов', badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  served: { label: 'Подан', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  waiting_payment: { label: 'Оплата', badge: 'bg-purple-100 text-purple-600', dot: 'bg-purple-500' },
  paid: { label: 'Оплачен', badge: 'bg-slate-100 text-text-muted', dot: 'bg-text-light' },
};

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  draft: { label: 'Черновик', badge: 'bg-slate-100 text-text-muted', dot: 'bg-text-light' },
  sent_to_kitchen: { label: 'Отправлен на кухню', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  accepted_by_kitchen: { label: 'Принят кухней', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  cooking: { label: 'Готовится', badge: 'bg-orange-100 text-orange-600', dot: 'bg-orange-500' },
  ready: { label: 'Готов', badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  picked_up: { label: 'Забран', badge: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  served: { label: 'Подан гостям', badge: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  waiting_payment: { label: 'Ожидает оплаты', badge: 'bg-purple-100 text-purple-600', dot: 'bg-purple-500' },
  paid: { label: 'Оплачен', badge: 'bg-slate-100 text-text-muted', dot: 'bg-text-light' },
  rejected: { label: 'Отказан', badge: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  partially_rejected: { label: 'Частичный отказ', badge: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  cancelled: { label: 'Отменён', badge: 'bg-slate-100 text-text-muted', dot: 'bg-text-light' },
};

export const REJECT_REASONS = [
  'Нет ингредиентов',
  'Блюдо временно недоступно',
  'Большая загруженность',
  'Ошибка в заказе',
  'Другая причина',
];
