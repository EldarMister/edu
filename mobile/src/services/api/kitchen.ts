import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import type { Order, PrepStation } from '@/types';

export type KitchenTab = 'new' | 'in_work' | 'ready' | 'rejected';

export function useKitchenOrders(tab: KitchenTab, station: PrepStation = 'kitchen') {
  return useQuery({
    queryKey: ['kitchen', station, tab],
    queryFn: async () =>
      (await api.get<Order[]>(`/kitchen/orders?tab=${tab}&station=${station}`)).data,
    refetchInterval: 15_000, // подстраховка, основное обновление — через сокет
  });
}

function invalidateKitchen(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['kitchen'] });
  qc.invalidateQueries({ queryKey: ['orders'] });
}

export function useAccept(station: PrepStation = 'kitchen') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) =>
      (await api.post<Order>(`/kitchen/orders/${orderId}/accept?station=${station}`)).data,
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

export function useItemReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; itemId: string }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/${p.itemId}/ready`)).data,
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

/** Пакетная отметка нескольких блюд готовыми. */
export function useReadyItems(station: PrepStation = 'kitchen') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; itemIds: string[]; setComponentIds: string[] }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/ready-batch?station=${station}`, {
        itemIds: p.itemIds,
        setComponentIds: p.setComponentIds,
      })).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}

/** Пакетный отказ по нескольким блюдам. */
export function useRejectItems(station: PrepStation = 'kitchen') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      orderId: string;
      itemIds: string[];
      setComponentIds: string[];
      reason?: string;
    }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/reject-batch?station=${station}`, {
        itemIds: p.itemIds,
        setComponentIds: p.setComponentIds,
        reason: p.reason,
      })).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}
