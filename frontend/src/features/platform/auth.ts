import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PlatformAdmin {
  id: string;
  login: string;
  name: string;
}

interface PlatformAuthState {
  token: string | null;
  admin: PlatformAdmin | null;
  setSession: (token: string, admin: PlatformAdmin) => void;
  logout: () => void;
}

/** Отдельная от персонала сессия супер-админа платформы. */
export const usePlatformAuth = create<PlatformAuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      setSession: (token, admin) => set({ token, admin }),
      logout: () => set({ token: null, admin: null }),
    }),
    { name: 'edu-pos-platform-auth' },
  ),
);
