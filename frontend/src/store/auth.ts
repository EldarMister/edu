import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { queryClient } from '@/lib/queryClient';
import type { AuthUser } from '@/types';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (data: { user: AuthUser; accessToken: string; refreshToken: string }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  /** Обновить поля текущего пользователя (например, актуальные права из /auth/me). */
  updateUser: (patch: Partial<AuthUser>) => void;
  logout: () => void;
}

type StoredSession = Pick<AuthState, 'user' | 'accessToken' | 'refreshToken'>;
export const authStorageKey = 'edu-pos-auth';

function sharedSession() {
  try {
    return JSON.parse(localStorage.getItem(authStorageKey) ?? 'null')?.state as StoredSession | undefined;
  } catch {
    return undefined;
  }
}

function saveSharedSession(state: StoredSession) {
  try {
    localStorage.setItem(authStorageKey, JSON.stringify({ state, version: 0 }));
  } catch {
    // The tab session remains available if persistent browser storage is blocked.
  }
}

function createTabStorage() {
  // Every open tab pins its own session before another tab can overwrite the shared default.
  return {
    getItem: (name: string) => {
      const own = sessionStorage.getItem(name);
      if (own !== null) return own;
      const inherited = localStorage.getItem(name);
      if (inherited !== null) sessionStorage.setItem(name, inherited);
      return inherited;
    },
    setItem: (name: string, value: string) => sessionStorage.setItem(name, value),
    removeItem: (name: string) => sessionStorage.removeItem(name),
  };
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: ({ user, accessToken, refreshToken }) => {
        const session = { user, accessToken, refreshToken };
        queryClient.clear();
        set(session);
        saveSharedSession(session);
      },
      setTokens: (accessToken, refreshToken) => {
        const previous = get();
        set({ accessToken, refreshToken });
        const shared = sharedSession();
        if (shared?.user?.id === previous.user?.id && shared?.refreshToken === previous.refreshToken) {
          saveSharedSession({ user: previous.user, accessToken, refreshToken });
        }
      },
      updateUser: (patch) => {
        const previous = get();
        if (!previous.user) return;
        const user = { ...previous.user, ...patch };
        set({ user });
        const shared = sharedSession();
        if (shared?.user?.id === user.id && shared.refreshToken === previous.refreshToken) {
          saveSharedSession({ ...shared, user });
        }
      },
      logout: () => {
        // Чистим React Query кэш, чтобы при логине другого пользователя на этом же
        // устройстве не «мигали» чужие данные (мультитенантная гигиена).
        queryClient.clear();
        const shared = sharedSession();
        const empty = { user: null, accessToken: null, refreshToken: null };
        if (shared?.user?.id && shared.user.id === get().user?.id) saveSharedSession(empty);
        set(empty);
      },
    }),
    {
      name: authStorageKey,
      storage: createJSONStorage(createTabStorage),
      partialize: ({ user, accessToken, refreshToken }) => ({ user, accessToken, refreshToken }),
    },
  ),
);
