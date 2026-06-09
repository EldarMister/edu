import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import tts from '@/services/ttsService';
import type { Order } from '@/types';

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
    beep('newOrder');
    const orderNumber = displayOrderNumber(order.orderNumber);
    tts.speak('Новый заказ.');
    push({
      message: `Новый заказ ${orderNumber} · Стол ${order.table?.number}`,
      orderId: order.id,
      orderNumber,
      at: new Date().toISOString(),
    });
  });

  useSocketEvent<Order>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    invalidate();
    if (order.status === 'cancelled' || order.status === 'rejected') {
      const orderNumber = displayOrderNumber(order.orderNumber).replace(/^№\s*/, '');
      tts.speakUrgent(`Внимание! Отмена заказа. Заказ номер ${orderNumber}.`);
    }
  });
}
