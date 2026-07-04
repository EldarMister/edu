import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/config/env';
import type { PaymentMethod } from '@/types';

export interface PublicSettings {
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string | null;
  website: string | null;
  receiptText: string;
  language: 'ru' | 'ky';
  paymentMethods: PaymentMethod[];
  qrImageUrl: string | null;
  printerConnected: boolean;
  fiscalEnabled: boolean;
  serviceChargeAmount: string;
}

export interface Settings {
  id: string;
  cafeId: string | null;
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string | null;
  website: string | null;
  receiptText: string;
  serviceChargeAmount: string;
  language: 'ru' | 'ky';
  payQr: boolean;
  payCash: boolean;
  payCard: boolean;
  qrImageUrl: string | null;
  printerConnected: boolean;
  queueDisplayEnabled: boolean;
  queueDisplayMode: 'table' | 'number';
  queueDisplayCode: string | null;
  qrGeoEnabled: boolean;
  qrGeoLat: number | null;
  qrGeoLng: number | null;
  qrGeoRadius: number;
  fiscalProvider: string | null;
  fiscalEkassaApiKey: string | null;
  fiscalEkassaUrl: string | null;
  fiscalEkassaInn: string | null;
  fiscalYakassaApiKey: string | null;
  fiscalYakassaUrl: string | null;
  updatedAt: string;
}

export type SettingsInput = Partial<
  Omit<Settings, 'id' | 'cafeId' | 'queueDisplayCode' | 'updatedAt' | 'printerConnected' | 'serviceChargeAmount'>
> & {
  serviceChargeAmount?: number;
};

/** QR из настроек → пригодный для <Image source>. */
export function resolveQrSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('http')) return value;
  return `${API_URL}/api${value.startsWith('/') ? value : `/${value}`}`;
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: async () => (await api.get<PublicSettings>('/settings')).data,
    staleTime: 60_000,
  });
}

/** Полные настройки — только владелец. */
export function useAdminSettings() {
  return useQuery({
    queryKey: ['settings', 'admin'],
    queryFn: async () => (await api.get<Settings>('/admin/settings')).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Проверка соединения с ККМ. */
export function useTestFiscalConnection() {
  return useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean }>('/fiscal/test-connection')).data,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: async (patch: SettingsInput) => {
      await qc.cancelQueries({ queryKey: ['settings', 'admin'] });
      const previous = qc.getQueryData<Settings>(['settings', 'admin']);
      if (previous) {
        const { serviceChargeAmount, ...restPatch } = patch;
        qc.setQueryData<Settings>(['settings', 'admin'], {
          ...previous,
          ...restPatch,
          ...(serviceChargeAmount !== undefined ? { serviceChargeAmount: String(serviceChargeAmount) } : {}),
          updatedAt: new Date().toISOString(),
        });
      }
      return { previous };
    },
    mutationFn: async (body: SettingsInput) => (await api.patch<Settings>('/admin/settings', body)).data,
    onError: (_error, _patch, context) => {
      if (context?.previous) qc.setQueryData(['settings', 'admin'], context.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'admin'], data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
  });
}
