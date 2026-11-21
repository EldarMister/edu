import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminDish } from './admin';

export type WarehouseTab = 'overview' | 'dishes' | 'ingredients' | 'preparation' | 'purchases' | 'inventory' | 'writeoff'
  | 'transfer' | 'supplier_return' | 'movements' | 'reports' | 'suppliers' | 'packages' | 'processing';
export interface WarehouseItemsOverview { totalProducts: number; totalDrinks: number; lowStockCount: number; totalUnits: number }
export function useWarehouseItemsOverview() {
  return useQuery({ queryKey: ['admin', 'warehouse', 'items', 'overview'], queryFn: () => get<WarehouseItemsOverview>('/admin/warehouse/items/overview') });
}
export function useWarehouseItems(search: string, categoryId = '') {
  return useQuery({ queryKey: ['admin', 'warehouse', 'items', search, categoryId], queryFn: () => get<AdminDish[]>(`/admin/warehouse/items?search=${encodeURIComponent(search)}&categoryId=${encodeURIComponent(categoryId)}`) });
}

const get = async <T>(url: string) => (await api.get<T>(url)).data;
const withWarehouse = (url: string, warehouseId?: string) =>
  warehouseId ? `${url}?warehouseId=${encodeURIComponent(warehouseId)}` : url;

function queryOptions(params: Record<string, string | number | boolean | readonly string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) value.forEach((entry) => query.append(name, entry));
    else query.append(name, String(value));
  }
  return query.toString();
}

// ---------- Типы ----------

import type { UnitCode, UnitType } from './warehouseUnits';

export type WarehouseItemKind = 'raw' | 'beverage' | 'goods' | 'preparation' | 'prepared_dish' | 'consumable';

export interface Ingredient {
  id: string;
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
  isPrepared?: boolean;
  kind: WarehouseItemKind;
  category: string | null;
  barcode?: string | null;
  preparationMode?: 'stocked' | 'virtual';
  recipeUnitCost?: number | null;
  recipeTotalCost?: number | null;
  recipeOutputQuantity?: number | null;
  recipeOutputUnit?: UnitCode | null;
  processingLosses?: Partial<Record<PreparationProcessingMethod, number>> | null;
  valuationKnown?: boolean;
  purchaseUnits?: { name: string; factor: number }[];
  purchaseUnit?: string | null;
  purchaseFactor?: number | null;
}

export interface IngredientsOverview {
  totalIngredients: number;
  lowStockCount: number;
  avgCost: number | null;
}

export interface RecipeItem {
  id: string;
  ingredientId: string;
  name: string;
  unit: string; // кириллица amountUnit
  amountUnit: UnitCode;
  unitType: UnitType;
  ingredientDisplayUnit: UnitCode;
  fromCommonWarehouse?: boolean;
  isPrepared?: boolean;
  amount: number; // в amountUnit
  avgCost: number | null; // за amountUnit
  costUnitLabel: string;
  lineCost: number | null;
  stock: number; // в amountUnit
  isLow: boolean;
  isActive: boolean;
}

export interface Recipe {
  dishId: string;
  dishName: string;
  price: number;
  foodCost: number | null;
  marginPercent: number | null;
  items: RecipeItem[];
}

export type PurchaseStatus = 'draft' | 'completed' | 'cancelled';

export interface PurchaseItem {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string; // кириллица
  unitCode: string; // canonical unit, or the saved package name
  quantity: number;
  quantityBase: number;
  purchasePrice: number;
  total: number;
  grossTotal: number;
  packageId: string | null;
  packageName: string | null;
  packageUnit: UnitCode | null;
  packageQuantity: number | null;
  packageFactor: number | null;
}

export interface PurchaseReturnableItem {
  ingredientId: string;
  name: string;
  unit: string;
  unitCode: UnitCode;
  receivedQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  receivedQuantityBase: number;
  returnedQuantityBase: number;
  remainingQuantityBase: number;
  remainingBase: number;
}

export interface PurchaseCorrection {
  id: string;
  createdAt: string;
  actorName: string | null;
  reason: string | null;
  before: Pick<Purchase, 'id' | 'date' | 'warehouseId' | 'supplier' | 'totalAmount' | 'discount' | 'items'>;
  after: PurchaseCorrection['before'];
}

