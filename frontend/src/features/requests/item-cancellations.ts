import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import { displayOrderNumber } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';

type CancellationStatus = 'pending' | 'approved' | 'rejected';
export type ItemCancellationRequest = {
  id: string;
  orderId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  reason: string;
  requestedByName: string;
  createdAt: string;
  order: { orderNumber: string };
};

const key = ['item-cancellations'] as const;
const queuePath = '/orders/item-cancellation-requests';
const orderPath = (id: string) => '/orders/' + encodeURIComponent(id);

export function useItemCancellationQueue() {
  return useQuery({
    queryKey: [...key, 'queue'],
    queryFn: async ({ signal }) => (await api.get<ItemCancellationRequest[]>(queuePath, { signal })).data,
    refetchInterval: 30_000,
  });
}

export function usePendingItemCancellations(orderId?: string) {
  return useQuery({
    queryKey: [...key, 'pending', orderId],
    queryFn: async ({ signal }) => (await api.get<{ itemId: string }[]>(orderPath(orderId!) + '/item-cancellation-requests', { signal })).data,
    enabled: !!orderId,
  });
}

export function useRequestItemCancellation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, itemId, reason }: { orderId: string; itemId: string; reason: string }) => {
      await api.post(orderPath(orderId) + '/items/' + encodeURIComponent(itemId) + '/cancellation-request', { reason });
    },
    retry: networkRetry,
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
}

export function useDecideItemCancellation(request: ItemCancellationRequest) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (decision: 'approve' | 'reject') => {
      await api.post(orderPath(request.orderId) + '/item-cancellation-requests/' + encodeURIComponent(request.id) + '/' + decision);
    },
    retry: networkRetry,
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
}

export function useItemCancellationUpdates(workspace: 'admin' | 'terminal', enabled = true) {
  const cache = useQueryClient();
  const push = useNotifications((state) => state.push);
  const t = useT();
  useSocketEvent<{ orderNumber: string; status: CancellationStatus }>('order:item_cancellation_updated', (event) => {
    if (!enabled) return;
    void cache.invalidateQueries({ queryKey: key });
    if ((workspace === 'admin') !== (event.status === 'pending')) return;
    const message = event.status === 'pending' ? t('Новая заявка на отмену блюда')
      : event.status === 'approved' ? t('Блюдо отменено') : t('Заявка на отмену блюда отклонена');
    push({ message: message + ' · ' + displayOrderNumber(event.orderNumber), at: new Date().toISOString() });
  }, [enabled, workspace, cache, push, t]);
}
