import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminDish } from './api';

export interface WarehouseOverview {
  totalProducts: number;
  totalDrinks: number;
  lowStockCount: number;
  totalUnits: number;
}

const get = async <T>(url: string) => (await api.get<T>(url)).data;

export function useWarehouseOverview() {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'overview'],
    queryFn: () => get<WarehouseOverview>('/admin/warehouse/items/overview'),
  });
}

export function useWarehouseItems(search: string, categoryId: string) {
  const q = new URLSearchParams();
  if (search) q.set('search', search);
  if (categoryId) q.set('categoryId', categoryId);
  return useQuery({
    queryKey: ['admin', 'warehouse', 'items', search, categoryId],
    queryFn: () => get<AdminDish[]>(`/admin/warehouse/items?${q.toString()}`),
  });
}
