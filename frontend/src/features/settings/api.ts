import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_URL } from '@/lib/api';
import type { PaymentMethod } from '@/types';

/** Преобразует значение QR из настроек в пригодный для <img src> адрес.
 *  Публичные настройки отдают лёгкую ссылку (/settings/qr?v=…), админские — data URL. */
export function resolveQrSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('http')) return value;
  return `${API_URL}/api${value.startsWith('/') ? value : `/${value}`}`;
}

export interface Settings {
  id: string;
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  receiptText: string;
  serviceChargeAmount: string;
  language: 'ru' | 'ky';
  payQr: boolean;
  payCash: boolean;
  payCard: boolean;
  qrImageUrl: string | null;
  printerConnected: boolean;
  shiftLocationEnabled: boolean;
  cafeLatitude: number | null;
  cafeLongitude: number | null;
  shiftLocationRadiusMeters: number;
  updatedAt: string;
}

export interface PublicSettings {
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  receiptText: string;
  serviceChargeAmount: string;
  language: 'ru' | 'ky';
  paymentMethods: PaymentMethod[];
  qrImageUrl: string | null;
  printerConnected: boolean;
  shiftLocationEnabled: boolean;
  shiftLocationRadiusMeters: number;
}

/** Публичные настройки (реквизиты + включённые способы оплаты) — для всех ролей. */
export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: async () => (await api.get<PublicSettings>('/settings')).data,
    staleTime: 30_000,
  });
}

/** Полные настройки — только владелец. */
export function useAdminSettings() {
  return useQuery({
    queryKey: ['settings', 'admin'],
    queryFn: async () => (await api.get<Settings>('/admin/settings')).data,
  });
}

export type SettingsInput = Partial<Omit<Settings, 'id' | 'updatedAt' | 'printerConnected' | 'serviceChargeAmount'>> & {
  serviceChargeAmount?: number;
};

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SettingsInput) =>
      (await api.patch<Settings>('/admin/settings', body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
