import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const get = async <T>(url: string) => (await api.get<T>(url)).data;

// ---------- Типы ----------

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  stock: number;
  avgCost: number;
  lowStockThreshold: number;
  isActive: boolean;
  isLow: boolean;
}

export interface IngredientsOverview {
  totalIngredients: number;
  lowStockCount: number;
  avgCost: number;
}

export interface RecipeItem {
  id: string;
  ingredientId: string;
  name: string;
  unit: string;
  amount: number;
  avgCost: number;
  lineCost: number;
  stock: number;
  isLow: boolean;
  isActive: boolean;
}

export interface Recipe {
  dishId: string;
  dishName: string;
  price: number;
  foodCost: number;
  marginPercent: number;
  items: RecipeItem[];
}

export type PurchaseStatus = 'draft' | 'completed' | 'cancelled';

export interface PurchaseItem {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  purchasePrice: number;
  total: number;
}

export interface Purchase {
  id: string;
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

export type StockMovementType = 'purchase' | 'sale' | 'return' | 'correction' | 'cancel';
export type StockMovementSource = 'purchase' | 'order' | 'manual';

export interface StockMovement {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: string;
  type: StockMovementType;
  sourceType: StockMovementSource;
  sourceId: string | null;
  documentLabel: string | null;
  beforeStock: number;
  change: number;
  afterStock: number;
  costAtMoment: number;
  comment: string | null;
  createdAt: string;
}

export interface MovementsSummary {
  income: number;
  writeoff: number;
  returns: number;
}

const KEY = ['admin', 'warehouse'] as const;

// ---------- Сырьё ----------

export function useIngredients(search: string) {
  const q = new URLSearchParams();
  if (search) q.set('search', search);
  return useQuery({
    queryKey: [...KEY, 'ingredients', search],
    queryFn: () => get<Ingredient[]>(`/admin/warehouse/ingredients?${q.toString()}`),
  });
}

export function useIngredientsOverview() {
  return useQuery({
    queryKey: [...KEY, 'ingredients', 'overview'],
    queryFn: () => get<IngredientsOverview>('/admin/warehouse/ingredients/overview'),
  });
}

export interface IngredientInput {
  name: string;
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
    mutationFn: (body: { ingredientId: string; amount: number }) =>
      api.post<Recipe>(`/admin/warehouse/dishes/${dishId}/recipe`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const updateItem = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.patch<Recipe>(`/admin/warehouse/recipe/${id}`, { amount }).then((r) => r.data),
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

export function usePurchases(params: { status: string; search: string }) {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.search) q.set('search', params.search);
  return useQuery({
    queryKey: [...KEY, 'purchases', params.status, params.search],
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

export function usePurchasesOverview() {
  return useQuery({
    queryKey: [...KEY, 'purchases', 'overview'],
    queryFn: () => get<PurchasesOverview>('/admin/warehouse/purchases/overview'),
  });
}

export interface CreatePurchaseInput {
  date?: string;
  supplier: string;
  items: { ingredientId: string; quantity: number; purchasePrice?: number; total?: number }[];
  complete?: boolean;
}

export interface UpdatePurchaseInput {
  id: string;
  date?: string;
  supplier?: string;
  items?: { ingredientId: string; quantity: number; purchasePrice?: number; total?: number }[];
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
  return { create, update, complete, cancel };
}

// ---------- Движения ----------

export interface MovementsFilter {
  from?: string;
  to?: string;
  ingredientId?: string;
  type?: string;
  sourceType?: string;
  search?: string;
}

function movementsQuery(f: MovementsFilter) {
  const q = new URLSearchParams();
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
