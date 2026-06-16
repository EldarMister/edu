import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import type { Order, OrderStatus, PaymentMethod, PrepStation, ReceiptPrintRequest, Role, TableStatus } from '@/types';

// ---------- Типы ответов ----------
export interface AdminTableItem {
  id: string;
  number: number;
  seats: number;
  status: TableStatus;
  isActive: boolean;
  hallId: string;
}
export interface AdminHall {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  tables: AdminTableItem[];
}
export interface AdminCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  prepStation: PrepStation;
  _count: { dishes: number };
}
export interface AdminDish {
  id: string;
  name: string;
  description: string | null;
  price: string;
  categoryId: string;
  category: { id: string; name: string };
  discountType: 'none' | 'percent' | 'fixed';
  discountValue: string;
  isAvailable: boolean;
  isActive: boolean;
  cookingTime: number | null;
  trackInventory?: boolean;
  stock?: number;
  initialStock?: number;
  unit?: string;
  prepStation: PrepStation | null;
  voiceName?: string | null;
  isSet?: boolean;
  setComponents?: AdminSetComponent[];
  variants: AdminDishVariant[];
}
export interface AdminSetComponent {
  id: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
  dishVariantId?: string | null;
  dish: { id: string; name: string; price: string };
  dishVariant?: { id: string; name: string; price: string } | null;
}
export interface AdminDishVariant {
  id: string;
  name: string;
  price: string;
  sortOrder: number;
  stock?: number;
  initialStock?: number;
  unit?: string;
}
export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  onShift: boolean;
}
export interface WaiterReportItem {
  id: string;
  name: string;
  revenue: number;
  closedOrders: number;
  cancelledOrders: number;
}
export interface OrdersPage {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export interface StatsDashboard {
  cards: {
    revenueToday: number;
    ordersToday: number;
    avgCheck: number;
    revenuePeriod: number;
    ordersPeriod: number;
  };
  trends: { revenue: number; orders: number; avgCheck: number };
  revenueSeries: { label: string; amount: number }[];
  peakHours: { hour: string; amount: number; orders: number }[];
  paymentMethods: { method: PaymentMethod; amount: number; percent: number }[];
  topDishes: { name: string; amount: number; count: number }[];
  topWaiters: { name: string; amount: number; orders: number; avgCheck: number }[];
  period: StatsPeriod;
  range: { from: string | null; to: string | null };
}

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userRole: Role | null;
  actionType: string;
  entityType: string;
  entityId: string | null;
  tableId: string | null;
  orderId: string | null;
  description: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: Record<string, unknown> | null;
}
export interface AuditLogPage {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
export interface AuditFilterOptions {
  users: { id: string; name: string }[];
  actionTypes: string[];
}

// ---------- Сверка оплат ----------
export type ReconStatus = 'matched' | 'not_found' | 'needs_review' | 'amount_mismatch' | 'extra';
export interface ReconRow {
  orderId: string | null;
  orderNumber: string | null;
  orderTime: string | null;
  posAmount: number | null;
  bankAmount: number | null;
  bankTime: string | null;
  timeDiffSec: number | null;
  paymentMethod: string | null;
  waiter: string | null;
  status: ReconStatus;
  comment: string;
}
export interface ReconResult {
  from: string | null;
  to: string | null;
  toleranceMin: number;
  stats: {
    paidCount: number;
    matched: number;
    notFound: number;
    needsReview: number;
    amountMismatch: number;
    extra: number;
  };
  rows: ReconRow[];
}

export function useReconcile() {
  return useMutation({
    mutationFn: async (vars: { file: File; from: string; to: string; toleranceMin: number }) => {
      const fd = new FormData();
      fd.append('file', vars.file);
      fd.append('from', vars.from);
      fd.append('to', vars.to);
      fd.append('toleranceMin', String(vars.toleranceMin));
      const { data } = await api.post<ReconResult>('/admin/reconciliation', fd);
      return data;
    },
  });
}

// ---------- Хелперы ----------
const get = async <T,>(url: string) => (await api.get<T>(url)).data;

function useInvalidate(keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

// ========== СТАТИСТИКА ==========
export type StatsPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';

export function useStatistics(params: { period: StatsPeriod; from?: string; to?: string }) {
  const q = new URLSearchParams();
  q.set('period', params.period);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  return useQuery({
    queryKey: ['admin', 'stats', params],
    queryFn: () => get<StatsDashboard>(`/admin/statistics?${q.toString()}`),
  });
}

// ========== ЗАКАЗЫ ==========
export function useOrdersOverview() {
  return useQuery({
    queryKey: ['admin', 'orders', 'overview'],
    queryFn: () =>
      get<{ ordersToday: number; activeCount: number; paidCount: number; cancelledCount: number }>(
        '/admin/orders/overview',
      ),
  });
}
export interface OrdersFilter {
  tab: string;
  search: string;
  page: number;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  waiterId?: string;
}

function ordersQueryString(params: Partial<OrdersFilter>) {
  const q = new URLSearchParams();
  if (params.tab && params.tab !== 'all') q.set('tab', params.tab);
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.paymentMethod) q.set('paymentMethod', params.paymentMethod);
  if (params.waiterId) q.set('waiterId', params.waiterId);
  return q;
}

export function useAdminOrders(params: OrdersFilter) {
  const q = ordersQueryString(params);
  q.set('page', String(params.page));
  q.set('pageSize', '10');
  return useQuery({
    queryKey: ['admin', 'orders', 'list', params],
    queryFn: () => get<OrdersPage>(`/admin/orders?${q.toString()}`),
  });
}

/** Бесконечная подгрузка заказов (длинный список вместо страниц). */
export function useAdminOrdersInfinite(filters: Omit<OrdersFilter, 'page'> & { tab: string }) {
  const PAGE_SIZE = 30;
  return useInfiniteQuery({
    queryKey: ['admin', 'orders', 'infinite', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const q = ordersQueryString(filters);
      q.set('page', String(pageParam));
      q.set('pageSize', String(PAGE_SIZE));
      return get<OrdersPage>(`/admin/orders?${q.toString()}`);
    },
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
}

export function useAdminOrderDetails(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'orders', 'detail', id],
    queryFn: () => get<Order>(`/orders/${id}`),
    enabled: !!id,
  });
}

