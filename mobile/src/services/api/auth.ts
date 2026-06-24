import { useMutation } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import type { AuthUser, LoginResponse } from '@/types';

export function useLogin() {
  return useMutation({
    mutationFn: async (vars: { phone: string; password: string }) =>
      (await api.post<LoginResponse>('/auth/login', vars)).data,
    retry: networkRetry,
  });
}

/** Проверка валидности сессии при старте (восстановление). */
export async function fetchMe(): Promise<AuthUser> {
  return (await api.get<AuthUser>('/auth/me')).data;
}