export interface Purchase {
  id: string;
  warehouseId?: string | null;
  number: number;
  date: string;
  effectiveAt: string | null;
  postedAt: string | null;
  stockPostedAt?: string | null;
  supplier: string;
  supplierId: string | null;
  totalAmount: number;
  discount: number;
  note: string | null;
  attachments: string[];
  status: PurchaseStatus;
  itemsCount: number;
  items?: PurchaseItem[];
  productNames?: string[];
  createdAt: string;
  updatedAt: string;
  canCorrectStock?: boolean;
  historicalStockCorrection?: boolean;
  correctionBlockedReason?: string | null;
  returnableItems?: PurchaseReturnableItem[];
  corrections?: PurchaseCorrection[];
}

export interface PurchasesOverview {
  count: number;
  suppliers: number;
  sum: number;
}

export type StockMovementType = 'purchase' | 'sale' | 'return' | 'correction' | 'cancel' | 'inventory' | 'writeoff'
  | 'transfer' | 'supplier_return' | 'production' | 'processing';
export type StockMovementSource = 'purchase' | 'order' | 'manual' | 'inventory' | 'writeoff'
  | 'transfer' | 'supplier_return' | 'production' | 'processing';

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
  costKnown?: boolean;
  valuationAdjustment?: number | null;
  comment: string | null;
  createdAt: string;
}

export interface MovementsSummary {
  income: number;
  writeoff: number;
  returns: number;
}

export interface WarehouseOverview {
  stockValue: number | null;
  lowStockCount: number;
  purchasesTotal: number | null;
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
    warehouseId?: string | null;
    createdAt: string;
    type: StockMovementType;
    ingredientName: string;
    unit: string;
    change: number;
    after: number;
  }>;
  suppliersTop: Array<{ supplier: string; total: number | null }>;
}

const KEY = ['admin', 'warehouse'] as const;
const LOCATIONS_URL = '/admin/warehouse/locations';
const SUPPLIERS_URL = '/admin/warehouse/suppliers';
const PACKAGES_URL = '/admin/warehouse/packages';
const POLICY_URL = '/admin/warehouse/policy';

export interface WarehouseSupplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  note: string | null;
  isActive: boolean;
}

export interface WarehouseSupplierInput {
  id?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  note?: string | null;
  isActive?: boolean;
}

export function useWarehouseSuppliers(enabled = true, includeInactive = false) {
  return useQuery({
    queryKey: [...KEY, 'suppliers', includeInactive],
    queryFn: () => get<WarehouseSupplier[]>(includeInactive ? `${SUPPLIERS_URL}?includeInactive=true` : SUPPLIERS_URL),
    enabled,
  });
}

function useDirectoryMutations<Input extends { id?: string }, Item>(endpoint: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: async ({ id, ...body }: Input) =>
      (id ? await api.patch<Item>(`${endpoint}/${encodeURIComponent(id)}`, body) : await api.post<Item>(endpoint, body)).data,
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: async (id: string) => (await api.delete<Item>(`${endpoint}/${encodeURIComponent(id)}`)).data,
    onSuccess: invalidate,
  });
  return { save, archive };
}

export function useWarehouseSupplierMutations() {
  return useDirectoryMutations<WarehouseSupplierInput, WarehouseSupplier>(SUPPLIERS_URL);
}

export interface WarehousePackage {
  id: string;
  name: string;
  unit: UnitCode;
  unitType: UnitType;
  quantity: number;
  quantityBase: number;
  unitLabel: string;
  isActive: boolean;
}

export function useWarehousePackages(enabled = true, options: { includeInactive?: boolean; unitType?: UnitType } = {}) {
  const params = queryOptions({ includeInactive: options.includeInactive || undefined, unitType: options.unitType });
  return useQuery({
    queryKey: [...KEY, 'packages', params],
    queryFn: () => get<WarehousePackage[]>(params ? `${PACKAGES_URL}?${params}` : PACKAGES_URL),
    enabled,
  });
}

