import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/config/env';
import type { PaymentMethod } from '@/types';

export interface PublicSettings {
  cafeName: string;
  paymentMethods: PaymentMethod[];
  qrImageUrl: string | null;
  serviceChargeAmount: string;
}

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
