import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { queryClient } from '@/lib/queryClient';

type PlatformAdmin = { id: string; login: string; name: string };
interface PlatformAuthState {
  token: string | null;
  admin: PlatformAdmin | null;
  hydrated: boolean;
  setHydrated: () => void;
  setSession: (token: string, admin: PlatformAdmin) => void;
  logout: () => void;
}
export const usePlatformAuth = create<PlatformAuthState>()(persist(set => ({
  token: null, admin: null, hydrated: false,
  setHydrated: () => set({ hydrated: true }),
  setSession: (token, admin) => { queryClient.removeQueries({ queryKey: ['platform'] }); set({ token, admin }); },
  logout: () => { queryClient.removeQueries({ queryKey: ['platform'] }); set({ token: null, admin: null }); },
}), {
  name: 'edu-pos-platform-auth',
  storage: createJSONStorage(() => ({ getItem: SecureStore.getItemAsync, setItem: SecureStore.setItemAsync, removeItem: SecureStore.deleteItemAsync })),
  partialize: state => ({ token: state.token, admin: state.admin }),
  onRehydrateStorage: () => state => { if (state) state.setHydrated(); else usePlatformAuth.setState({ hydrated: true }); },
}));
