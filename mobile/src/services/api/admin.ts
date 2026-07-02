import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { applyOrderStatusToCache } from '@/utils/orderCache';
import type { Order, OrderStatus, PaymentMethod, Role, TableStatus } from '@/types';

const get = async <T,>(url: string) => (await api.get<T>(url)).data;

function useInvalidate(keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

// ---------- Статистика (порт PWA features/admin/api useStatistics) ----------
export type StatsPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';

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

export function useStatistics(params: { period: StatsPeriod; from?: string; to?: string }) {
  // Query строим вручную (URLSearchParams в RN ненадёжен).
  const parts = [`period=${params.period}`];
  if (params.from) parts.push(`from=${params.from}`);
  if (params.to) parts.push(`to=${params.to}`);
  const query = parts.join('&');
  return useQuery({
    queryKey: ['admin', 'stats', params],
    queryFn: async () => (await api.get<StatsDashboard>(`/admin/statistics?${query}`)).data,
  });
}

// ---------- Заказы (порт PWA features/admin/api) ----------
export interface AdminOrdersPage {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export interface OrdersFilter {
  tab: string;
  search: string;
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  waiterId?: string;
}
export interface OrdersSummary {
  total: number;
  paid: number;
  unpaid: number;
  cancelled: number;
  revenue: number;
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
export interface FiscalResult {
  success: boolean;
  fiscalReceiptNumber?: string;
  fiscalSign?: string;
  qrCode?: string;
  error?: string;
}

function ordersQuery(params: Partial<OrdersFilter>): string {
  const parts: string[] = [];
  if (params.tab && params.tab !== 'all') parts.push(`tab=${encodeURIComponent(params.tab)}`);
  if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
  if (params.dateFrom) parts.push(`dateFrom=${params.dateFrom}`);
  if (params.dateTo) parts.push(`dateTo=${params.dateTo}`);
  if (params.paymentMethod) parts.push(`paymentMethod=${params.paymentMethod}`);
  if (params.waiterId) parts.push(`waiterId=${params.waiterId}`);
  return parts.join('&');
}

/** Бесконечная подгрузка заказов (длинный список). */
export function useAdminOrdersInfinite(filters: OrdersFilter) {
  const PAGE_SIZE = 30;
  return useInfiniteQuery({
    queryKey: ['admin', 'orders', 'infinite', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const base = ordersQuery(filters);
      const q = `${base ? `${base}&` : ''}page=${pageParam}&pageSize=${PAGE_SIZE}`;
      return get<AdminOrdersPage>(`/admin/orders?${q}`);
    },
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
}

/** Сводка по фильтрам — для строки итогов (статус-фильтр игнорируется). */
export function useOrdersSummary(params: Omit<OrdersFilter, 'tab'>) {
  const q = ordersQuery(params);
  return useQuery({
    queryKey: ['admin', 'orders', 'summary', params],
    queryFn: () => get<OrdersSummary>(`/admin/orders/summary${q ? `?${q}` : ''}`),
  });
}

export function useAdminOrderDetails(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'orders', 'detail', id],
    queryFn: () => get<Order>(`/orders/${id}`),
    enabled: !!id,
  });
}

export function useStaff(role: string, search: string) {
  const parts: string[] = [];
  if (role) parts.push(`role=${role}`);
  if (search) parts.push(`search=${encodeURIComponent(search)}`);
  const q = parts.join('&');
  return useQuery({
    queryKey: ['admin', 'staff', role, search],
    queryFn: () => get<StaffMember[]>(`/admin/staff${q ? `?${q}` : ''}`),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason?: string }) =>
      api.post<Order>(`/orders/${orderId}/cancel`, { reason }).then((r) => r.data),
    onSuccess: (order) => {
      applyOrderStatusToCache(qc, order);
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
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
      qc.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

/** Повторить пробитие фискального чека ККМ по заказу. */
export function useRetryFiscal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.post<FiscalResult>(`/fiscal/orders/${orderId}/retry`).then((r) => r.data),
    onSuccess: (_data, orderId) => {
      qc.invalidateQueries({ queryKey: ['admin', 'orders', 'detail', orderId] });
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// ---------- Столы и залы (порт PWA) ----------
export interface AdminTableItem {
  id: string;
  number: number;
  seats: number;
  status: TableStatus;
  isActive: boolean;
  hallId: string;
  qrToken?: string;
}
export interface AdminHall {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  tables: AdminTableItem[];
}

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
