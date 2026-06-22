import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { queryClient } from '@/lib/queryClient';
import type { AuthUser } from '@/types';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (data: { user: AuthUser; accessToken: string; refreshToken: string }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (data) =>
        set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      logout: () => {
        // Чистим React Query кэш, чтобы при логине другого пользователя на этом же
        // устройстве не «мигали» чужие данные (мультитенантная гигиена).
        queryClient.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },
    }),
    { name: 'edu-pos-auth' },
  ),
);

// Доступ к токенам вне React (для axios/socket).
export const authStorageKey = 'edu-pos-auth';
