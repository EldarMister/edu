import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { beep } from '@/lib/sound';
import { useNotifications } from '@/store/notifications';

/**
 * Глобальная синхронизация React Query кэша по realtime-событиям (ТЗ §21).
 * Монтируется один раз внутри авторизованной области.
 * При reconnect — рефетч активных данных (invalidateQueries резолвит активные наблюдатели).
 */
export function useRealtimeSync() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);

  useEffect(() => {
    const sock = getSocket();

    const invalidateOrders = () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['kitchen'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    };
    const invalidateTables = () => {
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    };
    const invalidateMenu = () => {
      qc.invalidateQueries({ queryKey: ['dishes'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    };
    const notifyWaiter = () => {
      invalidateOrders();
      push({ message: 'Статус заказа обновлён', type: 'info', at: new Date().toISOString() });
      void beep('notify');
    };
    const notifyReceiptAccepted = () => {
      invalidateOrders();
      push({ message: 'Печать чека подтверждена', type: 'success', at: new Date().toISOString() });
      void beep('accept');
    };

    const handlers: Array<[string, () => void]> = [
      [SERVER_EVENTS.ORDER_NEW, invalidateOrders],
      [SERVER_EVENTS.ORDER_STATUS_CHANGED, invalidateOrders],
      [SERVER_EVENTS.KITCHEN_NEW_ORDER, invalidateOrders],
      [SERVER_EVENTS.WAITER_ORDER_READY, notifyWaiter],
      [SERVER_EVENTS.WAITER_ORDER_REJECTED, notifyWaiter],
      [SERVER_EVENTS.WAITER_SHIFT_STARTED, invalidateOrders],
      [SERVER_EVENTS.WAITER_SHIFT_ENDED, invalidateOrders],
      [SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, notifyReceiptAccepted],
      [SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, notifyReceiptAccepted],
      [SERVER_EVENTS.TABLE_STATUS_CHANGED, invalidateTables],
      [SERVER_EVENTS.TABLES_UPDATED, invalidateTables],
      [SERVER_EVENTS.MENU_UPDATED, invalidateMenu],
    ];

    handlers.forEach(([event, fn]) => sock.on(event, fn));

    // При восстановлении соединения — обновляем активные данные.
    const onReconnect = () => {
      invalidateOrders();
      invalidateTables();
    };
    sock.on('connect', onReconnect);

    return () => {
      handlers.forEach(([event, fn]) => sock.off(event, fn));
      sock.off('connect', onReconnect);
    };
  }, [push, qc]);
}
