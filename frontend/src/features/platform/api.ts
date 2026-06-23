import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import { usePlatformAuth } from './auth';

/** Отдельный axios для платформы — со своим токеном супер-админа. */
export const platformApi = axios.create({ baseURL: `${API_URL}/api`, headers: { 'Content-Type': 'application/json' } });

platformApi.interceptors.request.use((config) => {
  const token = usePlatformAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

platformApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) usePlatformAuth.getState().logout();
    return Promise.reject(err);
  },
);

export type CafeStatus = 'active' | 'suspended';

export interface PlatformCafe {
  id: string;
  name: string;
  status: CafeStatus;
  paidUntil: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  staffCount: number;
  ordersCount: number;
}

export interface AppHealth {
  status: 'ok' | 'warning' | 'degraded';
  env: string;
  commit: string | null;
  time: string;
  database: 'ok' | 'error';
  migrations: { localCount: number; appliedCount: number; behind: boolean; failed: string[]; latestApplied: string | null };
  error?: string;
}

export interface AppMemory {
  uptimeSec: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
}

const cafesKey = ['platform', 'cafes'] as const;

export function usePlatformLogin() {
  return useMutation({
    mutationFn: async (body: { login: string; password: string }) =>
      (await platformApi.post<{ accessToken: string; admin: { id: string; login: string; name: string } }>(
        '/platform/auth/login',
        body,
      )).data,
  });
}

export function useCafes() {
  return useQuery({
    queryKey: cafesKey,
    queryFn: async () => (await platformApi.get<PlatformCafe[]>('/platform/cafes')).data,
    refetchInterval: 30_000,
  });
}

export function useCreateCafe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { cafeName: string; ownerName: string; ownerPhone: string; ownerPassword: string }) =>
      (await platformApi.post('/platform/cafes', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: cafesKey }),
  });
}

export function useSuspendCafe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) =>
      (await platformApi.post(`/platform/cafes/${id}/suspend`, { reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: cafesKey }),
  });
}

export function useResumeCafe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await platformApi.post(`/platform/cafes/${id}/resume`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: cafesKey }),
  });
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paidUntil }: { id: string; paidUntil: string | null }) =>
      (await platformApi.patch(`/platform/cafes/${id}/subscription`, { paidUntil })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: cafesKey }),
  });
}

export type CleanupScope = 'orders' | 'menu' | 'warehouse';

export interface CafeStaff {
  id: string;
  name: string;
  phone: string;
  role: string;
  isActive: boolean;
}

export function useCleanupCafe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scopes }: { id: string; scopes: CleanupScope[] }) =>
      (await platformApi.post(`/platform/cafes/${id}/cleanup`, { scopes })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: cafesKey }),
  });
}

export function useDeleteCafe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, confirmName }: { id: string; confirmName: string }) =>
      (await platformApi.delete(`/platform/cafes/${id}`, { data: { confirmName } })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: cafesKey }),
  });
}

export function useCafeStaff(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['platform', 'staff', id],
    queryFn: async () => (await platformApi.get<CafeStaff[]>(`/platform/cafes/${id}/staff`)).data,
    enabled,
  });
}

export function useSetStaffActive(cafeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      (await platformApi.patch(`/platform/cafes/${cafeId}/staff/${userId}`, { isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'staff', cafeId] }),
  });
}

export function useDeleteStaff(cafeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      (await platformApi.delete(`/platform/cafes/${cafeId}/staff/${userId}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'staff', cafeId] });
      qc.invalidateQueries({ queryKey: cafesKey });
    },
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['platform', 'health'],
    queryFn: async () => (await platformApi.get<AppHealth>('/health')).data,
    refetchInterval: 15_000,
  });
}

export function useMemory() {
  return useQuery({
    queryKey: ['platform', 'memory'],
    queryFn: async () => (await platformApi.get<AppMemory>('/health/memory')).data,
    refetchInterval: 15_000,
  });
}
