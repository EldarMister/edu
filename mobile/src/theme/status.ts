import type { OrderStatus, TableStatus } from '@/types';
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

export const REJECT_REASONS = [
  'Нет ингредиентов',
  'Блюдо временно недоступно',
  'Большая загруженность',
  'Ошибка в заказе',
  'Другая причина',
];