export interface WarehousePackageInput {
  id?: string;
  name: string;
  unit: UnitCode;
  quantity: number;
  isActive?: boolean;
}

export function useWarehousePackageMutations() {
  return useDirectoryMutations<WarehousePackageInput, WarehousePackage>(PACKAGES_URL);
}

export interface WarehousePolicy {
  allowNegativeIngredientStock: boolean;
  warehouseProductionEnabled: boolean;
  warehouseProcessingEnabled: boolean;
  productionInUse: boolean;
  processingInUse: boolean;
  warning: string;
  valuationRule: string;
}

export type WarehousePolicyInput = Partial<Pick<WarehousePolicy,
  'allowNegativeIngredientStock' | 'warehouseProductionEnabled' | 'warehouseProcessingEnabled'>>;

export function useWarehousePolicy(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'policy'],
    queryFn: () => get<WarehousePolicy>(POLICY_URL),
    enabled,
  });
}

export function useUpdateWarehousePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: WarehousePolicyInput) => (await api.patch<WarehousePolicy>(POLICY_URL, body)).data,
    onSuccess: (policy) => {
      qc.setQueryData([...KEY, 'policy'], policy);
      return qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export interface WarehouseLocation {
  id: string;
  name: string;
  isDefault: boolean;
  address?: string | null;
}

export interface WarehouseStationRoute {
  stationId: string;
  stationName: string;
  warehouseId: string | null;
}

export interface WarehouseLocations {
  locations: WarehouseLocation[];
  stationRoutes: WarehouseStationRoute[];
}

export function useWarehouseLocations(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'locations'],
    queryFn: () => get<WarehouseLocations>(LOCATIONS_URL),
    enabled,
  });
}

export function useWarehouseLocationMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: ({ id, ...body }: { id?: string; name: string; address?: string | null }) =>
      (id
        ? api.patch<WarehouseLocation>(`${LOCATIONS_URL}/${encodeURIComponent(id)}`, body)
        : api.post<WarehouseLocation>(LOCATIONS_URL, body)
      ).then((response) => response.data),
    onSuccess: invalidate,
  });
  const route = useMutation({
    mutationFn: ({ stationId, warehouseId }: { stationId: string; warehouseId: string | null }) =>
      api.patch(`${LOCATIONS_URL}/stations/${encodeURIComponent(stationId)}`, { warehouseId }),
    onSuccess: invalidate,
  });
  const transfer = useMutation({
    mutationFn: (body: { ingredientId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; unit: string }) =>
      api.post<{ ok: true }>(`${LOCATIONS_URL}/transfer`, body),
    onSuccess: invalidate,
  });
  return { save, route, transfer };
}

export function useWarehouseDashboard(params: { dateFrom: string; dateTo: string; warehouseId?: string }) {
  const q = new URLSearchParams();
  q.append('dateFrom', params.dateFrom);
  q.append('dateTo', params.dateTo);
  if (params.warehouseId) q.append('warehouseId', params.warehouseId);
  const qs = q.toString();
  return useQuery({
    queryKey: [...KEY, 'overview', qs],
    queryFn: () => get<WarehouseOverview>(`/admin/warehouse/overview?${qs}`),
  });
}

const PREPARATION_URL = '/admin/warehouse/preparation';

export interface PreparedIngredient {
  id: string;
  name: string;
  unit: string;
  displayUnit: UnitCode;
  unitType: UnitType;
  stock: number;
  avgCost: number | null;
  mode?: 'virtual' | 'stocked';
}

export interface PreparationRecipeInput {
  outputQuantity: number;
  outputUnit: UnitCode;
  items: {
    ingredientId: string;
    quantity: number;
    unit: UnitCode;
    netAmount?: number | null;
    lossPercent?: number;
    processingMethod?: PreparationProcessingMethod | null;
  }[];
}

export type PreparationProcessingMethod = 'cleaning' | 'boiling' | 'frying' | 'stewing' | 'baking';

export interface PreparationRecipe extends Omit<PreparationRecipeInput, 'items'> {
  id: string;
  name: string;
  displayUnit: UnitCode;
  unitType: UnitType;
  mode?: 'virtual' | 'stocked';
  instructions?: string;
  category?: string | null;
  updatedAt?: string;
  totalCost?: number | null;
  items: (PreparationRecipeInput['items'][number] & { name: string; lineCost?: number | null })[];
}

