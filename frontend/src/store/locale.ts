import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Locale = 'ru' | 'ky';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'ru';
  try {
    const current = JSON.parse(window.localStorage.getItem('edu-pos-locale') || 'null') as { state?: { locale?: Locale } } | null;
    if (current?.state?.locale === 'ky' || current?.state?.locale === 'ru') {
      document.documentElement.lang = current.state.locale;
      return current.state.locale;
    }
    const legacy = JSON.parse(window.localStorage.getItem('edu-pos-lang') || 'null') as { state?: { lang?: Locale } } | null;
    if (legacy?.state?.lang === 'ky' || legacy?.state?.lang === 'ru') {
      document.documentElement.lang = legacy.state.lang;
      return legacy.state.lang;
    }
  } catch {
    // ignore corrupted persisted locale
  }
  return 'ru';
}

/**
 * Основа локализации (ТЗ §4): язык интерфейса хранится здесь и в настройках на
 * сервере. Полные переводы будут добавлены поверх этого состояния позже.
 */
export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: initialLocale(),
      setLocale: (locale) => {
        if (typeof document !== 'undefined') document.documentElement.lang = locale;
        set({ locale });
      },
    }),
    { name: 'edu-pos-locale' },
  ),
);
