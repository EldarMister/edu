import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { RecipeMetadata, RecipeRowInput } from './api';
import type { UnitCode } from './units';

export interface RecipePreviewInput {
  dishId?: string;
  categoryId?: string;
  prepStation?: string | null;
  variantId?: string;
  price?: number;
  taxId?: string | null;
  taxExempt?: boolean;
  producedStockIngredientId?: string | null;
  weightedPriceBase?: number;
  metadata?: Pick<RecipeMetadata, 'outputQuantity' | 'outputUnit'>;
  items: (Omit<RecipeRowInput, 'netAmount'> & { ingredientId: string; netAmount?: number | null })[];
}

export interface RecipePreview {
  items: {
    ingredientId: string;
    warehouseName: string | null;
    amount: number;
    netAmount: number | null;
    amountUnit: UnitCode;
    avgCost: number | null;
    lineCost: number | null;
  }[];
  stockItem: { id: string; name: string; unit: UnitCode; amount: number; warehouseName: string; kind: string } | null;
  output: { amount: number; unit: UnitCode } | null;
  accountingConfigured: boolean;
  foodCost: number | null;
  compositionFoodCost: number | null;
  compositionMissingCosts: string[];
  ingredientCost: number | null;
  packagingCost: number | null;
  missingCosts: string[];
  productionMissingCosts?: string[];
  price: number | null;
  taxAmount: number | null;
  foodCostPercent: number | null;
  markupPercent: number | null;
  marginPercent: number | null;
  marginAmount: number | null;
}

export function useRecipePreview(input: RecipePreviewInput | null) {
  const payload = input ? JSON.stringify(input) : null;
  const [readyPayload, setReadyPayload] = useState(payload);
  useEffect(() => {
    const timeout = window.setTimeout(() => setReadyPayload(payload), 250);
    return () => window.clearTimeout(timeout);
  }, [payload]);

  const ready = !!payload && readyPayload === payload;
  const query = useQuery({
    queryKey: ['admin', 'warehouse', 'recipe-preview', readyPayload],
    enabled: ready,
    retry: false,
    queryFn: async ({ signal }) => (await api.post<RecipePreview>(
      '/admin/warehouse/recipe-preview', readyPayload, { signal, headers: { 'Content-Type': 'application/json' } },
    )).data,
  });

  return {
    data: ready ? query.data : undefined,
    pending: !!payload && (!ready || query.isPending),
    error: ready ? query.error : null,
    retry: query.refetch,
  };
}