/** Результат пробития фискального чека (ответ /fiscal/...). */
export interface FiscalResult {
  success: boolean;
  fiscalReceiptNumber?: string;
  fiscalSign?: string;
  qrCode?: string;
  error?: string;
}

/** Повторить (или впервые пробить) фискальный чек ККМ по заказу — кнопка «Повторить». */
export function useRetryFiscal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<FiscalResult>(`/fiscal/orders/${orderId}/retry`).then((r) => r.data),
    onSuccess: (_data, orderId) => {
      qc.invalidateQueries({ queryKey: ['admin', 'orders', 'detail', orderId] });
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

/** Фискализация при печати чека (идемпотентно). Возвращает данные для печати фискального чека. */
export function useFiscalizeForPrint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<FiscalResult | null>(`/fiscal/orders/${orderId}/print`).then((r) => r.data),
    onSuccess: (_data, orderId) => {
      qc.invalidateQueries({ queryKey: ['admin', 'orders', 'detail', orderId] });
    },
  });
}

export interface OrdersSummary {
  total: number;
  paid: number;
  unpaid: number;
  cancelled: number;
  revenue: number;
}

/** Сводка по периоду/фильтрам — для строки итогов (статус-фильтр игнорируется). */
export function useOrdersSummary(params: Omit<OrdersFilter, 'page' | 'tab'>) {
  const q = ordersQueryString(params);
  return useQuery({
    queryKey: ['admin', 'orders', 'summary', params],
    queryFn: () => get<OrdersSummary>(`/admin/orders/summary?${q.toString()}`),
  });
}

