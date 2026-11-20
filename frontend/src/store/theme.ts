import { create } from 'zustand';
import { useAuth } from './auth';

type Theme = 'light' | 'dark';
const themeKey = 'edu-pos-theme';
const accountThemeKey = (userId: string) => `${themeKey}:${userId}`;
const systemTheme = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)');

function asTheme(value: string | null): Theme | null {
  return value === 'dark' || value === 'light' ? value : null;
}

function readPreference(userId?: string): Theme | null {
  try {
    const scoped = userId ? asTheme(window.localStorage.getItem(accountThemeKey(userId))) : null;
    return scoped ?? asTheme(window.localStorage.getItem(themeKey));
  } catch {
    return null;
  }
}

function getSystemTheme(): Theme {
  return systemTheme?.matches ? 'dark' : 'light';
}

let preference = readPreference(useAuth.getState().user?.id);

export const useTheme = create<{ theme: Theme; setTheme: (theme: Theme) => void }>((set) => ({
  theme: preference ?? getSystemTheme(),
  setTheme: (theme) => {
    preference = theme;
    set({ theme });
    try {
      const userId = useAuth.getState().user?.id;
      window.localStorage.setItem(userId ? accountThemeKey(userId) : themeKey, theme);
    } catch {
      // The setting still applies for the current session if storage is disabled.
    }
  },
}));

function syncTheme(userId?: string) {
  preference = readPreference(userId);
  useTheme.setState({ theme: preference ?? getSystemTheme() });
}

useAuth.subscribe(({ user }, previous) => {
  if (user?.id !== previous.user?.id) syncTheme(user?.id);
});

systemTheme?.addEventListener('change', () => {
  if (preference === null) useTheme.setState({ theme: getSystemTheme() });
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', ({ key }) => {
    const userId = useAuth.getState().user?.id;
    if (key === null || key === themeKey || (userId && key === accountThemeKey(userId))) {
      syncTheme(userId);
    }
  });
}
