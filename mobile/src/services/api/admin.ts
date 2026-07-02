import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PaymentMethod } from '@/types';

// ---------- Статистика (порт PWA features/admin/api useStatistics) ----------
export type StatsPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';

export interface StatsDashboard {
  cards: {
    revenueToday: number;
    ordersToday: number;
    avgCheck: number;
    revenuePeriod: number;
    ordersPeriod: number;
  };
  trends: { revenue: number; orders: number; avgCheck: number };
  revenueSeries: { label: string; amount: number }[];
  peakHours: { hour: string; amount: number; orders: number }[];
  paymentMethods: { method: PaymentMethod; amount: number; percent: number }[];
  topDishes: { name: string; amount: number; count: number }[];
  topWaiters: { name: string; amount: number; orders: number; avgCheck: number }[];
  period: StatsPeriod;
  range: { from: string | null; to: string | null };
}

export function useStatistics(params: { period: StatsPeriod; from?: string; to?: string }) {
  // Query строим вручную (URLSearchParams в RN ненадёжен).
  const parts = [`period=${params.period}`];
  if (params.from) parts.push(`from=${params.from}`);
  if (params.to) parts.push(`to=${params.to}`);
  const query = parts.join('&');
  return useQuery({
    queryKey: ['admin', 'stats', params],
    queryFn: async () => (await api.get<StatsDashboard>(`/admin/statistics?${query}`)).data,
  });
}