export function usePreparedIngredients(warehouseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'preparation', 'items', warehouseId],
    queryFn: () => get<PreparedIngredient[]>(withWarehouse(PREPARATION_URL, warehouseId)),
  });
}

export function usePreparationRecipe(id: string, warehouseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'preparation', 'recipe', id, warehouseId],
    queryFn: () => get<PreparationRecipe>(withWarehouse(`${PREPARATION_URL}/${encodeURIComponent(id)}/recipe`, warehouseId)),
  });
}

// ---------- Сырьё ----------

export function useIngredients(search: string, warehouseId?: string, enabled = true) {
  const q = new URLSearchParams();
  if (search) q.append('search', search);
  if (warehouseId) q.append('warehouseId', warehouseId);
  return useQuery({
    enabled,
    queryKey: [...KEY, 'ingredients', search, warehouseId],
    queryFn: () => get<Ingredient[]>(`/admin/warehouse/ingredients?${q.toString()}`),
  });
}

export function useIngredientsOverview(warehouseId?: string) {
  return useQuery({
    queryKey: [...KEY, 'ingredients', 'overview', warehouseId],
    queryFn: () => get<IngredientsOverview>(withWarehouse('/admin/warehouse/ingredients/overview', warehouseId)),
  });
}

export interface IngredientSupply {
  purchaseId: string;
  number: number;
  date: string;
  warehouseId: string | null;
  warehouseName: string;
  supplier: string;
  quantity: number;
  unitCode: UnitCode;
  unit: string;
  unitPrice: number | null;
  total: number | null;
}

interface WarehousePage<T> {
  rows: T[];
  page: number;
  pageSize: number;
}

export function useIngredientSupplies(id: string, warehouseId?: string, page = 1, pageSize = 20, enabled = true) {
  const qs = queryOptions({ warehouseId, page, pageSize });
  return useQuery({
    queryKey: [...KEY, 'ingredients', 'supplies', id, qs],
    queryFn: () => get<WarehousePage<IngredientSupply> & { total: number }>(
      `/admin/warehouse/ingredients/${encodeURIComponent(id)}/supplies?${qs}`,
    ),
    enabled: enabled && !!id,
  });
}

