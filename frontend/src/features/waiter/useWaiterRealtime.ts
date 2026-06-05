import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { beep } from '@/lib/sound';
import type { AppNotification } from '@/types';

/** Подписки официанта на real-time события сервера. */
export function useWaiterRealtime() {
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['halls'] });
  };

  useSocketEvent<AppNotification>('notification:new', (n) => {
    push({ message: n.message, orderId: n.orderId, orderNumber: n.orderNumber, at: n.at });
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
