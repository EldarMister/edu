import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import { waiterVoice } from '@/services/waiterVoice';
import type { AppNotification, Order, ReceiptPrintRequest } from '@/types';
import { useReceiptPrint } from './receiptPrint';

/** Текст голосового уведомления официанту по статусу заказа (с номером стола). */
function waiterVoiceText(order: Order): string | null {
  const table = `Стол ${order.table?.number}`;
  switch (order.status) {
    case 'accepted_by_kitchen':
      return `Кухня приняла ваш заказ. ${table}.`;
    case 'ready':
      return `Ваш заказ готов. ${table}. Заберите.`;
    case 'rejected':
      return `Кухня отменила заказ. ${table}.`;
    case 'partially_rejected':
      return `Кухня отменила блюдо. ${table}.`;
    default:
      return null;
  }
}

/** Подписки официанта на real-time события сервера. */
export function useWaiterRealtime() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);
  const userId = useAuth((s) => s.user?.id);
  // Защита от повторной озвучки одного и того же статуса заказа.
  const voicedRef = useRef<Map<string, string>>(new Map());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['halls'] });
    qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
  };

  useSocketEvent<AppNotification>('notification:new', (n) => {
    const orderNumber = n.orderNumber ? displayOrderNumber(n.orderNumber) : undefined;
    const message = n.orderNumber && orderNumber ? n.message.replace(n.orderNumber, orderNumber) : n.message;
    push({ message, type: n.type ?? 'info', orderId: n.orderId, orderNumber, at: n.at });
    beep('notify');
  });

  useSocketEvent<Order>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    invalidate();

    // Голосовое уведомление — только по своим заказам и только на новый статус.
    if (order.waiter?.id && order.waiter.id === userId) {
      const text = waiterVoiceText(order);
      if (text && voicedRef.current.get(order.id) !== order.status) {
        voicedRef.current.set(order.id, order.status);
        waiterVoice.enqueue(text);
      }
    }
  });
  useSocketEvent('waiter:order_ready', invalidate);
  useSocketEvent('waiter:order_rejected', invalidate);
  useSocketEvent('waiter:shift_started', () =>
    qc.invalidateQueries({ queryKey: ['waiter', 'shift'] }),
  );
  useSocketEvent('waiter:shift_ended', () =>
    qc.invalidateQueries({ queryKey: ['waiter', 'shift'] }),
  );
  useSocketEvent('table:status_changed', () =>
    qc.invalidateQueries({ queryKey: ['halls'] }),
  );
  // Кухня изменила стоп-лист / меню — обновляем доступность блюд без перезагрузки.
  useSocketEvent('menu:updated', () => qc.invalidateQueries({ queryKey: ['dishes'] }));

  // Печать чека: администратор подтвердил → печатаем; отклонил → показываем отказ.
  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_printed', (req) => {
    const st = useReceiptPrint.getState();
    if (st.request?.id !== req.id) return;
    if (st.sheetOpen) {
      st.resolve('printed');
    } else {
      push({
        message: `Чек ${displayOrderNumber(req.orderNumber)} распечатан. Заберите чек.`,
        type: 'success',
        at: new Date().toISOString(),
      });
      st.dismiss();
      beep('notify');
    }
  });

  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_rejected', (req) => {
    const st = useReceiptPrint.getState();
    if (st.request?.id !== req.id) return;
    if (st.sheetOpen) {
      st.resolve('rejected');
    } else {
      push({
        message: 'Печать чека отклонена администратором',
        type: 'error',
        at: new Date().toISOString(),
      });
      st.dismiss();
    }
    beep('notify');
  });
}
