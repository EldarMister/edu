import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { WriteoffSourceInput, WriteoffSourceLine } from './writeoff-api';

export type StockDocumentKind = 'inventory' | 'writeoff' | 'transfer' | 'supplier_return';
export type InventoryMode = 'full' | 'partial';
export type WriteoffReason =
  'spoilage' | 'expired' | 'damage' | 'staff_meal' | 'tasting' | 'household' | 'other';
export type StockDocumentStatus = 'draft' | 'submitted' | 'posted' | 'reversed';
export interface WriteoffReasonOption { id: string; label: string; expense: boolean; custom: boolean; archived?: boolean }
export type ExportableStockDocument = 'inventory' | 'transfer';

export interface StockDocumentItem {
  costKnown?:boolean;
  ingredientId: string;
  name: string;
  unit: string;
  expected: number | null;
  quantity: number | null;
  difference: number | null;
  value: number | null;
  unitCost: number | null;
}

export interface StockDocument {
  id: string;
  warehouseId: string;
  destinationWarehouseId?: string | null;
  sourcePurchaseId?: string | null;
  kind: StockDocumentKind;
  mode: InventoryMode | null;
  reason: WriteoffReason | null;
  writeoffReasonId?: string | null;
  reasonLabel?: string | null;
  note: string | null;
  status: StockDocumentStatus;
  revision: number;
  createdAt: string;
  submittedAt: string | null;
  postedAt: string | null;
  deletedAt?: string | null;
  reopenedAt?: string | null;
  countedAt?: string | null;
  effectiveAt?: string | null;
  createdByName: string | null;
  postedByName: string | null;
  itemsCount: number;
  productNames?: string[];
  writeoffProducts?: { kind: 'ingredient' | 'dish'; sourceId: string; name: string }[];
  categories?: string[];
  varianceValue: number | null;
}

export interface StockDocumentDetails extends StockDocument {
  reversalBlockedReason?: string | null;
  items: StockDocumentItem[];
  sourceLines?: WriteoffSourceLine[];
  sourceTotal?: number | null;
  inventoryContext?: {
    cutoffAt: string;
    rows: Array<{
      ingredientId: string;
      lastCountAt: string | null;
      lastCountId?: string | null;
      openingQuantity: number;
      incomingQuantity: number;
      consumptionQuantity: number;
      writeoffQuantity: number;
      otherQuantity: number;
      movementCount?: number;
      movements?: { id: string; sourceType: string; sourceId: string | null; createdAt: string;
        actorName: string | null; comment: string | null; change: number; bucket: string }[];
    }>;
  };
}

export interface DocumentInput {
  finalize?: 'submit' | 'post';
  requestKey?: string;
  destinationWarehouseId?: string;
  sourcePurchaseId?: string;
  revision?: number;
  recount?: boolean;
  countedAt?: string | null;
  effectiveAt?: string | null;
  reason?: WriteoffReason | null;
  writeoffReasonId?: string | null;
  note?: string;
  items?: { ingredientId: string; quantity: number | null }[];
  sourceLines?: WriteoffSourceInput[];
}

const BASE_URL = '/admin/warehouse/documents';
const WAREHOUSE_KEY = ['admin', 'warehouse'] as const;
const DOCUMENTS_KEY = [...WAREHOUSE_KEY, 'documents'] as const;
const REASONS_KEY = [...DOCUMENTS_KEY, 'reasons'] as const;

export function useWriteoffReasons(enabled = true, includeArchived = false) {
  return useQuery({ queryKey: includeArchived ? [...REASONS_KEY, 'with-archived'] : REASONS_KEY, enabled,
    queryFn: async () => (await api.get<WriteoffReasonOption[]>(`${BASE_URL}/reasons`, {
      params: includeArchived ? { includeArchived: true } : undefined,
    })).data });
}

export function useRemoveWriteoffReason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${BASE_URL}/reasons/${encodeURIComponent(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}

export function useRemoveWriteoff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      api.delete(`${BASE_URL}/writeoffs/${encodeURIComponent(id)}`, { data: { revision } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: WAREHOUSE_KEY }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'finance'] }),
      ]);
    },
  });
}

export function useRestoreWriteoff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, revision }: { id: string; revision: number }) =>
      (await api.post<StockDocumentDetails>(`${BASE_URL}/writeoffs/${encodeURIComponent(id)}/restore`, { revision })).data,
    onSuccess: async (document) => {
      queryClient.setQueryData([...DOCUMENTS_KEY, 'detail', document.id], document);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: WAREHOUSE_KEY }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'finance'] }),
      ]);
    },
  });
}

