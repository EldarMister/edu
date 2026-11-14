import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const get = async <T>(url: string) => (await api.get<T>(url)).data;

// ---------- Типы ----------

import type { UnitCode, UnitType } from './units';

export type ProcessingMethod = 'cleaning' | 'boiling' | 'frying' | 'stewing' | 'baking';
export const PROCESSING_METHODS: { value: ProcessingMethod; label: string }[] = [
  { value: 'cleaning', label: 'Очистка' },
  { value: 'boiling', label: 'Варка' },
  { value: 'frying', label: 'Жарка' },
  { value: 'stewing', label: 'Тушение' },
  { value: 'baking', label: 'Запекание' },
];
export type ItemKind = 'raw' | 'beverage' | 'goods' | 'preparation' | 'prepared_dish' | 'consumable';
export const ITEM_KINDS: { value: ItemKind; label: string }[] = [
  { value: 'raw', label: 'Сырьё' },
  { value: 'beverage', label: 'Напитки' },
  { value: 'goods', label: 'Готовые товары' },
  { value: 'preparation', label: 'Полуфабрикаты' },
  { value: 'prepared_dish', label: 'Заготовленные блюда' },
  { value: 'consumable', label: 'Расходники' },
];
export interface Ingredient {
  recipeOutputQuantity?: number | null;
  recipeOutputUnit?: UnitCode | null;
  recipeTotalCost?: number | null;
  recipeUnitCost?: number | null; // cost per display unit for virtual preparations
  valuationKnown?: boolean;
  processingLosses?: Partial<Record<ProcessingMethod, number>>;
  kind?: ItemKind;
  category?: string | null;
  barcode?: string | null;
  supplier?: string | null;
  purchaseUnits?: { name: string; factor: number }[];
  supplierId?: string | null;
  purchaseUnit?: string | null;
  purchaseFactor?: number | null;
  preparationMode?: 'stocked' | 'virtual';
  id: string;
  isPrepared?: boolean;
  name: string;
  unitType: UnitType;
  baseUnit: UnitCode;
  displayUnit: UnitCode;
  unit: string; // кириллица display-единицы
  stock: number; // в display-единице
  avgCost: number | null; // за display-единицу
  lowStockThreshold: number;
  costUnitLabel: string; // «с/кг»
  stockBase: number;
  avgCostBase: number | null;
  isActive: boolean;
  isLow: boolean;
}

export interface IngredientsOverview {
  totalIngredients: number;
  lowStockCount: number;
  avgCost: number | null;
}

export interface RecipeItem {
  costKnown?: boolean;
  processingMethod?: ProcessingMethod | null;
  warehouseId?: string | null;
  netAmount?: number;
  lossPercent?: number;
  variantAmounts?: Record<string, number>;
  id: string;
  isPrepared?: boolean;
  fromCommonWarehouse?: boolean;
  ingredientId: string;
  name: string;
  unit: string; // кириллица amountUnit
  amountUnit: UnitCode;
  unitType: UnitType;
  ingredientDisplayUnit: UnitCode;
  amount: number; // в amountUnit
  avgCost: number | null; // за amountUnit
  costUnitLabel: string;
  lineCost: number | null;
  stock: number; // в amountUnit
  isLow: boolean;
  isActive: boolean;
}

export interface RecipeMetadata {
  instructions?: string;
  outputQuantity?: number;
  outputUnit?: string;
  photoUrl?: string;
}
export interface Recipe {
  costKnown?: boolean;
  version?: number;
  metadata?: RecipeMetadata | null;
  stockIngredientId?: string | null;
  stockAmount?: number;
  variants?: { id: string; name: string }[];
  components?: {
    dishId: string;
    dishName: string;
    variantId?: string;
    quantity: number;
    foodCost: number | null;
    accountingConfigured: boolean;
  }[];
  missingCosts?: string[];
  accountingConfigured?: boolean;
  marginAmount?: number | null;
  foodCostPercent?: number | null;
  dishId: string;
  dishName: string;
  price: number;
  foodCost: number | null;
  marginPercent: number | null;
  items: RecipeItem[];
}

export type PurchaseStatus = 'draft' | 'completed' | 'cancelled';

export interface PurchaseItem {
  grossTotal?: number;
  packageId?: string | null;
  packageName?: string | null;
  packageQuantity?: number | null;
  packageUnit?: string | null;
  packageFactor?: number | null;
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string; // кириллица
  unitCode: UnitCode;
  quantity: number;
  purchasePrice: number;
  total: number;
}

