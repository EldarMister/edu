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

export interface StopListDish {
  id: string;
  name: string;
  isAvailable: boolean;
}
export interface StopListCategory {
  id: string;
  name: string;
  dishes: StopListDish[];
}

export function useStopList(enabled: boolean) {
  return useQuery({
    queryKey: ['kitchen', 'stop-list'],
    queryFn: async () => (await api.get<StopListCategory[]>('/kitchen/stop-list')).data,
    enabled,
  });
}

export function useSaveStopList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { dishId: string; isAvailable: boolean }[]) =>
      (await api.patch<StopListCategory[]>('/kitchen/stop-list', { items })).data,
    retry: networkRetry,
    onSuccess: (data) => {
      qc.setQueryData(['kitchen', 'stop-list'], data);
      qc.invalidateQueries({ queryKey: ['dishes'] });
    },
  });
}

function invalidateKitchen(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['kitchen'] });
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

export function useItemReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; itemId: string }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/${p.itemId}/ready`)).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}

/** Пакетная отметка нескольких блюд готовыми («Готово выбранные»). */
export function useReadyItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; itemIds: string[] }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/ready-batch`, { itemIds: p.itemIds })).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}

/** Пакетный отказ по нескольким блюдам («Отказать выбранные»). */
export function useRejectItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; itemIds: string[]; reason?: string; comment?: string }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/reject-batch`, {
        itemIds: p.itemIds,
        reason: p.reason,
        comment: p.comment,
      })).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}