export function useSaveWriteoffReason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: { id?: string; name: string; expense: boolean }) => {
      const response = id ? await api.patch<WriteoffReasonOption>(`${BASE_URL}/reasons/${encodeURIComponent(id)}`, input)
        : await api.post<WriteoffReasonOption>(`${BASE_URL}/reasons`, input);
      return response.data;
    },
    onSuccess: (reason) => {
      queryClient.setQueryData<WriteoffReasonOption[]>(REASONS_KEY, (existing) =>
        [...(existing ?? []).filter(({ id }) => id !== reason.id), reason]);
      void queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'finance', 'profit-loss'] });
    },
  });
}

export function useStockDocuments(warehouseId?: string, kind?: StockDocumentKind, search?: string, includeDeletedWriteoffs = false) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, 'list', warehouseId, kind, search, includeDeletedWriteoffs],
    queryFn: async () => (await api.get<StockDocument[]>(BASE_URL, {
      params: { warehouseId, kind, search, includeDeletedWriteoffs: includeDeletedWriteoffs || undefined },
    })).data,
  });
}

export function useStockDocument(id: string) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, 'detail', id],
    queryFn: async () => (await api.get<StockDocumentDetails>(`${BASE_URL}/${encodeURIComponent(id)}`, {
      params: { includeDeletedWriteoffs: true },
    })).data,
  });
}

export async function downloadStockDocument(id: string, kind: ExportableStockDocument) {
  const transfer = kind === 'transfer';
  const filename = transfer ? 'transfer-act.xlsx' : 'inventory.xlsx';
  const response = await api.get<Blob>(`${BASE_URL}/${encodeURIComponent(id)}/${filename}`, { responseType: 'blob' });
  downloadWarehouseWorkbook(response.data, `${transfer ? 'Акт перемещения' : 'Инвентаризация'} ${id.slice(0, 8)}.xlsx`);
}

export async function downloadTransferRegister(ids: string[], columns: string[]) {
  const response = await api.post<Blob>(`${BASE_URL}/transfer-register.xlsx`, { ids, columns }, { responseType: 'blob' });
  downloadWarehouseWorkbook(response.data, 'Перемещения.xlsx');
}

export async function downloadWriteoffRegister(ids: string[], columns: string[]) {
  const response = await api.post<Blob>(`${BASE_URL}/writeoff-register.xlsx`, { ids, columns }, { responseType: 'blob' });
  downloadWarehouseWorkbook(response.data, 'Списания.xlsx');
}

export function downloadWarehouseWorkbook(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useInventoryContext(id: string, ingredientId?: string) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, 'detail', id, 'inventory-context', ingredientId],
    queryFn: async () => (await api.get<StockDocumentDetails>(`${BASE_URL}/${encodeURIComponent(id)}`, {
      params: { includeInventoryContext: true, inventoryIngredientId: ingredientId },
    })).data,
    staleTime: 0,
  });
}

export function useStockDocumentMutations() {
  const qc = useQueryClient();
  const saved = (document: StockDocumentDetails) => {
    qc.setQueryData([...DOCUMENTS_KEY, 'detail', document.id], document);
    void qc.invalidateQueries({ queryKey: [...DOCUMENTS_KEY, 'list'] });
    if (document.kind === 'inventory')
      void qc.invalidateQueries({ queryKey: [...DOCUMENTS_KEY, 'detail', document.id, 'inventory-context'] });
    if (document.status === 'posted' || document.status === 'reversed')
      void qc.invalidateQueries({ queryKey: WAREHOUSE_KEY });
  };
  const create = useMutation({
    mutationFn: async (
      body: DocumentInput & { warehouseId: string; kind: StockDocumentKind; mode?: InventoryMode },
    ) => (await api.post<StockDocumentDetails>(BASE_URL, body)).data,
    onSuccess: saved,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...body }: DocumentInput & { id: string }) =>
      (await api.patch<StockDocumentDetails>(`${BASE_URL}/${encodeURIComponent(id)}`, body)).data,
    onSuccess: saved,
  });
  const editPostedWriteoff = useMutation({
    mutationFn: async ({ id, ...body }: DocumentInput & { id: string; revision: number; warehouseId: string }) =>
      (await api.patch<StockDocumentDetails>(`${BASE_URL}/writeoffs/${encodeURIComponent(id)}`, body)).data,
    onSuccess: (document) => {
      saved(document);
      void qc.invalidateQueries({ queryKey: ['admin', 'finance'] });
    },
  });
  const transition = useMutation({
    mutationFn: async ({
      id,
      action,
      revision,
      note,
    }: {
      id: string;
      action: 'submit' | 'approve' | 'reopen' | 'reverse';
      revision: number;
      note?: string;
    }) =>
      (
        await api.post<StockDocumentDetails>(`${BASE_URL}/${encodeURIComponent(id)}/${action}`, {
          revision,
          note,
        })
      ).data,
    onSuccess: (document) => {
      saved(document);
      if (document.status === 'posted' || document.status === 'reversed')
        void qc.invalidateQueries({ queryKey: WAREHOUSE_KEY });
    },
  });
  return { create, update, transition, editPostedWriteoff };
}