export interface Purchase {
  supplierId?: string | null;
  note?: string | null;
  attachments?: string[];
  discount?: number;
  id: string;
  warehouseId?: string | null;
  number: number;
  date: string;
  supplier: string;
  totalAmount: number;
  status: PurchaseStatus;
  itemsCount: number;
  items?: PurchaseItem[];
  createdAt: string;
}

export interface PurchasesOverview {
  count: number;
  suppliers: number;
  sum: number;
}

export type StockMovementType =
  | 'purchase'
  | 'sale'
  | 'return'
  | 'correction'
  | 'cancel'
  | 'inventory'
  | 'writeoff'
  | 'transfer'
  | 'supplier_return'
  | 'production'
  | 'processing';
export type StockMovementSource =
  | 'purchase'
  | 'order'
  | 'manual'
  | 'inventory'
  | 'writeoff'
  | 'transfer'
  | 'supplier_return'
  | 'production'
  | 'processing';

export interface StockMovement {
  id: string;
  warehouseId?: string | null;
  ingredientId: string;
  orderItemId?: string | null;
  ingredientName: string;
  unit: string;
  type: StockMovementType;
  sourceType: StockMovementSource;
  sourceId: string | null;
  documentLabel: string | null;
  beforeStock: number;
  change: number;
  afterStock: number;
  costAtMoment: number | null;
  comment: string | null;
  createdAt: string;
}

export interface MovementsSummary {
  income: number;
  writeoff: number;
  returns: number;
}

export interface WarehouseOverview {
  itemCount?: number;
  outOfStockCount?: number;
  lossesTotal?: number | null;
  missingRecipeCount?: number;
  unknownCostCount?: number;
  messages?: { code: string; text: string; count: number; section: 'recipes' | 'items' }[];
  stockValue: number | null;
  lowStockCount: number;
  purchasesTotal: number;
  ingredientWriteOffTotal: number | null;
  stockValueTrend: Array<{ date: string; value: number | null }>;
  lowStockItems: Array<{
    id: string;
    name: string;
    unit: string;
    stock: number;
    lowStockThreshold: number;
  }>;
  topConsumedIngredients: Array<{
    ingredientId: string;
    name: string;
    unit: string;
    quantity: number;
    cost: number | null;
  }>;
  recentMovements: Array<{
    id: string;
    createdAt: string;
    type: StockMovementType;
    ingredientName: string;
    unit: string;
    change: number;
    after: number;
    sourceId?: string | null;
    sourceType?: string;
  }>;
  suppliersTop: Array<{ supplier: string; total: number }>;
}

const KEY = ['admin', 'warehouse'] as const;
const warehouseLocationsKey = [...KEY, 'locations'] as const;

export interface WarehouseLocation {
  id: string;
  name: string;
  address?: string | null;
  isDefault: boolean;
}

export interface WarehouseLocations {
  locations: WarehouseLocation[];
  stationRoutes: { stationId: string; stationName: string; warehouseId: string | null }[];
}

export function useWarehouseLocations(enabled = true) {
  return useQuery({
    enabled,
    queryKey: warehouseLocationsKey,
    queryFn: () => get<WarehouseLocations>('/admin/warehouse/locations'),
  });
}

export function useWarehouseLocationMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: ({ id, ...body }: { id?: string; name: string; address?: string }) =>
      (id
        ? api.patch<WarehouseLocation>(`/admin/warehouse/locations/${encodeURIComponent(id)}`, body)
        : api.post<WarehouseLocation>('/admin/warehouse/locations', body)
      ).then((r) => r.data),
    onSuccess: invalidate,
  });
  const setRoute = useMutation({
    mutationFn: ({ stationId, warehouseId }: { stationId: string; warehouseId: string | null }) =>
      api.patch(`/admin/warehouse/locations/stations/${encodeURIComponent(stationId)}`, { warehouseId }),
    onSuccess: invalidate,
  });
  const transfer = useMutation({
    mutationFn: (body: {
      ingredientId: string;
      fromWarehouseId: string;
      toWarehouseId: string;
      quantity: number;
      unit: string;
    }) => api.post('/admin/warehouse/locations/transfer', body),
    onSuccess: invalidate,
  });
  return { save, setRoute, transfer };
}

