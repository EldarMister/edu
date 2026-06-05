import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Order, PaymentMethod, Role, TableStatus } from '@/types';

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
export interface OrdersPage {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export interface StatsDashboard {
  cards: { revenueToday: number; ordersToday: number; avgCheck: number; revenuePeriod: number };
  revenueSeries: { date: string; amount: number }[];
  paymentMethods: { method: PaymentMethod; amount: number; percent: number }[];
  topDishes: { name: string; amount: number; count: number }[];
  topWaiters: { name: string; amount: number; orders: number }[];
  period: 'week' | 'month' | 'year';
}

// ---------- Хелперы ----------
const get = async <T,>(url: string) => (await api.get<T>(url)).data;

function useInvalidate(keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

// ========== СТАТИСТИКА ==========
export function useStatistics(period: 'week' | 'month' | 'year') {
  return useQuery({
    queryKey: ['admin', 'stats', period],
    queryFn: () => get<StatsDashboard>(`/admin/statistics?period=${period}`),
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
export function useAdminOrders(params: {
  tab: string;
  search: string;
  page: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const q = new URLSearchParams();
  q.set('tab', params.tab);
  if (params.search) q.set('search', params.search);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  q.set('page', String(params.page));
  q.set('pageSize', '10');
  return useQuery({
    queryKey: ['admin', 'orders', 'list', params],
    queryFn: () => get<OrdersPage>(`/admin/orders?${q.toString()}`),
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
    mutationFn: (b: { name: string }) => api.post('/admin/categories', b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: string; name?: string; isActive?: boolean }) =>
      api.patch(`/admin/categories/${id}`, b).then((r) => r.data),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/categories/${id}`).then((r) => r.data),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export interface DishInput {
  name: string;
  categoryId: string;
  price: number;
  description?: string;
  discountType?: 'none' | 'percent' | 'fixed';
  discountValue?: number;
  isAvailable?: boolean;
  isActive?: boolean;
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
