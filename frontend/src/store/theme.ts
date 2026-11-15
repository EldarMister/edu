import { create } from 'zustand';

type Theme = 'light' | 'dark';
const themeKey = 'edu-pos-theme';

function readTheme(): Theme {
  try {
    return window.localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const useTheme = create<{ theme: Theme; setTheme: (theme: Theme) => void }>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    set({ theme });
    try {
      window.localStorage.setItem(themeKey, theme);
    } catch {
      // The setting still applies for the current session if storage is disabled.
    }
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === themeKey) {
      useTheme.setState({ theme: event.newValue === 'dark' ? 'dark' : 'light' });
    }
  });
}
