import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import { displayOrderNumber } from '@/lib/format';
import type { AppNotification } from '@/types';

/** Подписки официанта на real-time события сервера. */
export function useWaiterRealtime() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['halls'] });
    qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
  };

  useSocketEvent<AppNotification>('notification:new', (n) => {
    const orderNumber = n.orderNumber ? displayOrderNumber(n.orderNumber) : undefined;
    const message = n.orderNumber && orderNumber ? n.message.replace(n.orderNumber, orderNumber) : n.message;
    push({ message, orderId: n.orderId, orderNumber, at: n.at });
    beep('notify');
  });

  useSocketEvent('order:status_changed', invalidate);
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
}
