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

// ---------- Статистика кухни ----------
export type KitchenStatsPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';

export interface KitchenStatsDish {
  name: string;
  count: number;
  revenue: number;
  avgMin: number;
  minMin: number;
  maxMin: number;
  timed: boolean;
}
export interface KitchenStats {
  cards: {
    revenue: number;
    prepared: number;
    rejections: number;
    avgPrepMin: number;
  };
  prepared: {
    total: number;
    avgPerDay: number;
    uniqueDishes: number;
    maxPerDay: number;
  };
  dishes: KitchenStatsDish[];
  rejections: { name: string; count: number }[];
  hourly: { hour: number; count: number; revenue: number }[];
  period: KitchenStatsPeriod;
  range: { from: string | null; to: string | null };
}

export function useKitchenStats(
  params: { period: KitchenStatsPeriod; from?: string; to?: string },
  station: PrepStation = 'kitchen',
  enabled = true,
) {
  const q = new URLSearchParams();
  q.set('period', params.period);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  q.set('station', station);
  return useQuery({
    queryKey: ['kitchen', 'statistics', station, params],
    queryFn: async () => (await api.get<KitchenStats>(`/kitchen/statistics?${q.toString()}`)).data,
    enabled,
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

export function useStopList(enabled: boolean, station: PrepStation = 'kitchen') {
  return useQuery({
    queryKey: ['kitchen', 'stop-list', station],
    queryFn: async () =>
      (await api.get<StopListCategory[]>(`/kitchen/stop-list?station=${station}`)).data,
    enabled,
  });
}

export function useSaveStopList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { dishId: string; isAvailable: boolean }[]) =>
      (await api.patch<StopListCategory[]>('/kitchen/stop-list', { items })).data,
    retry: networkRetry,
    onSuccess: () => {
      // Стоп-лист общий по составу, но фильтруется по станции — обновляем оба экрана.
      qc.invalidateQueries({ queryKey: ['kitchen', 'stop-list'] });
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

/** Пакетный отказ по нескольким блюдам («Отказать выбранные»). */
export function useRejectItems(station: PrepStation = 'kitchen') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      orderId: string;
      itemIds: string[];
      setComponentIds: string[];
      partial?: { itemId: string; quantity: number }[];
      reason?: string;
      comment?: string;
    }) =>
      (await api.post<Order>(`/kitchen/orders/${p.orderId}/items/reject-batch?station=${station}`, {
        itemIds: p.itemIds,
        setComponentIds: p.setComponentIds,
        partial: p.partial,
        reason: p.reason,
        comment: p.comment,
      })).data,
    retry: networkRetry,
    onSettled: () => invalidateKitchen(qc),
  });
}
