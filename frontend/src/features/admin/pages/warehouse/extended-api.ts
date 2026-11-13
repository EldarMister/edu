import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UnitCode } from './units';
const KEY = ['admin', 'warehouse'] as const;
export interface PackageUnit {
  id: string;
  name: string;
  unit: UnitCode;
  quantity: number;
  isActive: boolean;
}
export function usePackages() {
  return useQuery({
    queryKey: [...KEY, 'packages'],
    queryFn: async () => (await api.get<PackageUnit[]>('/admin/warehouse/packages')).data,
  });
}
export function usePackageMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    save: useMutation({
      mutationFn: async ({ id, ...body }: { id?: string; name: string; unit: UnitCode; quantity: number }) =>
        (id
          ? await api.patch(`/admin/warehouse/packages/${id}`, body)
          : await api.post('/admin/warehouse/packages', body)
        ).data,
      onSuccess: invalidate,
    }),
    archive: useMutation({
      mutationFn: (id: string) => api.delete(`/admin/warehouse/packages/${id}`),
      onSuccess: invalidate,
    }),
  };
}
export interface ProcessingRow {
  ingredientId: string;
  warehouseId: string;
  quantity: number;
  unit: UnitCode;
  costSharePercent?: number;
  ingredientName?: string;
  name?: string;
  warehouseName?: string;
  unitCost?: number | null;
  lineCost?: number | null;
}
export interface ProcessingDocument {
  id: string;
  date: string;
  note: string | null;
  status: 'draft' | 'posted' | 'reversed';
  revision: number;
  totalCost: number | null;
  inputs: ProcessingRow[];
  outputs: ProcessingRow[];
  createdAt: string;
  reversedAt?: string;
  reversalReason?: string;
}
export interface ProcessingBody {
  date: string;
  note: string;
  inputs: ProcessingRow[];
  outputs: ProcessingRow[];
}
export function useProcessing(params: { warehouseId?: string; search?: string }) {
  return useQuery({
    queryKey: [...KEY, 'processing', params],
    queryFn: async () =>
      (await api.get<ProcessingDocument[]>('/admin/warehouse/processing', { params })).data,
  });
}
export function useProcessingDocument(id?: string) {
  return useQuery({
    enabled: !!id,
    queryKey: [...KEY, 'processing-document', id],
    queryFn: async () => (await api.get<ProcessingDocument>(`/admin/warehouse/processing/${id}`)).data,
  });
}
export function useProcessingMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    save: useMutation({
      mutationFn: async ({
        id,
        revision,
        requestKey,
        complete,
        ...body
      }: ProcessingBody & { id?: string; revision?: number; requestKey?: string; complete?: boolean }) => {
        if (!id)
          return (
            await api.post<ProcessingDocument>('/admin/warehouse/processing', {
              ...body,
              requestKey,
              complete,
            })
          ).data;
        const saved = (
          await api.patch<ProcessingDocument>(`/admin/warehouse/processing/${id}`, { ...body, revision })
        ).data;
        return complete
          ? (
              await api.post<ProcessingDocument>(`/admin/warehouse/processing/${id}/post`, {
                revision: saved.revision,
              })
            ).data
          : saved;
      },
      onSuccess: invalidate,
    }),
    reverse: useMutation({
      mutationFn: ({ id, ...body }: { id: string; revision: number; note: string }) =>
        api.post(`/admin/warehouse/processing/${id}/reverse`, body),
      onSuccess: invalidate,
    }),
  };
}
