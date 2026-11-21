import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PreparationRecipe, PreparationRecipeInput } from './warehouse';
import type { UnitCode } from './warehouseUnits';

const warehouseKey = ['admin', 'warehouse'] as const;
const productionKey = [...warehouseKey, 'production'] as const;
const path = '/admin/warehouse/preparation';

export interface ProductionBatch {
  id: string;
  warehouseId: string;
  ingredientName: string;
  plannedQuantity: number;
  actualQuantity: number;
  yieldDifference: number;
  unit: UnitCode;
  totalCost: number | null;
  producedAt: string;
  expiresAt: string | null;
  batchNumber: string | null;
  reversedAt?: string | null;
  reverseReason?: string | null;
  items: {
    actual?: {
      ingredientId: string;
      name: string;
      quantity: number;
      unit: UnitCode;
      cost: string | null;
    }[];
  } | null;
}

export interface ProduceInput {
  id: string;
  warehouseId: string;
  quantity: number;
  plannedQuantity: number;
  unit: UnitCode;
  requestKey: string;
  batchNumber?: string;
  expiresAt?: string;
  items?: { ingredientId: string; quantity: number; unit: UnitCode }[];
}

type PreparationCardInput = PreparationRecipeInput & {
  id?: string;
  expectedUpdatedAt?: string;
  name: string;
  unit: UnitCode;
  category: string | null;
  mode: 'virtual' | 'stocked';
  instructions: string;
  requestKey: string;
};

export function useSavePreparationCard() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PreparationCardInput) => (
      id ? api.put<PreparationRecipe>(path + '/' + encodeURIComponent(id) + '/card', body)
        : api.post<PreparationRecipe>(path + '/card', body)
    ).then(({ data }) => data),
    onSuccess: () => cache.invalidateQueries({ queryKey: warehouseKey }),
  });
}

export function useProductionJournal(warehouseId?: string, enabled = true) {
  return useQuery({
    queryKey: [...productionKey, 'journal', warehouseId],
    enabled,
    queryFn: () => api.get<ProductionBatch[]>(path + '/batches', { params: { warehouseId } }).then(({ data }) => data),
  });
}

export function useProductionBatch(id: string) {
  return useQuery({
    queryKey: [...productionKey, 'batch', id],
    queryFn: () => api.get<ProductionBatch>(path + '/batches/' + encodeURIComponent(id)).then(({ data }) => data),
  });
}

export function useProductionHistory(id: string) {
  return useQuery({
    queryKey: [...productionKey, 'history', id],
    queryFn: () => api.get<ProductionBatch[]>(path + '/' + encodeURIComponent(id) + '/batches').then(({ data }) => data),
  });
}

export function useProductionMutations() {
  const cache = useQueryClient();
  function invalidate(batch: ProductionBatch) {
    cache.setQueryData([...productionKey, 'batch', batch.id], batch);
    return cache.invalidateQueries({ queryKey: warehouseKey });
  }
  const produce = useMutation({
    mutationFn: ({ id, ...body }: ProduceInput) =>
      api.post<ProductionBatch>(path + '/' + encodeURIComponent(id) + '/batches', body).then(({ data }) => data),
    onSuccess: invalidate,
  });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<ProductionBatch>(path + '/batches/' + encodeURIComponent(id) + '/reverse', { reason }).then(({ data }) => data),
    onSuccess: invalidate,
  });
  return { produce, reverse };
}
