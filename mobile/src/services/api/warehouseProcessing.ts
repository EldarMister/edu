import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UnitCode } from './warehouseUnits';

export interface ProcessingLineInput {
  ingredientId: string;
  warehouseId: string;
  quantity: number;
  unit: UnitCode;
  costSharePercent?: number;
}

export interface ProcessingLine extends ProcessingLineInput {
  id: string;
  name: string;
  warehouseName: string;
  unitLabel: string;
  unitCost: number | null;
  lineCost: number | null;
  costSharePercent: number;
}

export interface ProcessingDocument {
  id: string;
  status: 'draft' | 'posted' | 'reversed';
  revision: number;
  date: string;
  effectiveAt?: string | null;
  note: string | null;
  totalCost: number | null;
  inputs: ProcessingLine[];
  outputs: ProcessingLine[];
  createdAt: string;
  createdByName: string;
  postedAt: string | null;
  postedByName: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
  reverseReason: string | null;
  reversalBlockedReason?: string;
}

export interface ProcessingValues {
  effectiveAt?: string | null;
  note: string;
  inputs: ProcessingLineInput[];
  outputs: ProcessingLineInput[];
}

type ListParams = { from?: string; to?: string; warehouseId?: string; search?: string };
type SaveInput = ProcessingValues & (
  { id: string; revision: number; complete?: boolean; requestKey?: never } |
  { id?: undefined; revision?: never; complete: boolean; requestKey: string }
);
type TransitionInput = { id: string; revision: number } & (
  { action: 'post'; note?: never } | { action: 'reverse'; note: string }
);

const warehouseKey = ['admin', 'warehouse'] as const;
const key = [...warehouseKey, 'processing'] as const;
const endpoint = '/admin/warehouse/processing';
const documentPath = (id: string) => `${endpoint}/${encodeURIComponent(id)}`;
const detailKey = (id: string | null) => [...key, 'detail', id];

export function useWarehouseProcessing(params: ListParams, enabled = true) {
  return useQuery({
    queryKey: [...key, 'list', params],
    queryFn: async () => (await api.get<ProcessingDocument[]>(endpoint, { params })).data,
    enabled,
  });
}

export function useProcessingDocument(id: string | null) {
  return useQuery({
    queryKey: detailKey(id),
    queryFn: async () => (await api.get<ProcessingDocument>(documentPath(id!))).data,
    enabled: !!id,
  });
}

export function useProcessingMutations() {
  const client = useQueryClient();
  function invalidate(document: ProcessingDocument) {
    client.setQueryData(detailKey(document.id), document);
    return client.invalidateQueries({ queryKey: warehouseKey });
  }
  const save = useMutation({
    mutationFn: async ({ id, ...body }: SaveInput) =>
      (id ? await api.patch<ProcessingDocument>(documentPath(id), body) : await api.post<ProcessingDocument>(endpoint, body)).data,
    onSuccess: invalidate,
  });
  const transition = useMutation({
    mutationFn: async ({ id, action, revision, note }: TransitionInput) =>
      (await api.post<ProcessingDocument>(`${documentPath(id)}/${action}`, { revision, ...(action === 'reverse' ? { note } : {}) })).data,
    onSuccess: invalidate,
  });
  return { save, transition };
}
