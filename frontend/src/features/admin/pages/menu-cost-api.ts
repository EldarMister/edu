import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceQuantity } from './warehouse/balance-format';
import { normalizeUnitLabel } from './warehouse/units';

export interface MenuCostRow {
  dishId: string;
  dishName: string;
  categoryId: string;
  categoryName: string;
  isSet: boolean;
  catalogKind: 'goods' | 'recipe';
  variantId: string | null;
  variantName: string | null;
  price: number;
  foodCost: number | null;
  foodCostPercent: number | null;
  markupPercent: number | null;
  marginAmount: number | null;
  marginPercent: number | null;
  missingCosts: string[];
  costKnown: boolean;
  accountingConfigured?: boolean;
  output: { amount: number; unit: string } | null;
}

export function useMenuCosts(params: {
  search?: string; categoryId?: string; offset?: number; limit?: number; dishIds?: string;
}, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'recipe-costs', params],
    enabled,
    queryFn: async ({ signal }) => (await api.get<{ rows: MenuCostRow[]; total: number; offset: number; limit: number }>(
      '/admin/warehouse/recipe-costs', { params, signal },
    )).data,
  });
}

const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
export const costPercent = (value: number) => percent.format(value) + '%';

export function menuOutputLabel(output: MenuCostRow['output']) {
  return output ? balanceQuantity(output.amount, normalizeUnitLabel(output.unit)) : '—';
}
