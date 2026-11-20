import { create } from 'zustand';
import { useAuth } from './auth';

export type Locale = 'ru' | 'ky';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const localeKey = 'edu-pos-locale';
const accountLocaleKey = (userId: string) => `${localeKey}:${userId}`;

function readLocale(userId?: string): Locale {
  if (typeof window === 'undefined') return 'ru';
  try {
    const scoped = userId && window.localStorage.getItem(accountLocaleKey(userId));
    if (scoped === 'ky' || scoped === 'ru') return scoped;
    const current = JSON.parse(window.localStorage.getItem(localeKey) || 'null') as { state?: { locale?: Locale } } | null;
    if (current?.state?.locale === 'ky' || current?.state?.locale === 'ru') return current.state.locale;
    const legacy = JSON.parse(window.localStorage.getItem('edu-pos-lang') || 'null') as { state?: { lang?: Locale } } | null;
    if (legacy?.state?.lang === 'ky' || legacy?.state?.lang === 'ru') return legacy.state.lang;
  } catch {
    // ignore corrupted persisted locale
  }
  return 'ru';
}

export const useLocale = create<LocaleState>((set) => ({
  locale: readLocale(useAuth.getState().user?.id),
  setLocale: (locale) => {
    set({ locale });
    try {
      const userId = useAuth.getState().user?.id;
      if (userId) window.localStorage.setItem(accountLocaleKey(userId), locale);
      else window.localStorage.setItem(localeKey, JSON.stringify({ state: { locale }, version: 0 }));
    } catch {
      // The setting still applies for the current session if storage is disabled.
    }
  },
}));

useAuth.subscribe(({ user }, previous) => {
  if (user?.id !== previous.user?.id) useLocale.setState({ locale: readLocale(user?.id) });
});

if (typeof window !== 'undefined') {
  document.documentElement.lang = useLocale.getState().locale;
  useLocale.subscribe(({ locale }) => { document.documentElement.lang = locale; });
  window.addEventListener('storage', ({ key }) => {
    const userId = useAuth.getState().user?.id;
    if (key === null || key === localeKey || (userId && key === accountLocaleKey(userId))) {
      useLocale.setState({ locale: readLocale(userId) });
    }
  });
}
