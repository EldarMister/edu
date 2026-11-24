import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { downloadWarehouseWorkbook } from './warehouse/stock-documents-api';

export type FoodCostTab = 'positions' | 'ingredients';
export type FoodCostPriceUnit = 'pcs' | 'g' | 'ml';

export interface FoodCostMetric {
  quantity: number;
  gross: number;
  revenue: number;
  cost: number | null;
  tax: number | null;
  margin: number | null;
  foodCostPercent: number | null;
}

export interface FoodCostPeriod {
  from: string;
  to: string;
  totals: FoodCostMetric;
  days: (FoodCostMetric & { date: string })[];
}

export interface FoodCostPosition {
  id: string;
  dishId: string | null;
  variantId: string | null;
  name: string;
  categoryId: string;
  category: string;
  catalogKind: 'goods' | 'recipe';
  isSet: boolean;
  price: number | null;
  priceBasis: number;
  priceUnit: FoodCostPriceUnit;
  active: boolean;
  current: FoodCostMetric;
  previous: FoodCostMetric;
  days?: (FoodCostMetric & { date: string })[];
  ingredients: {
    id: string; name: string; unit: string; currentCost: number | null; previousCost: number | null;
    currentUnitCost?: number | null; previousUnitCost?: number | null;
  }[];
}

interface IngredientMetric {
  quantity: number;
  cost: number | null;
  purchasePrice: number | null;
}

export interface FoodCostIngredient {
  id: string;
  name: string;
  unit: string;
  current: IngredientMetric;
  previous: IngredientMetric;
  prices: { date: string; price: number }[];
}

export interface FoodCostReport {
  asOf: string;
  current: FoodCostPeriod;
  previous: FoodCostPeriod;
  positions: FoodCostPosition[];
  ingredients: FoodCostIngredient[];
}

export interface FoodCostPriceChange {
  dishId: string;
  variantId: string | null;
  expectedPrice: number;
  expectedPriceBase: number;
  expectedUnit: FoodCostPriceUnit;
  price: number;
}

export type FoodCostRange = { from: string; to: string };
const url = '/admin/warehouse/reports/food-cost';

export function useFoodCostReport(range: FoodCostRange, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'food-cost', range],
    enabled,
    queryFn: async ({ signal }) => (await api.get<FoodCostReport>(url, { params: range, signal })).data,
    staleTime: 60_000,
  });
}

export function useApplyFoodCostPrices() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (changes: FoodCostPriceChange[]) =>
      (await api.post<{ changed: number }>('/admin/menu/food-cost/prices', { changes })).data,
    onSuccess: async () => {
      await client.invalidateQueries({ predicate: ({ queryKey }) =>
        ['admin', 'menu', 'catalog', 'dishes', 'waiter', 'delivery'].includes(String(queryKey[0])) });
    },
  });
}

export async function downloadFoodCostExcel(range: FoodCostRange, tab: FoodCostTab, search: string) {
  const response = await api.get<Blob>(url + '.xlsx', { params: { ...range, tab, search: search || undefined }, responseType: 'blob' });
  downloadWarehouseWorkbook(response.data, `Фудкост — ${tab === 'positions' ? 'позиции' : 'ингредиенты'} ${range.from} — ${range.to}.xlsx`);
}

export function useFoodCostAnalysis(range: FoodCostRange) {
  const availability = useQuery({
    queryKey: ['admin', 'warehouse', 'food-cost-ai-availability'],
    queryFn: async ({ signal }) => (await api.get<{ available: boolean }>(url + '/analysis/availability', { signal })).data,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const analysis = useMutation({
    mutationFn: async () => (await api.post<{ text: string }>(url + '/analysis', range)).data,
  });
  return { available: availability.data?.available === true, analysis };
}