function warehouseQuery(warehouseId?: string) {
  const query = new URLSearchParams();
  if (warehouseId) query.set('warehouseId', warehouseId);
  return query;
}

export function useWarehouseOverview(params: { dateFrom: string; dateTo: string; warehouseId?: string }) {
  const q = warehouseQuery(params.warehouseId);
  q.set('dateFrom', params.dateFrom);
  q.set('dateTo', params.dateTo);
  const qs = q.toString();
  return useQuery({
    queryKey: [...KEY, 'overview', qs],
    queryFn: () => get<WarehouseOverview>(`/admin/warehouse/overview?${qs}`),
  });
}

// ---------- Сырьё ----------

export function useIngredients(search: string, warehouseId?: string) {
  const q = warehouseQuery(warehouseId);
  if (search) q.set('search', search);
  return useQuery({
    queryKey: [...KEY, 'ingredients', { search, warehouseId }],
    queryFn: () => get<Ingredient[]>(`/admin/warehouse/ingredients?${q.toString()}`),
  });
}

export function useIngredientsOverview(warehouseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'ingredients', 'overview', warehouseId],
    queryFn: () =>
      get<IngredientsOverview>(`/admin/warehouse/ingredients/overview?${warehouseQuery(warehouseId)}`),
  });
}

export interface IngredientDetails extends Ingredient {
  balances: { warehouseId: string; warehouseName: string; stock: number; avgCost: number | null }[];
  usedInDishes: { id: string; name: string }[];
  lastPurchasePrice: number | null;
}
export function useIngredient(id: string | null) {
  return useQuery({
    queryKey: [...KEY, 'ingredient', id],
    queryFn: () => get<IngredientDetails>(`/admin/warehouse/ingredients/${id}`),
    enabled: !!id,
  });
}
export interface IngredientInput {
  processingLosses?: Partial<Record<ProcessingMethod, number>>;
  kind?: ItemKind;
  category?: string | null;
  barcode?: string | null;
  supplier?: string | null;
  purchaseUnits?: { name: string; factor: number }[];
  supplierId?: string | null;
  purchaseUnit?: string | null;
  purchaseFactor?: number | null;
  preparationMode?: 'stocked' | 'virtual';
  name: string;
  warehouseId?: string;
  unit: string;
  stock?: number;
  avgCost?: number;
  lowStockThreshold?: number;
  isActive?: boolean;
}

