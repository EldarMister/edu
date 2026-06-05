import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import type { Order } from '@/types';

/** Подписки кухни: новый заказ — звук + тост, любые изменения — обновление списков. */
export function useKitchenRealtime() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kitchen'] });

  useSocketEvent<Order>('kitchen:new_order', (order) => {
    invalidate();
    beep('newOrder');
    const orderNumber = displayOrderNumber(order.orderNumber);
    push({
      message: `Новый заказ ${orderNumber} · Стол ${order.table?.number}`,
      orderId: order.id,
      orderNumber,
      at: new Date().toISOString(),
    });
  });

  useSocketEvent('order:status_changed', invalidate);
}