/** Отмена заказа (с причиной) — официант/админ/владелец. */
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason?: string }) =>
      api.post<Order>(`/orders/${orderId}/cancel`, { reason }).then((r) => r.data),
    onSuccess: (order) => {
      applyOrderStatusToCache(qc, order);
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'halls'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, status, reason }: { orderId: string; status: OrderStatus; reason?: string }) =>
      api.patch<Order>(`/admin/orders/${orderId}/status`, { status, reason }).then((r) => r.data),
    onSuccess: (order) => {
      applyOrderStatusToCache(qc, order);
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'halls'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
      qc.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

// ========== ЖУРНАЛ ДЕЙСТВИЙ (АУДИТ) ==========
export interface AuditQueryParams {
  from?: string;
  to?: string;
  userId?: string;
  actionType?: string;
  page: number;
}
export function useAuditLogs(params: AuditQueryParams) {
  const q = new URLSearchParams();
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.userId) q.set('userId', params.userId);
  if (params.actionType) q.set('actionType', params.actionType);
  q.set('page', String(params.page));
  q.set('limit', '50');
  return useQuery({
    queryKey: ['audit', 'list', params],
    queryFn: () => get<AuditLogPage>(`/audit-logs?${q.toString()}`),
  });
}
export function useAuditFilters() {
  return useQuery({
    queryKey: ['audit', 'filters'],
    queryFn: () => get<AuditFilterOptions>('/audit-logs/filters'),
  });
}

// ========== СТОЛЫ И ЗАЛЫ ==========
export function useTablesOverview() {
  return useQuery({
    queryKey: ['admin', 'tables', 'overview'],
    queryFn: () =>
      get<{ hallsCount: number; tablesCount: number; activeTablesCount: number; occupiedCount: number }>(
        '/admin/tables/overview',
      ),
  });
}
export function useAdminHalls() {
  return useQuery({ queryKey: ['admin', 'halls'], queryFn: () => get<AdminHall[]>('/admin/halls') });
}

