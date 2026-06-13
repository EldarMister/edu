import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import { kitchenVoice } from '@/services/kitchenVoice';
import type { Order, PrepStation } from '@/types';

/** Заказ из сокета может нести готовый текст озвучки (формирует backend). */
type VoicedOrder = Order & {
  voice?: {
    text?: string | null;
    byStation?: Partial<Record<Exclude<PrepStation, 'none'>, string | null>>;
  } | null;
};

function stationVoice(order: VoicedOrder, station: PrepStation): string | null {
  if (station === 'none') return null;
  return order.voice?.byStation?.[station] ?? order.voice?.text ?? null;
}

/** Подписки кухни: новый заказ — звук + тост + озвучка, любые изменения — обновление списков. */
export function useKitchenRealtime(station: PrepStation = 'kitchen') {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kitchen'] });

  useSocketEvent<VoicedOrder>('kitchen:new_order', (order) => {
    // Список тянем заново с сервера — он отфильтрует позиции по станции экрана.
    invalidate();
    const text = stationVoice(order, station);
    if (!text) return;

    // 1. Звук уведомления.
    beep('newOrder');

    // 2. Тост.
    const orderNumber = displayOrderNumber(order.orderNumber);
    push({
      message: `Новый заказ ${orderNumber} · Стол ${order.table?.number}`,
      orderId: order.id,
      orderNumber,
      at: new Date().toISOString(),
    });

    // 3. Озвучка — текст уже сформирован backend для конкретной станции.
    kitchenVoice.enqueue(text);
  });

  useSocketEvent<VoicedOrder>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    invalidate();

    // Backend добавляет voice.text только для полной отмены/отказа — озвучиваем.
    const text = stationVoice(order, station);
    if (text) {
      beep('notify');
      kitchenVoice.enqueue(text);
    }
  });

  // Админ изменил меню/категории/сеты или стоп-лист — кухня и бар обновляют экраны без перезахода.
  useSocketEvent('menu:updated', () => {
    qc.invalidateQueries({ queryKey: ['kitchen'] });
    qc.invalidateQueries({ queryKey: ['kitchen', 'stop-list'] });
  });
}
