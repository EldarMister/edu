import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type StockDocumentKind = 'inventory' | 'writeoff';
export type InventoryMode = 'full' | 'partial';
export type WriteoffReason = 'spoilage' | 'expired' | 'damage' | 'staff_meal' | 'other';
export type StockDocumentStatus = 'draft' | 'submitted' | 'posted';

export interface StockDocumentItem {
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
  kind: StockDocumentKind;
  mode: InventoryMode | null;
  reason: WriteoffReason | null;
  note: string | null;
  status: StockDocumentStatus;
  revision: number;
  createdAt: string;
  submittedAt: string | null;
  postedAt: string | null;
  createdByName: string | null;
  postedByName: string | null;
  itemsCount: number;
  varianceValue: number | null;
}

export interface StockDocumentDetails extends StockDocument {
  items: StockDocumentItem[];
}

interface DocumentInput {
  revision?: number;
  recount?: boolean;
  reason?: WriteoffReason | null;
  note?: string;
  items?: { ingredientId: string; quantity: number }[];
}

const BASE_URL = '/admin/warehouse/documents';
const WAREHOUSE_KEY = ['admin', 'warehouse'] as const;
const DOCUMENTS_KEY = [...WAREHOUSE_KEY, 'documents'] as const;

export function useStockDocuments(warehouseId: string, kind: StockDocumentKind) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, 'list', warehouseId, kind],
    queryFn: async () => (await api.get<StockDocument[]>(BASE_URL, { params: { warehouseId, kind } })).data,
  });
}

export function useStockDocument(id: string) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, 'detail', id],
    queryFn: async () => (await api.get<StockDocumentDetails>(`${BASE_URL}/${encodeURIComponent(id)}`)).data,
  });
}

export function useStockDocumentMutations() {
  const qc = useQueryClient();
  const saved = (document: StockDocumentDetails) => {
    qc.setQueryData([...DOCUMENTS_KEY, 'detail', document.id], document);
    void qc.invalidateQueries({ queryKey: [...DOCUMENTS_KEY, 'list'] });
  };
  const create = useMutation({
    mutationFn: async (body: DocumentInput & { warehouseId: string; kind: StockDocumentKind; mode?: InventoryMode }) =>
      (await api.post<StockDocumentDetails>(BASE_URL, body)).data,
    onSuccess: saved,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...body }: DocumentInput & { id: string }) =>
      (await api.patch<StockDocumentDetails>(`${BASE_URL}/${encodeURIComponent(id)}`, body)).data,
    onSuccess: saved,
  });
  const transition = useMutation({
    mutationFn: async ({ id, action, revision }: { id: string; action: 'submit' | 'approve' | 'reopen'; revision: number }) =>
      (await api.post<StockDocumentDetails>(`${BASE_URL}/${encodeURIComponent(id)}/${action}`, { revision })).data,
    onSuccess: (document) => {
      saved(document);
      if (document.status === 'posted') void qc.invalidateQueries({ queryKey: WAREHOUSE_KEY });
    },
  });
  return { create, update, transition };
}