export function useHallMutations() {
  const invalidate = useInvalidate([['admin', 'halls'], ['admin', 'tables', 'overview']]);
  const create = useMutation({
    mutationFn: (b: { name: string }) => api.post('/admin/halls', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string; name?: string; isActive?: boolean }) =>
      api.patch(`/admin/halls/${id}`, b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/halls/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useTableMutations() {
  const invalidate = useInvalidate([['admin', 'halls'], ['admin', 'tables', 'overview']]);
  const create = useMutation({
    mutationFn: (b: { hallId: string; number: number; seats: number }) =>
      api.post('/admin/tables', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string; number?: number; seats?: number; isActive?: boolean }) =>
      api.patch(`/admin/tables/${id}`, b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/tables/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ========== МЕНЮ ==========
export function useMenuOverview() {
  return useQuery({
    queryKey: ['admin', 'menu', 'overview'],
    queryFn: () =>
      get<{ dishesCount: number; categoriesCount: number; activeDishesCount: number; avgPrice: number }>(
        '/admin/menu/overview',
      ),
  });
}
export function useAdminCategories() {
  return useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => get<AdminCategory[]>('/admin/categories'),
  });
}
export function useAdminDishes(categoryId: string, search: string) {
  const q = new URLSearchParams();
  if (categoryId) q.set('categoryId', categoryId);
  if (search) q.set('search', search);
  return useQuery({
    queryKey: ['admin', 'dishes', categoryId, search],
    queryFn: () => get<AdminDish[]>(`/admin/dishes?${q.toString()}`),
  });
}

export function useCategoryMutations() {
  const invalidate = useInvalidate([
    ['admin', 'categories'],
    ['admin', 'menu', 'overview'],
    ['admin', 'dishes'],
  ]);
  const create = useMutation({
    mutationFn: (b: { name: string; prepStation?: PrepStation }) =>
      api.post('/admin/categories', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string; name?: string; isActive?: boolean; prepStation?: PrepStation; sortOrder?: number }) =>
      api.patch(`/admin/categories/${id}`, b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ id, strategy, targetCategoryId }: { id: string; strategy?: 'move' | 'delete'; targetCategoryId?: string }) =>
      api.delete(`/admin/categories/${id}`, { data: { strategy, targetCategoryId } }).then((r) => r.data),
    onSuccess: invalidate,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.patch('/admin/categories/reorder', { ids }).then((r) => r.data),
    onSuccess: invalidate,
  });
  const moveDishes = useMutation({
    mutationFn: (b: { fromCategoryId: string; toCategoryId: string }) =>
      api.post('/admin/categories/move-dishes', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove, reorder, moveDishes };
}

export interface DishInput {
  name: string;
  categoryId: string;
  price?: number;
  description?: string;
  discountType?: 'none' | 'percent' | 'fixed';
  discountValue?: number;
  isAvailable?: boolean;
  isActive?: boolean;
  trackInventory?: boolean;
  stock?: number;
  initialStock?: number;
  unit?: string;
  prepStation?: PrepStation | null;
  voiceName?: string | null;
  variants?: { id?: string; name: string; price: number; stock?: number; initialStock?: number; unit?: string }[];
}
export function useDishMutations() {
  const invalidate = useInvalidate([['admin', 'dishes'], ['admin', 'menu', 'overview']]);
  const create = useMutation({
    mutationFn: (b: DishInput) => api.post('/admin/dishes', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string } & Partial<DishInput>) =>
      api.patch(`/admin/dishes/${id}`, b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/dishes/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ---------- Сеты ----------
export interface SetComponentInput {
  dishId: string;
  dishVariantId?: string;
  quantity?: number;
  removable?: boolean;
  replaceable?: boolean;
}
export interface SetInput {
  name: string;
  price: number;
  components: SetComponentInput[];
}
export function useAdminSets() {
  return useQuery({
    queryKey: ['admin', 'sets'],
    queryFn: () => get<AdminDish[]>('/admin/sets'),
  });
}
export function useSetMutations() {
  const invalidate = useInvalidate([
    ['admin', 'sets'],
    ['admin', 'dishes'],
    ['admin', 'menu', 'overview'],
    ['admin', 'categories'],
  ]);
  const create = useMutation({
    mutationFn: (b: SetInput) => api.post('/admin/sets', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string } & Partial<SetInput> & { isActive?: boolean }) =>
      api.patch(`/admin/sets/${id}`, b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/sets/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ========== ПЕРСОНАЛ ==========
export function useStaffOverview() {
  return useQuery({
    queryKey: ['admin', 'staff', 'overview'],
    queryFn: () =>
      get<{
        totalStaff: number;
        adminsCount: number;
        waitersCount: number;
        kitchenCount: number;
        onShiftCount: number;
      }>('/admin/staff/overview'),
  });
}

export function useWaiterReport(period: 'today' | 'week' | 'month', date?: string) {
  const q = new URLSearchParams();
  q.set('period', period);
  if (date) q.set('date', date);
  return useQuery({
    queryKey: ['admin', 'staff', 'waiter-report', period, date],
    queryFn: () => get<WaiterReportItem[]>(`/admin/staff/waiter-report?${q.toString()}`),
  });
}
// ---------- Отчёт по сменам ----------
export interface ShiftReportItem {
  name: string;
  qty: number;
  amount: number;
  /** Состав сета (если позиция — сет): что входит и сколько. */
  components?: { name: string; qty: number }[];
}
export interface ShiftReportCategory {
  categoryId: string;
  name: string;
  qty: number;
  amount: number;
  items: ShiftReportItem[];
}
export interface ShiftReportCancellation {
  time: string;
  name: string;
  amount: number;
  reason: string;
}
export interface ShiftReportRow {
  waiterId: string;
  name: string;
  role: Role;
  /** Развёрнутый отчёт по смене (касса, разбивка, отмены) — только для официантов. */
  isWaiter: boolean;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftOpen: boolean;
  durationMin: number | null;
  turnover: number;
  cashDue: number;
  cashHanded: number;
  difference: number;
  categories: ShiftReportCategory[];
  cancellations: ShiftReportCancellation[];
}

export function useShiftReport(date: string) {
  const q = new URLSearchParams();
  if (date) q.set('date', date);
  return useQuery({
    queryKey: ['admin', 'staff', 'shift-report', date],
    queryFn: () => get<ShiftReportRow[]>(`/admin/staff/shift-report?${q.toString()}`),
  });
}

export type ShiftHistoryPeriod = 'today' | 'week' | 'month' | 'custom';
export type ShiftHistoryStatus = 'active' | 'closed' | 'unclosed';
export interface ShiftHistoryFilters {
  period: ShiftHistoryPeriod;
  from?: string;
  to?: string;
  employeeId?: string;
  role?: Role | '';
}
export interface ShiftHistoryOrder {
  id: string;
  orderNumber: string;
  amount: number;
}
export interface ShiftHistoryRow {
  id: string;
  employeeId: string;
  employeeName: string;
  role: Role;
  startedAt: string;
  endedAt: string | null;
  durationMin: number;
  status: ShiftHistoryStatus;
  closedBy: string | null;
  adminComment: string | null;
  ordersCount: number;
  turnover: number;
  orders: ShiftHistoryOrder[];
}
export interface ShiftHistoryResponse {
  items: ShiftHistoryRow[];
  summary: {
    shiftsCount: number;
    totalDurationMin: number;
    activeCount: number;
  };
  range: { from: string; to: string };
}

export function useShiftHistory(filters: ShiftHistoryFilters) {
  const q = new URLSearchParams();
  q.set('period', filters.period);
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  if (filters.employeeId) q.set('employeeId', filters.employeeId);
  if (filters.role) q.set('role', filters.role);
  return useQuery({
    queryKey: ['admin', 'staff', 'shift-history', filters],
    queryFn: () => get<ShiftHistoryResponse>(`/admin/staff/shift-history?${q.toString()}`),
  });
}

export function useShiftHistoryActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'staff', 'shift-history'] });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; startedAt?: string; endedAt?: string | null }) =>
      api.patch(`/admin/staff/shift-history/${id}`, body).then((r) => r.data),
    onSuccess: invalidate,
  });
  const close = useMutation({
    mutationFn: (id: string) => api.post(`/admin/staff/shift-history/${id}/close`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { update, close };
}

export function useSetCashHanded() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { waiterId: string; date?: string; cashHanded: number }) =>
      api.post('/admin/staff/cash-handed', b).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'staff', 'shift-report'] }),
  });
}

