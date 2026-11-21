import { useQueryClient } from '@tanstack/react-query';
import { useT } from '@/lib/i18n';
import { useSocketEvent } from '@/services/socket';
import { useNotifications } from '@/store/notifications';
import { displayOrderNumber } from '@/utils/format';
import { invalidateRefunds, type RefundEvent } from './api';

export function useRefundRealtime(workspace: 'admin' | 'terminal' | null) {
  const cache = useQueryClient();
  const push = useNotifications((state) => state.push);
  const t = useT();

  useSocketEvent<RefundEvent>('order:refund_updated', (event) => {
    if (!workspace) return;
    void invalidateRefunds(cache, event.status);
    const notice = workspace === 'admin'
      ? event.status === 'pending' ? 'Новая заявка на возврат' : null
      : event.status === 'approved' ? 'Возврат оформлен'
        : event.status === 'rejected' ? 'Заявка на возврат отклонена' : null;
    if (notice) {
      push({ message: t(notice) + ' · ' + displayOrderNumber(event.orderNumber), at: new Date().toISOString() });
    }
  }, [workspace, cache, push, t]);
}
