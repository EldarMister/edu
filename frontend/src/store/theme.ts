import { create } from 'zustand';

type Theme = 'light' | 'dark';
const themeKey = 'edu-pos-theme';
const systemTheme = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)');

function asTheme(value: string | null): Theme | null {
  return value === 'dark' || value === 'light' ? value : null;
}

function readPreference(): Theme | null {
  try {
    return asTheme(window.localStorage.getItem(themeKey));
  } catch {
    return null;
  }
}

function getSystemTheme(): Theme {
  return systemTheme?.matches ? 'dark' : 'light';
}

let preference = readPreference();

export const useTheme = create<{ theme: Theme; setTheme: (theme: Theme) => void }>((set) => ({
  theme: preference ?? getSystemTheme(),
  setTheme: (theme) => {
    preference = theme;
    set({ theme });
    try {
      window.localStorage.setItem(themeKey, theme);
    } catch {
      // The setting still applies for the current session if storage is disabled.
    }
  },
}));

systemTheme?.addEventListener('change', () => {
  if (preference === null) useTheme.setState({ theme: getSystemTheme() });
});

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === themeKey || event.key === null) {
      preference = asTheme(event.newValue);
      useTheme.setState({ theme: preference ?? getSystemTheme() });
    }
  });
}
