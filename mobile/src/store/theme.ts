import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { create } from 'zustand';
import type { ThemeMode } from '@/theme/palette';

const key = 'edu-pos-theme';
type State = { theme: ThemeMode; hydrated: boolean; setTheme: (theme: ThemeMode) => void };
let preference: ThemeMode | null = null;
let writes: Promise<unknown> = Promise.resolve();

const readSystemTheme = (): ThemeMode => Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';

function applyPreference(theme: ThemeMode) {
  preference = theme;
  Appearance.setColorScheme(theme);
}

export const useTheme = create<State>((set) => ({
  theme: readSystemTheme(), hydrated: false,
  setTheme: (theme) => {
    applyPreference(theme);
    set({ theme });
    // Serialize writes so quick toggles cannot persist an older selection last.
    writes = writes.then(() => AsyncStorage.setItem(key, theme)).catch(() => undefined);
  },
}));

Appearance.addChangeListener(({ colorScheme }) => {
  if (preference === null) useTheme.setState({ theme: colorScheme === 'dark' ? 'dark' : 'light' });
});

void AsyncStorage.getItem(key).then((saved) => {
  if (preference === null && (saved === 'dark' || saved === 'light')) applyPreference(saved);
  useTheme.setState({ ...(preference ? { theme: preference } : {}), hydrated: true });
}).catch(() => useTheme.setState({ hydrated: true }));
