import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Locale = 'ru' | 'ky';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/**
 * Основа локализации (ТЗ §4): язык интерфейса хранится здесь и в настройках на
 * сервере. Полные переводы будут добавлены поверх этого состояния позже.
 */
export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'ru',
      setLocale: (locale) => {
        if (typeof document !== 'undefined') document.documentElement.lang = locale;
        set({ locale });
      },
    }),
    { name: 'vkusno-pos-locale' },
  ),
);
