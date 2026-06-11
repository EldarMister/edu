import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import { kitchenVoice } from '@/services/kitchenVoice';
import type { Order } from '@/types';

/** Заказ из сокета может нести готовый текст озвучки (формирует backend). */
type VoicedOrder = Order & { voice?: { text?: string } | null };

/** Подписки кухни: новый заказ — звук + тост + озвучка, любые изменения — обновление списков. */
export function useKitchenRealtime() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kitchen'] });

  useSocketEvent<VoicedOrder>('kitchen:new_order', (order) => {
    // Список тянем заново с сервера — он отфильтрует позиции по станции экрана.
    invalidate();

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

    // 3. Озвучка — текст уже сформирован backend (номер прописью, состав, voiceName).
    kitchenVoice.remember(order.voice?.text); // для голосовой команды «повтори заказ»
    kitchenVoice.enqueue(order.voice?.text);
  });

  useSocketEvent<VoicedOrder>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    invalidate();

    // Backend добавляет voice.text только для полной отмены/отказа — озвучиваем.
    if (order.voice?.text) {
      beep('notify');
      kitchenVoice.enqueue(order.voice.text);
    }
  });
}
