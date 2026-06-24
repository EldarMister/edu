import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';

/**
 * Глобальная синхронизация React Query кэша по realtime-событиям (ТЗ §21).
 * Монтируется один раз внутри авторизованной области.
 * При reconnect — рефетч активных данных (invalidateQueries резолвит активные наблюдатели).
 */
export function useRealtimeSync() {
  const qc = useQueryClient();

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

    const handlers: Array<[string, () => void]> = [
      [SERVER_EVENTS.ORDER_NEW, invalidateOrders],
      [SERVER_EVENTS.ORDER_STATUS_CHANGED, invalidateOrders],
      [SERVER_EVENTS.KITCHEN_NEW_ORDER, invalidateOrders],
      [SERVER_EVENTS.WAITER_ORDER_READY, invalidateOrders],
      [SERVER_EVENTS.WAITER_ORDER_REJECTED, invalidateOrders],
      [SERVER_EVENTS.WAITER_SHIFT_STARTED, invalidateOrders],
      [SERVER_EVENTS.WAITER_SHIFT_ENDED, invalidateOrders],
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
  }, [qc]);
}
