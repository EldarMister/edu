import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ItemKind } from './api';
import type { UnitCode } from './units';

export interface WriteoffSourceInput {
  sourceLineId: string;
  kind: 'ingredient' | 'dish';
  sourceId: string;
  variantId?: string;
  quantity: number;
  unit?: UnitCode;
  recipeSignature?: string;
}

export interface WriteoffSourceLine extends Omit<WriteoffSourceInput, 'unit'> {
  name: string;
  unit: string;
  unitCode: UnitCode;
  recipeSignature: string;
  parts: { ingredientId: string; name: string; quantity: number; unit: string; unitCode: UnitCode; unitCost: number | null; total: number | null }[];
  total: number | null;
}

export interface WriteoffOptions {
  ingredients: { id: string; name: string; category: string | null; unit: string; unitCode: UnitCode; kind: ItemKind; preparationMode: 'stocked' | 'virtual' }[];
  dishes: { id: string; name: string; category: string | null; isWeighted: boolean; unitCode: 'pcs' | 'g'; variants: { id: string; name: string }[] }[];
}

export interface WriteoffPreview { sourceLines: WriteoffSourceLine[]; total: number | null }

export function useWriteoffOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'writeoff-options'],
    queryFn: async () => (await api.get<WriteoffOptions>('/admin/warehouse/documents/writeoff-options')).data,
    enabled,
  });
}

export function useWriteoffPreview(warehouseId: string, sourceLines: WriteoffSourceInput[], enabled: boolean, refreshVersion = 0) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'writeoff-preview', warehouseId, sourceLines, refreshVersion],
    queryFn: async () => (await api.post<WriteoffPreview>('/admin/warehouse/documents/writeoff-preview', { warehouseId, sourceLines })).data,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}