export interface IngredientInput {
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
    mutationFn: (id: string) =>
      api.delete(`/admin/warehouse/ingredients/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ---------- Техкарта ----------

export function useRecipe(dishId: string | null) {
  return useQuery({
    queryKey: [...KEY, 'recipe', dishId],
    queryFn: () => get<Recipe>(`/admin/warehouse/dishes/${dishId}/recipe`),
    enabled: !!dishId,
  });
}

export function useRecipeMutations(dishId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [...KEY, 'recipe', dishId] });
    qc.invalidateQueries({ queryKey: KEY });
  };
  const addItem = useMutation({
    mutationFn: (body: { ingredientId: string; amount: number; unit?: string; fromCommonWarehouse?: boolean }) =>
      api.post<Recipe>(`/admin/warehouse/dishes/${dishId}/recipe`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const updateItem = useMutation({
    mutationFn: ({ id, amount, unit, fromCommonWarehouse }: { id: string; amount: number; unit?: string; fromCommonWarehouse?: boolean }) =>
      api.patch<Recipe>(`/admin/warehouse/recipe/${id}`, { amount, unit, fromCommonWarehouse }).then((r) => r.data),
    onSuccess: invalidate,
  });
  const removeItem = useMutation({
    mutationFn: (id: string) =>
      api.delete<Recipe>(`/admin/warehouse/recipe/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { addItem, updateItem, removeItem };
}

// ---------- Закупки ----------

export interface PurchaseListFilter {
  status?: string;
  search?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  suppliers?: readonly string[];
  categories?: readonly string[];
  dateSort?: 'asc' | 'desc';
}

export function usePurchases(params: PurchaseListFilter, enabled = true) {
  const qs = queryOptions({ ...params, dateSort: params.dateSort ?? 'desc' });
  return useQuery({
    queryKey: [...KEY, 'purchases', qs],
    queryFn: () => get<Purchase[]>(`/admin/warehouse/purchases?${qs}`),
    enabled,
  });
}

export function purchaseWorkbookUrl(params: PurchaseListFilter, columns: string[]) {
  return `/admin/warehouse/purchases/export.xlsx?${queryOptions({ ...params, columns: columns.join(',') })}`;
}

export function usePurchase(id: string | null) {
  return useQuery({
    queryKey: [...KEY, 'purchase', id],
    queryFn: () => get<Purchase>(`/admin/warehouse/purchases/${encodeURIComponent(id ?? '')}`),
    enabled: !!id,
  });
}

export function usePurchasesOverview(warehouseId?: string, from?: string, to?: string, enabled = true) {
  const qs = queryOptions({ warehouseId, from, to });
  return useQuery({
    queryKey: [...KEY, 'purchases', 'overview', qs],
    queryFn: () => get<PurchasesOverview>(`/admin/warehouse/purchases/overview?${qs}`),
    enabled,
  });
}

export interface PurchaseLineInput {
  ingredientId: string;
  quantity: number;
  unit?: string;
  purchasePrice?: number;
  /** Extended line amount before invoice-wide discounts. */
  total?: number;
  packageId?: string;
  /** A saved linked package line on PATCH, including archived packages. */
  purchaseItemId?: string;
}

interface PurchaseMetadata {
  effectiveAt?: string | null;
  date?: string;
  warehouseId?: string;
  supplier?: string;
  supplierId?: string | null;
  note?: string | null;
  attachments?: string[];
  discount?: number;
  complete?: boolean;
}

export interface CreatePurchaseInput extends PurchaseMetadata {
  requestKey?: string;
  items: PurchaseLineInput[];
}

export interface UpdatePurchaseInput extends PurchaseMetadata {
  id: string;
  expectedUpdatedAt?: string;
  correctionReason?: string;
  items?: PurchaseLineInput[];
}

export interface LastPurchasePrice {
  ingredientId: string;
  unit: string;
  unitCode: UnitCode;
  unitPrice: number;
  date: string;
  purchaseId: string;
  supplier: string;
}

export function useLastPurchasePrices(ingredientIds: string[], warehouseId?: string, excludePurchaseId?: string, enabled = true) {
  const ids = [...new Set(ingredientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...KEY, 'purchases', 'last-prices', ids, warehouseId, excludePurchaseId],
    queryFn: async () => {
      const requests: Promise<LastPurchasePrice[]>[] = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const qs = queryOptions({ ingredientIds: ids.slice(offset, offset + 100).join(','), warehouseId, excludePurchaseId });
        requests.push(get<LastPurchasePrice[]>(`/admin/warehouse/purchases/last-prices?${qs}`));
      }
      return (await Promise.all(requests)).flat();
    },
    enabled: enabled && ids.length > 0,
  });
}

