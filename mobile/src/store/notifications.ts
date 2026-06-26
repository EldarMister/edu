import { create } from 'zustand';

export type NotificationType = 'info' | 'success' | 'error';

export interface AppNotification {
  id: string;
  message: string;
  type?: NotificationType;
  at: string;
  durationMs?: number;
}

interface NotifyState {
  toasts: AppNotification[];
  history: AppNotification[];
  push: (n: Omit<AppNotification, 'id'>) => void;
  dismiss: (id: string) => void;
  clearHistory: () => void;
}

let counter = 0;
const MAX_TOASTS = 4;

export const useNotifications = create<NotifyState>((set) => ({
  toasts: [],
  history: [],
  push: (n) =>
    set((s) => {
      const item: AppNotification = { ...n, id: `n${++counter}` };
      return {
        toasts: [...s.toasts, item].slice(-MAX_TOASTS),
        history: [item, ...s.history].slice(0, 50),
      };
    }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearHistory: () => set({ history: [] }),
}));
