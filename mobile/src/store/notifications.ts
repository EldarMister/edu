import { create } from 'zustand';

/** Запись ленты уведомлений официанта (как history в PWA). */
export interface AppNotification {
  id: string;
  message: string;
  at: string; // ISO
}

interface NotifyState {
  history: AppNotification[];
  push: (message: string) => void;
  clear: () => void;
}

let counter = 0;

export const useNotifications = create<NotifyState>((set) => ({
  history: [],
  push: (message) =>
    set((s) => ({
      history: [
        { id: `n${++counter}`, message, at: new Date().toISOString() },
        ...s.history,
      ].slice(0, 50),
    })),
  clear: () => set({ history: [] }),
}));

/** Короткий помощник: добавить запись в ленту без подписки на стор. */
export function notify(message: string) {
  useNotifications.getState().push(message);
}
