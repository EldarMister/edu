import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import type { AuthUser } from '@/types';
import { activeWorkspace, homeWorkspace, type Workspace } from '@/lib/workspaces';
import { queryClient } from '@/lib/queryClient';
import { useCart } from './cart';
import { useReplacement } from './replacement';
import { useReceiptPrint } from './receiptPrint';
import { useNotifications } from './notifications';

const sessionCleanups = new Set<() => void>();

/** Services register here so auth never imports their API/audio dependencies. */
export function registerSessionCleanup(cleanup: () => void) {
  sessionCleanups.add(cleanup);
  return () => sessionCleanups.delete(cleanup);
}

function clearSessionData() {
  for (const cleanup of sessionCleanups) cleanup();
  queryClient.clear();
  useCart.getState().resetAll();
  useReplacement.getState().clear();
  useReceiptPrint.getState().dismiss();
  useNotifications.setState({ toasts: [], history: [] });
}

/**
 * Защищённое хранилище токенов (Keychain/Keystore через expo-secure-store).
 * Значения зашифрованы на устройстве — безопаснее AsyncStorage для JWT.
 */
const secureStorage: StateStorage = {
  getItem: (name) => SecureStore.getItemAsync(name),
  setItem: (name, value) => SecureStore.setItemAsync(name, value),
  removeItem: (name) => SecureStore.deleteItemAsync(name),
};

interface AuthState {
  user: AuthUser | null;
  workspace: Workspace | null;
  setWorkspace: (workspace: Workspace) => void;
  accessToken: string | null;
  refreshToken: string | null;
  /** Гидрация persist завершена — можно решать про редирект (login vs рабочий экран). */
  hydrated: boolean;
  setHydrated: () => void;
  setSession: (data: { user: AuthUser; accessToken: string; refreshToken: string }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      workspace: null,
      setWorkspace: (workspace) => {
        const { user, workspace: current } = get();
        if (!user || workspace === current || activeWorkspace(user, workspace) !== workspace) return;
        queryClient.clear();
        useReceiptPrint.getState().dismiss();
        set({ workspace });
      },
      accessToken: null,
      refreshToken: null,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      setSession: (data) => {
        clearSessionData();
        set({
          user: data.user,
          workspace: homeWorkspace(data.user),
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
      },
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      updateUser: (patch) => {
        const state = get();
        if (!state.user) return;
        const user = { ...state.user, ...patch };
        const workspace = activeWorkspace(user, state.workspace);
        if (workspace !== state.workspace) {
          queryClient.clear();
          useReceiptPrint.getState().dismiss();
        }
        set({ user, workspace });
      },
      logout: () => {
        // Чистим кэш, чтобы при входе другого пользователя не «мигали» чужие данные.
        clearSessionData();
        set({ user: null, workspace: null, accessToken: null, refreshToken: null });
      },
    }),
    {
      name: 'edu-pos-auth',
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({
        user: state.user,
        workspace: state.workspace,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (state.user) useAuth.setState({ workspace: activeWorkspace(state.user, state.workspace) });
          state.setHydrated();
        }
        else useAuth.setState({ hydrated: true });
      },
    },
  ),
);