export function useIngredientMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const create = useMutation({
    mutationFn: (body: IngredientInput) =>
      api.post<Ingredient>('/admin/warehouse/ingredients', body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: IngredientInput & { id: string }) =>
      api.patch<Ingredient>(`/admin/warehouse/ingredients/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/warehouse/ingredients/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ---------- Техкарта ----------

export function useRecipe(dishId: string | null, variantId?: string) {
  return useQuery({
    queryKey: [...KEY, 'recipe', dishId, variantId],
    queryFn: () =>
      get<Recipe>(
        `/admin/warehouse/dishes/${dishId}/recipe${variantId ? `?variantId=${encodeURIComponent(variantId)}` : ''}`,
      ),
    enabled: !!dishId,
  });
}

export interface RecipeRowInput {
  processingMethod?: ProcessingMethod | null;
  amount: number;
  unit?: string;
  fromCommonWarehouse?: boolean;
  warehouseId?: string | null;
  netAmount?: number;
  lossPercent?: number;
  variantAmounts?: Record<string, number>;
}
export function useRecipeMutations(dishId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [...KEY, 'recipe', dishId] });
    qc.invalidateQueries({ queryKey: KEY });
  };
  const addItem = useMutation({
    mutationFn: (body: RecipeRowInput & { ingredientId: string }) =>
      api.post<Recipe>(`/admin/warehouse/dishes/${dishId}/recipe`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const updateItem = useMutation({
    mutationFn: ({ id, ...body }: RecipeRowInput & { id: string }) =>
      api.patch<Recipe>(`/admin/warehouse/recipe/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (id: string) => api.delete<Recipe>(`/admin/warehouse/recipe/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const settings = useMutation({
    mutationFn: (body: {
      variantId?: string;
      stockIngredientId?: string | null;
      stockAmount?: number;
      stockUnit?: string;
      metadata?: RecipeMetadata;
    }) => api.patch<Recipe>(`/admin/warehouse/dishes/${dishId}/recipe-settings`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { addItem, updateItem, removeItem, settings };
}

// ---------- Полуфабрикаты ----------

interface PreparedIngredient {
  id: string;
  name: string;
  unit: string;
  displayUnit: UnitCode;
  unitType: UnitType;
  stock: number;
  avgCost: number | null;
}

interface PreparationRecipeInput {
  instructions?: string;
  mode?: 'stocked' | 'virtual';
  outputQuantity: number;
  outputUnit: UnitCode;
  items: {
    ingredientId: string;
    quantity: number;
    unit: UnitCode;
    netAmount?: number;
    lossPercent?: number;
    processingMethod?: ProcessingMethod | null;
  }[];
}

export interface PreparationRecipe extends Omit<PreparationRecipeInput, 'items'> {
  totalCost?: number | null;
  missingCosts?: string[];
  id: string;
  name: string;
  displayUnit: UnitCode;
  unitType: UnitType;
  items: (PreparationRecipeInput['items'][number] & { name: string })[];
}

const PREPARATION_URL = '/admin/warehouse/preparation';

export function usePreparedIngredients(warehouseId: string) {
  return useQuery({
    queryKey: [...KEY, 'preparation', warehouseId],
    queryFn: () => get<PreparedIngredient[]>(`${PREPARATION_URL}?${warehouseQuery(warehouseId)}`),
  });
}

export function usePreparationRecipe(id: string, warehouseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'preparation', id, 'recipe', warehouseId],
    queryFn: () => get<PreparationRecipe>(`${PREPARATION_URL}/${id}/recipe?${warehouseQuery(warehouseId)}`),
  });
}

export interface ProductionBatch {
  costKnown?: boolean;
  reversedAt?: string | null;
  reverseReason?: string | null;
  id: string;
  batchId: string;
  ingredientName: string;
  warehouseId: string;
  plannedQuantity: number;
  actualQuantity: number;
  yieldDifference: number;
  unit: UnitCode;
  totalCost: number | null;
  unitCost: number | null;
  producedAt: string;
  expiresAt: string | null;
  batchNumber: string | null;
  items: { actual: { ingredientId: string; name: string; quantity: number; unit: UnitCode; cost: string | null; costKnown?: boolean }[] };
}
export function useProductionJournal(warehouseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'production', 'journal', warehouseId],
    queryFn: () => get<ProductionBatch[]>(`${PREPARATION_URL}/batches?${warehouseQuery(warehouseId)}`),
  });
}
export function useProductionBatches(id: string) {
  return useQuery({
    queryKey: [...KEY, 'production', id],
    queryFn: () => get<ProductionBatch[]>(`${PREPARATION_URL}/${id}/batches`),
  });
}
export function useProductionBatch(id: string) {
  return useQuery({
    queryKey: [...KEY, 'production', 'batch', id],
    queryFn: () => get<ProductionBatch>(`${PREPARATION_URL}/batches/${id}`),
  });
}
export function usePreparationMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const create = useMutation({
    mutationFn: (body: { name: string; unit: UnitCode }) =>
      api.post<PreparedIngredient>(PREPARATION_URL, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const saveRecipe = useMutation({
    mutationFn: ({ id, ...body }: PreparationRecipeInput & { id: string }) =>
      api.put<PreparationRecipe>(`${PREPARATION_URL}/${id}/recipe`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const produce = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      warehouseId: string;
      quantity: number;
      unit: UnitCode;
      plannedQuantity?: number;
      requestKey?: string;
      batchNumber?: string;
      expiresAt?: string;
      items?: { ingredientId: string; quantity: number; unit: UnitCode }[];
    }) =>
      api
        .post<{
          batchId: string;
          quantity: number;
          unit: string;
          warehouseId: string | null;
          totalCost: number | null;
        }>(`${PREPARATION_URL}/${id}/batches`, body)
        .then((r) => r.data),
    onSuccess: invalidate,
  });
  const reverseBatch = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`${PREPARATION_URL}/batches/${id}/reverse`, { reason }),
    onSuccess: invalidate,
  });
  return { create, saveRecipe, produce, reverseBatch };
}

// ---------- Закупки ----------

export function usePurchases(params: {
  status: string;
  search: string;
  warehouseId?: string;
  enabled?: boolean;
}) {
  const q = warehouseQuery(params.warehouseId);
  if (params.status) q.set('status', params.status);
  if (params.search) q.set('search', params.search);
  return useQuery({
    queryKey: [...KEY, 'purchases', params],
    enabled: params.enabled ?? true,
    queryFn: () => get<Purchase[]>(`/admin/warehouse/purchases?${q.toString()}`),
  });
}

export function usePurchase(id: string | null) {
  return useQuery({
    queryKey: [...KEY, 'purchase', id],
    queryFn: () => get<Purchase>(`/admin/warehouse/purchases/${id}`),
    enabled: !!id,
  });
}

export function usePurchasesOverview(warehouseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'purchases', 'overview', warehouseId],
    queryFn: () =>
      get<PurchasesOverview>(`/admin/warehouse/purchases/overview?${warehouseQuery(warehouseId)}`),
  });
}

export interface CreatePurchaseInput {
  requestKey?: string;
  supplierId?: string;
  note?: string;
  attachments?: string[];
  discount?: number;
  date?: string;
  warehouseId?: string;
  supplier: string;
  items: {
    ingredientId: string;
    packageId?: string;
    quantity: number;
    unit?: string;
    purchasePrice?: number;
    total?: number;
  }[];
  complete?: boolean;
}

export interface UpdatePurchaseInput {
  complete?: boolean;
  supplierId?: string;
  note?: string;
  attachments?: string[];
  discount?: number;
  id: string;
  date?: string;
  supplier?: string;
  items?: {
    ingredientId: string;
    packageId?: string;
    quantity: number;
    unit?: string;
    purchasePrice?: number;
    total?: number;
  }[];
}

export function usePurchaseMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const create = useMutation({
    mutationFn: (body: CreatePurchaseInput) =>
      api.post<Purchase>('/admin/warehouse/purchases', body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdatePurchaseInput) =>
      api.patch<Purchase>(`/admin/warehouse/purchases/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const complete = useMutation({
    mutationFn: (id: string) =>
      api.post<Purchase>(`/admin/warehouse/purchases/${id}/complete`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.post<Purchase>(`/admin/warehouse/purchases/${id}/cancel`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const reverse = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/admin/warehouse/purchases/${id}/reverse`, { note }),
    onSuccess: invalidate,
  });
  return { create, update, complete, cancel, reverse };
}

// ---------- Движения ----------

export interface MovementsFilter {
  warehouseId?: string;
  from?: string;
  to?: string;
  ingredientId?: string;
  type?: string;
  sourceType?: string;
  search?: string;
}

function movementsQuery(f: MovementsFilter) {
  const q = warehouseQuery(f.warehouseId);
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.ingredientId) q.set('ingredientId', f.ingredientId);
  if (f.type) q.set('type', f.type);
  if (f.sourceType) q.set('sourceType', f.sourceType);
  if (f.search) q.set('search', f.search);
  return q.toString();
}

export function useMovements(filter: MovementsFilter) {
  const qs = movementsQuery(filter);
  return useQuery({
    queryKey: [...KEY, 'movements', qs],
    queryFn: () => get<StockMovement[]>(`/admin/warehouse/movements?${qs}`),
  });
}

export function useMovementsSummary(filter: MovementsFilter) {
  const qs = movementsQuery(filter);
  return useQuery({
    queryKey: [...KEY, 'movements', 'summary', qs],
    queryFn: () => get<MovementsSummary>(`/admin/warehouse/movements/summary?${qs}`),
  });
}

// ---------- Форматирование ----------

/** «ЗКП-000142» из номера закупки. */
export function purchaseNumber(n: number): string {
  return `ЗКП-${String(n).padStart(6, '0')}`;
}

/** Количество с единицей измерения: 0.12 кг, 5 шт. */
export function qty(value: number, unit: string): string {
  const rounded = Math.round(value * 1000) / 1000;
  const str = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${str} ${unit}`;
}

export function useWarehouseDishes(search: string) {
  return useQuery({
    queryKey: [...KEY, 'recipe-dishes', search],
    queryFn: () =>
      get<
        {
          id: string;
          name: string;
          price: string;
          category?: { name: string };
          isSet?: boolean;
          hasDirectStock?: boolean;
          hasRecipe?: boolean;
          catalogKind?: 'goods' | 'recipe';
          stockIngredientId?: string | null;
        }[]
      >(`/admin/warehouse/dishes?${new URLSearchParams({ search })}`),
  });
}
