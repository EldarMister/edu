import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminDish } from './admin';

const KEY = ['admin', 'warehouse'] as const;

const get = async <T,>(url: string) => (await api.get<T>(url)).data;

function query(params: object) {
  const parts = Object.entries(params)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.join('&');
}

export type WarehouseTab = 'overview' | 'dishes' | 'ingredients' | 'purchases' | 'movements';
export type StockMovementType = 'purchase' | 'sale' | 'return' | 'correction' | 'cancel';
export type StockMovementSource = 'purchase' | 'order' | 'manual';
export type PurchaseStatus = 'draft' | 'completed' | 'cancelled';

export interface WarehouseOverview {
  stockValue: number;
  lowStockCount: number;
  purchasesTotal: number;
  ingredientWriteOffTotal: number;
  stockValueTrend: Array<{ date: string; value: number }>;
  lowStockItems: Array<{ id: string; name: string; unit: string; stock: number; lowStockThreshold: number }>;
  topConsumedIngredients: Array<{ ingredientId: string; name: string; unit: string; quantity: number; cost: number }>;
  recentMovements: Array<{
    id: string;
    createdAt: string;
    type: StockMovementType;
    ingredientName: string;
    unit: string;
    change: number;
    after: number;
  }>;
  suppliersTop: Array<{ supplier: string; total: number }>;
}

export interface WarehouseItemsOverview {
  totalProducts: number;
  totalDrinks: number;
  lowStockCount: number;
  totalUnits: number;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  displayUnit: string;
  stock: number;
  avgCost: number;
  lowStockThreshold: number;
  isActive: boolean;
  isLow: boolean;
}

export interface IngredientsOverview {
  totalIngredients: number;
  lowStockCount: number;
  avgCost: number;
}

export interface Purchase {
  id: string;
  number: number;
  date: string;
  supplier: string;
  totalAmount: number;
  status: PurchaseStatus;
  itemsCount: number;
  createdAt: string;
}

export interface PurchasesOverview {
  count: number;
  suppliers: number;
  sum: number;
}

export interface StockMovement {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  type: StockMovementType;
  sourceType: StockMovementSource;
  documentLabel: string | null;
  beforeStock: number;
  change: number;
  afterStock: number;
  costAtMoment: number;
  comment: string | null;
  createdAt: string;
}

export interface MovementsSummary {
  income: number;
  writeoff: number;
  returns: number;
}

export interface MovementsFilter {
  from?: string;
  to?: string;
  type?: string;
  sourceType?: string;
  search?: string;
}

export function useWarehouseDashboard(params: { dateFrom: string; dateTo: string }) {
  const qs = query(params);
  return useQuery({
    queryKey: [...KEY, 'overview', qs],
    queryFn: () => get<WarehouseOverview>(`/admin/warehouse/overview?${qs}`),
  });
}

export function useWarehouseItemsOverview() {
  return useQuery({
    queryKey: [...KEY, 'items', 'overview'],
    queryFn: () => get<WarehouseItemsOverview>('/admin/warehouse/items/overview'),
  });
}

export function useWarehouseItems(search: string) {
  const qs = query({ search });
  return useQuery({
    queryKey: [...KEY, 'items', search],
    queryFn: () => get<AdminDish[]>(`/admin/warehouse/items?${qs}`),
  });
}

export function useIngredients(search: string) {
  const qs = query({ search });
  return useQuery({
    queryKey: [...KEY, 'ingredients', search],
    queryFn: () => get<Ingredient[]>(`/admin/warehouse/ingredients?${qs}`),
  });
}

export function useIngredientsOverview() {
  return useQuery({
    queryKey: [...KEY, 'ingredients', 'overview'],
    queryFn: () => get<IngredientsOverview>('/admin/warehouse/ingredients/overview'),
  });
}

export function usePurchases(params: { status: string; search: string }) {
  const qs = query(params);
  return useQuery({
    queryKey: [...KEY, 'purchases', params.status, params.search],
    queryFn: () => get<Purchase[]>(`/admin/warehouse/purchases?${qs}`),
  });
}

export function usePurchasesOverview() {
  return useQuery({
    queryKey: [...KEY, 'purchases', 'overview'],
    queryFn: () => get<PurchasesOverview>('/admin/warehouse/purchases/overview'),
  });
}

export function useMovements(filter: MovementsFilter) {
  const qs = query(filter);
  return useQuery({
    queryKey: [...KEY, 'movements', qs],
    queryFn: () => get<StockMovement[]>(`/admin/warehouse/movements?${qs}`),
  });
}

export function useMovementsSummary(filter: MovementsFilter) {
  const qs = query(filter);
  return useQuery({
    queryKey: [...KEY, 'movements', 'summary', qs],
    queryFn: () => get<MovementsSummary>(`/admin/warehouse/movements/summary?${qs}`),
  });
}

export function purchaseNumber(value: number): string {
  return `ЗКП-${String(value).padStart(6, '0')}`;
}

export function qty(value: number, unit: string): string {
  const rounded = Math.round(value * 1000) / 1000;
  const str = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${str} ${unit}`;
}