export function usePurchaseMutations() {
  const qc = useQueryClient();
  const invalidate = (purchase: Purchase) => {
    qc.setQueryData([...KEY, 'purchase', purchase.id], purchase);
    return qc.invalidateQueries({ queryKey: KEY });
  };
  const create = useMutation({
    mutationFn: (body: CreatePurchaseInput) =>
      api.post<Purchase>('/admin/warehouse/purchases', body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: UpdatePurchaseInput) =>
      api.patch<Purchase>(`/admin/warehouse/purchases/${encodeURIComponent(id)}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const complete = useMutation({
    mutationFn: (id: string) =>
      api.post<Purchase>(`/admin/warehouse/purchases/${encodeURIComponent(id)}/complete`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.post<Purchase>(`/admin/warehouse/purchases/${encodeURIComponent(id)}/cancel`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, complete, cancel };
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
  const q = new URLSearchParams();
  if (f.from) q.append('from', f.from);
  if (f.to) q.append('to', f.to);
  if (f.ingredientId) q.append('ingredientId', f.ingredientId);
  if (f.type) q.append('type', f.type);
  if (f.sourceType) q.append('sourceType', f.sourceType);
  if (f.search) q.append('search', f.search);
  if (f.warehouseId) q.append('warehouseId', f.warehouseId);
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

export type WarehouseReportView = 'movement_summary' | 'movements' | 'balances' | 'purchases' | 'losses' | 'sales' | 'variances';

export interface WarehouseReportFilter<View extends WarehouseReportView = WarehouseReportView> {
  view: View;
  warehouseId?: string;
  warehouseIds?: readonly string[];
  from?: string;
  to?: string;
  ingredientId?: string;
  search?: string;
  nameSort?: 'asc' | 'desc';
  nameCondition?: 'equals' | 'notEquals' | 'contains' | 'empty' | 'notEmpty';
  nameValue?: string;
  kind?: WarehouseItemKind;
  kinds?: readonly WarehouseItemKind[];
  category?: string;
  categories?: readonly string[];
  onlyWithMovement?: boolean;
  employeeId?: string;
  type?: StockMovementType;
  page?: number;
  pageSize?: number;
}

export interface WarehouseMovementSummaryRow {
  id: string;
  ingredientId: string;
  name: string;
  kind: WarehouseItemKind;
  category: string | null;
  warehouseId: string | null;
  warehouseName: string;
  unit: string;
  openingQuantity: number;
  openingAvgCost: number | null;
  openingValue: number | null;
  incomingQuantity: number;
  outgoingQuantity: number;
  closingQuantity: number;
  closingAvgCost: number | null;
  closingValue: number | null;
  valuationAdjustment: number | null;
  movementCount: number;
}

export interface WarehouseReportMovementRow {
  id: string;
  createdAt: string | null;
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  warehouseId: string | null;
  warehouseName: string;
  quantity: number;
  unit: string;
  unitCost: number | null;
  totalCost: number | null;
  valuationAdjustment: number | null;
  costKnown: boolean;
  sourceType: StockMovementSource | null;
  sourceId: string | null;
  documentLabel: string | null;
  employeeId: string | null;
  employeeName: string | null;
  reason: string | null;
  type: StockMovementType | 'balance';
}

export interface WarehouseMovementGroup {
  direction: 'incoming' | 'outgoing';
  sourceType: StockMovementSource;
  label: string;
  quantity: number;
  unit: string;
  averageCost: number | null;
  count: number;
}

interface WarehouseReportPage<T> extends WarehousePage<T> {
  totalRows: number;
  totalCost: number | null;
  totalValuationAdjustment: number;
}

export interface WarehouseMovementSummary extends WarehouseReportPage<WarehouseMovementSummaryRow> {
  view: 'movement_summary';
  openingValue: number | null;
  closingValue: number | null;
}

export interface WarehouseMovementReport extends WarehouseReportPage<WarehouseReportMovementRow> {
  view: Exclude<WarehouseReportView, 'movement_summary'>;
  movementGroups?: WarehouseMovementGroup[];
}

function reportQuery(params: WarehouseReportFilter, columns?: string[]) {
  const { warehouseId, warehouseIds, ...filters } = params;
  const scopedIds = [...new Set(warehouseIds?.filter(Boolean))].join(',');
  return queryOptions({
    ...filters,
    warehouseId: scopedIds ? undefined : warehouseId,
    warehouseIds: scopedIds || undefined,
    columns: columns?.join(','),
  });
}

export function movementWorkbookUrl(params: WarehouseReportFilter<'movement_summary'>, columns: string[]) {
  return `/admin/warehouse/reports/export.xlsx?${reportQuery(params, columns)}`;
}

export async function getMovementCsv(params: WarehouseReportFilter<'movements'>, signal?: AbortSignal) {
  const { data } = await api.get<string>(`/admin/warehouse/reports/export.csv?${reportQuery(params)}`, {
    responseType: 'text', signal,
  });
  return data;
}

export function useWarehouseReport<View extends WarehouseReportView>(params: WarehouseReportFilter<View>, enabled = true) {
  const qs = reportQuery(params);
  return useQuery({
    queryKey: [...KEY, 'reports', qs],
    queryFn: () => get<View extends 'movement_summary' ? WarehouseMovementSummary : WarehouseMovementReport>(
      `/admin/warehouse/reports?${qs}`,
    ),
    enabled,
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
