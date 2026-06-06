import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import type { Order } from '@/types';

export type KitchenTab = 'new' | 'in_work' | 'ready' | 'rejected';

export function useKitchenOrders(tab: KitchenTab) {
  return useQuery({
    queryKey: ['kitchen', tab],
    queryFn: async () => (await api.get<Order[]>(`/kitchen/orders?tab=${tab}`)).data,
    refetchInterval: 15_000, // подстраховка, основное обновление — через сокет
  });
}

function invalidateKitchen(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['kitchen'] });
}

export function useAccept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) =>
      (await api.post<Order>(`/kitchen/orders/${orderId}/accept`)).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}

export function useReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) =>
      (await api.post<Order>(`/kitchen/orders/${orderId}/ready`)).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}

export function useRejectOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; reason: string; comment?: string }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/reject`, {
        reason: p.reason,
        comment: p.comment,
      })).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}

export function useRejectItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; itemId: string; reason: string; comment?: string }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/${p.itemId}/reject`, {
        reason: p.reason,
        comment: p.comment,
      })).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}
