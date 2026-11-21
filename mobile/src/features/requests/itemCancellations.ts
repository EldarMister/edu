import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';

export type ItemCancellationStatus = 'pending' | 'approved' | 'rejected';
export type ItemCancellationEvent = { orderId: string; orderNumber: string; status: ItemCancellationStatus };
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

export const itemCancellationKey = ['item-cancellations'] as const;
const orderPath = (orderId: string) => '/orders/' + encodeURIComponent(orderId);

export function useItemCancellationQueue() {
  return useQuery({
    queryKey: [...itemCancellationKey, 'queue'],
    queryFn: async ({ signal }) => (await api.get<ItemCancellationRequest[]>('/orders/item-cancellation-requests', { signal })).data,
    refetchInterval: 30_000,
  });
}

export function usePendingItemCancellations(orderId: string | undefined) {
  return useQuery({
    queryKey: [...itemCancellationKey, 'pending', orderId],
    queryFn: async ({ signal }) =>
      (await api.get<{ itemId: string }[]>(orderPath(orderId!) + '/item-cancellation-requests', { signal })).data,
    enabled: !!orderId,
    retry: false,
  });
}

export function useRequestItemCancellation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, itemId, reason }: { orderId: string; itemId: string; reason: string }) => {
      await api.post(orderPath(orderId) + '/items/' + encodeURIComponent(itemId) + '/cancellation-request', { reason });
    },
    retry: networkRetry,
    onSuccess: () => cache.invalidateQueries({ queryKey: itemCancellationKey }),
  });
}

export function invalidateItemCancellation(cache: QueryClient, status: ItemCancellationStatus) {
  const keys: (readonly string[])[] = [itemCancellationKey];
  if (status === 'approved') keys.push(['orders'], ['admin', 'orders'], ['admin', 'warehouse'], ['kitchen'], ['halls']);
  return Promise.all(keys.map((queryKey) => cache.invalidateQueries({ queryKey })));
}

export function useDecideItemCancellation(request: ItemCancellationRequest) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (decision: 'approve' | 'reject') => {
      await api.post(orderPath(request.orderId) + '/item-cancellation-requests/' + encodeURIComponent(request.id) + '/' + decision);
    },
    retry: networkRetry,
    onSuccess: (_result, decision) => invalidateItemCancellation(cache, decision === 'approve' ? 'approved' : 'rejected'),
  });
}
