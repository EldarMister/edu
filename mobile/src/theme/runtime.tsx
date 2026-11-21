import React from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '@/store/theme';
import { darkPalette, themeColor, themeStyle, type ThemeMode } from './palette';

const ThemeContext = React.createContext<ThemeMode | undefined>(undefined);

export function ThemeScope({ mode, children }: { mode?: ThemeMode; children: React.ReactNode }) {
  return <ThemeContext.Provider value={mode}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const scoped = React.useContext(ThemeContext);
  const selected = useTheme((state) => state.theme);
  return scoped ?? selected;
}

export function useThemeColor() {
  const mode = useThemeMode();
  return React.useCallback((value: any, property = 'color') => themeColor(value, property, mode), [mode]);
}

export function useThemedStyle<T>(style: T): T {
  const mode = useThemeMode();
  return React.useMemo(() => mode === 'light' ? style : themeStyle(resolveStyle(style), mode) as T, [style, mode]);
}

function resolveStyle(style: unknown): unknown {
  if (typeof style === 'number') return StyleSheet.flatten(style);
  return Array.isArray(style) ? style.map(resolveStyle) : style;
}

export function useThemeColors() {
  const mode = useThemeMode();
  return mode === 'dark' ? darkPalette : lightRuntimePalette;
}

const lightRuntimePalette: { [K in keyof typeof darkPalette]: string } = {
  background: '#F8FAFC', card: '#FFFFFF', raised: '#F1F5F9', inset: '#EDF1F5', selected: '#EDF4FF', border: '#E2E8F0',
  textPrimary: '#0F172A', textSecondary: '#475569', textMuted: '#64748B', textLight: '#94A3B8',
  primary: '#005BFF', primaryHover: '#0049CC', link: '#005BFF', focus: '#005BFF',
  danger: '#EF4444', dangerFill: '#EF4444', success: '#16A34A', successFill: '#16A34A', warning: '#F59E0B',
  onColor: '#FFFFFF', paper: '#FFFFFF',
};
