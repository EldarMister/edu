import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UnitCode } from './warehouseUnits';
import type { WarehouseItemKind } from './warehouse';

export type StockDocumentKind = 'inventory' | 'writeoff' | 'transfer' | 'supplier_return';
export type StockInventoryMode = 'full' | 'partial';
export type StockDocumentReason = 'spoilage' | 'expired' | 'damage' | 'staff_meal' | 'tasting' | 'household' | 'other';
export type StockDocumentStatus = 'draft' | 'submitted' | 'posted' | 'reversed';

export interface StockDocumentItem {
  ingredientId: string;
  name: string;
  unit: string;
  expected: number | null;
  quantity: number | null;
  difference: number | null;
  value: number | null;
  unitCost?: number | null;
  costKnown?: boolean;
}

export interface InventoryContext {
  cutoffAt: string;
  rows: {
    ingredientId: string;
    lastCountAt: string | null;
    openingQuantity: number;
    incomingQuantity: number;
    consumptionQuantity: number;
    writeoffQuantity: number;
    otherQuantity: number;
  }[];
}

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
  parts: {
    ingredientId: string;
    name: string;
    quantity: number;
    unit: string;
    unitCode: UnitCode;
    availableQuantity?: number;
    unitCost: number | null;
    total: number | null;
  }[];
  total: number | null;
}

export interface WriteoffOptions {
  ingredients: {
    id: string; name: string; category: string | null; unit: string; unitCode: UnitCode;
    kind: WarehouseItemKind; preparationMode: 'stocked' | 'virtual';
  }[];
  dishes: { id: string; name: string; category: string | null; isWeighted: boolean; unitCode: 'pcs' | 'g';
    variants: { id: string; name: string }[] }[];
}

export interface WriteoffPreview { sourceLines: WriteoffSourceLine[]; total: number | null }

export interface StockDocument {
  id: string;
  warehouseId: string;
  kind: StockDocumentKind;
  mode: StockInventoryMode | null;
  reason: StockDocumentReason | null;
  note: string | null;
  status: StockDocumentStatus;
  revision: number;
  createdAt: string;
  submittedAt: string | null;
  postedAt: string | null;
  countedAt: string | null;
  effectiveAt: string | null;
  destinationWarehouseId: string | null;
  sourcePurchaseId: string | null;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
  createdByName: string | null;
  submittedByName: string | null;
  postedByName: string | null;
  itemsCount: number;
  productNames?: string[];
  categories?: string[];
  varianceValue: number | null;
  items?: StockDocumentItem[];
  sourceLines?: WriteoffSourceLine[];
  sourceTotal?: number | null;
  inventoryContext?: InventoryContext;
}

export interface StockDocumentValues {
  reason?: StockDocumentReason | null;
  note?: string | null;
  items?: { ingredientId: string; quantity: number | null }[];
  sourceLines?: WriteoffSourceInput[];
  finalize?: 'submit' | 'post';
  countedAt?: string | null;
  effectiveAt?: string | null;
  recount?: boolean;
}

export type CreateStockDocumentInput = StockDocumentValues & {
  warehouseId: string;
  kind: StockDocumentKind;
  mode?: StockInventoryMode;
  requestKey?: string;
  destinationWarehouseId?: string;
  sourcePurchaseId?: string;
};

const endpoint = '/admin/warehouse/documents';
const key = ['admin', 'warehouse', 'documents'] as const;
const detailsKey = (id: string) => [...key, 'detail', id] as const;
const inventoryContextKey = (id: string) => [...detailsKey(id), 'inventory-context'] as const;
const path = (id: string) => `${endpoint}/${encodeURIComponent(id)}`;

export function useStockDocuments(kind: StockDocumentKind, warehouseId?: string, search?: string, enabled = true) {
  const text = search?.trim();
  const params = { kind, ...(warehouseId ? { warehouseId } : {}), ...(text ? { search: text } : {}) };
  return useQuery({
    queryKey: [...key, 'list', params],
    queryFn: async () => (await api.get<StockDocument[]>(endpoint, { params })).data,
    enabled,
  });
}

export function useStockDocument(id: string, includeInventoryContext = false) {
  return useQuery({
    queryKey: includeInventoryContext ? inventoryContextKey(id) : detailsKey(id),
    queryFn: async () => (await api.get<StockDocument>(path(id),
      includeInventoryContext ? { params: { includeInventoryContext: 'true' } } : undefined)).data,
    enabled: !!id,
  });
}

export function useWriteoffOptions(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'writeoff-options'],
    queryFn: async () => (await api.get<WriteoffOptions>(`${endpoint}/writeoff-options`)).data,
    enabled,
  });
}

export function useWriteoffPreview(warehouseId: string, sourceLines: WriteoffSourceInput[], enabled: boolean,
  refreshVersion = 0, documentId?: string) {
  return useQuery({
    queryKey: ['admin', 'warehouse', 'writeoff-preview', warehouseId, sourceLines, refreshVersion, documentId],
    queryFn: async () => (await api.post<WriteoffPreview>(`${endpoint}/writeoff-preview`, { warehouseId, sourceLines, documentId })).data,
    enabled: enabled && !!warehouseId,
    retry: false,
    staleTime: Infinity,
  });
}

export function useStockDocumentMutations() {
  const qc = useQueryClient();
  function updateCaches(document: StockDocument) {
    qc.setQueryData(detailsKey(document.id), document);
    void qc.invalidateQueries({ queryKey: [...key, 'list'] });
    if (document.kind === 'inventory') void qc.invalidateQueries({ queryKey: inventoryContextKey(document.id) });
    if (document.status === 'posted' || document.status === 'reversed') {
      void qc.invalidateQueries({ queryKey: ['admin', 'warehouse'] });
    }
  }
  const create = useMutation({
    mutationFn: async (body: CreateStockDocumentInput) => (await api.post<StockDocument>(endpoint, body)).data,
    onSuccess: updateCaches,
  });
  const save = useMutation({
    mutationFn: async ({ id, ...body }: StockDocumentValues & { id: string; revision: number }) =>
      (await api.patch<StockDocument>(path(id), body)).data,
    onSuccess: updateCaches,
  });
  const transition = useMutation({
    mutationFn: async ({ id, revision, action, note }: {
      id: string;
      revision: number;
      action: 'submit' | 'approve' | 'reopen' | 'reverse';
      note?: string;
    }) => (await api.post<StockDocument>(`${path(id)}/${action}`, action === 'reverse' ? { revision, note } : { revision })).data,
    onSuccess: updateCaches,
  });
  return { create, save, transition };
}
