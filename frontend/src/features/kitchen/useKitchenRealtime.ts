import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import tts from '@/services/ttsService';
import type { Order } from '@/types';

/**
 * Задержка перед голосом (мс) — даём звуку уведомления прозвучать первым.
 * new-order.mp3 ≈ 47 КБ ≈ ~1 сек; берём 900 мс чтобы не было долгой паузы.
 */
const VOICE_DELAY_MS = 900;

/** Подписки кухни: новый заказ — звук + тост, любые изменения — обновление списков. */
export function useKitchenRealtime() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kitchen'] });

  useSocketEvent<Order>('kitchen:new_order', (order) => {
    qc.setQueryData<Order[]>(['kitchen', 'new'], (current = []) => {
      if (current.some((item) => item.id === order.id)) return current;
      return [order, ...current];
    });
    invalidate();

    // 1. Сначала — звук уведомления
    beep('newOrder');

    // 2. Тост
    const orderNumber = displayOrderNumber(order.orderNumber);
    push({
      message: `Новый заказ ${orderNumber} · Стол ${order.table?.number}`,
      orderId: order.id,
      orderNumber,
      at: new Date().toISOString(),
    });

    // 3. Голос — ПОСЛЕ звука уведомления
    tts.speakAfterDelay('Новый заказ.', VOICE_DELAY_MS);
  });

  useSocketEvent<Order>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    invalidate();

    if (order.status === 'cancelled' || order.status === 'rejected') {
      const orderNumber = displayOrderNumber(order.orderNumber).replace(/^№\s*/, '');

      // Срочный звук + голос после него
      beep('notify');
      tts.speakUrgentAfterDelay(
        `Внимание! Отмена заказа. Заказ номер ${orderNumber}.`,
        VOICE_DELAY_MS,
      );
    }
  });
}
