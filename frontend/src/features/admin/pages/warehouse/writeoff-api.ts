import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ItemKind } from './api';
import type { UnitCode } from './units';
import type { PackageUnit } from './extended-api';

export interface WriteoffSourceInput {
  sourceLineId: string;
  kind: 'ingredient' | 'dish';
  sourceId: string;
  variantId?: string;
  packageId?: string;
  packageSnapshotLineId?: string;
  quantity: number;
  unit?: UnitCode;
  recipeSignature?: string;
}

export interface WriteoffSourceLine extends Omit<WriteoffSourceInput, 'unit'> {
  name: string;
  unit: string;
  unitCode: UnitCode;
  recipeSignature: string;
  packageName?: string;
  packageQuantity?: number;
  packageUnit?: UnitCode;
  packageFactor?: number;
  physicalQuantity?: number;
  parts: { ingredientId: string; name: string; quantity: number; unit: string; unitCode: UnitCode; unitCost: number | null; total: number | null }[];
  total: number | null;
}

export interface WriteoffOptions {
  ingredients: { id: string; name: string; category: string | null; unit: string; unitCode: UnitCode; kind: ItemKind; preparationMode: 'stocked' | 'virtual' }[];
  dishes: { id: string; name: string; category: string | null; isWeighted: boolean; unitCode: 'pcs' | 'g' | 'ml'; variants: { id: string; name: string }[] }[];
}

export interface WriteoffPreview { sourceLines: WriteoffSourceLine[]; total: number | null }

export function useWriteoffOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'writeoff-options'],
    queryFn: async () => (await api.get<WriteoffOptions>('/admin/warehouse/documents/writeoff-options')).data,
    enabled,
  });
}

export function useWriteoffPackages(enabled: boolean) {
  return useQuery({ queryKey: ['admin', 'warehouse', 'packages'],
    queryFn: async () => (await api.get<PackageUnit[]>('/admin/warehouse/packages')).data,
    enabled });
}

export function useWriteoffPreview(warehouseId: string, sourceLines: WriteoffSourceInput[], enabled: boolean, refreshVersion = 0, documentId?: string) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'writeoff-preview', warehouseId, sourceLines, refreshVersion, documentId],
    queryFn: async () => (await api.post<WriteoffPreview>('/admin/warehouse/documents/writeoff-preview', { warehouseId, sourceLines, documentId })).data,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}