export function useStaff(role: string, search: string) {
  const q = new URLSearchParams();
  if (role) q.set('role', role);
  if (search) q.set('search', search);
  return useQuery({
    queryKey: ['admin', 'staff', role, search],
    queryFn: () => get<StaffMember[]>(`/admin/staff?${q.toString()}`),
  });
}
export interface StaffInput {
  name: string;
  phone: string;
  role: Role;
  password?: string;
  isActive?: boolean;
}
export function useStaffMutations() {
  const invalidate = useInvalidate([['admin', 'staff'], ['admin', 'staff', 'overview']]);
  const create = useMutation({
    mutationFn: (b: StaffInput) => api.post('/admin/staff', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string } & Partial<StaffInput>) =>
      api.patch(`/admin/staff/${id}`, b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/staff/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

// ========== ПЕЧАТЬ ЧЕКА ==========
export function useReceiptPrintRequests() {
  return useQuery({
    queryKey: ['admin', 'receipt-prints'],
    queryFn: () => get<ReceiptPrintRequest[]>('/receipt-prints'),
    refetchInterval: 60_000,
  });
}

export function useReceiptPrintActions() {
  const invalidate = useInvalidate([['admin', 'receipt-prints']]);
  const approve = useMutation({
    mutationFn: (id: string) => api.post<ReceiptPrintRequest>(`/receipt-prints/${id}/approve`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const printed = useMutation({
    mutationFn: (id: string) => api.post<ReceiptPrintRequest>(`/receipt-prints/${id}/printed`).then((r) => r.data),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.post<ReceiptPrintRequest>(`/receipt-prints/${id}/reject`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { approve, printed, reject };
}
