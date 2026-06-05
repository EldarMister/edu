import { create } from 'zustand';
import type { AppNotification } from '@/types';

interface NotifyState {
  toasts: AppNotification[];
  history: AppNotification[];
  push: (n: Omit<AppNotification, 'id'>) => void;
  dismiss: (id: string) => void;
  clearHistory: () => void;
}

let counter = 0;

export const useNotifications = create<NotifyState>((set) => ({
  toasts: [],
  history: [],
  push: (n) =>
    set((s) => {
      const item: AppNotification = { ...n, id: `n${++counter}` };
      return { toasts: [...s.toasts, item], history: [item, ...s.history].slice(0, 50) };
    }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearHistory: () => set({ history: [] }),
}));
