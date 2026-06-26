/**
 * Тема EDU POS mobile — точные токены из PWA (frontend/tailwind.config + index.css).
 * Светлый интерфейс, синий primary, мягкие скругления, лёгкие тени.
 */
export const colors = {
  primary: '#005BFF',
  primaryHover: '#0049CC',
  // Заливки primary/10, primary/5 (как в PWA bg-primary/10).
  primarySoft: 'rgba(0, 91, 255, 0.10)',
  primaryFaint: 'rgba(0, 91, 255, 0.05)',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textLight: '#94A3B8',

  danger: '#EF4444',
  dangerSoft: 'rgba(239, 68, 68, 0.10)',
  success: '#16A34A',
  successSoft: 'rgba(22, 163, 74, 0.10)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.10)',

  border: '#E2E8F0',
  background: '#F8FAFC',
  card: '#FFFFFF',
  white: '#FFFFFF',

  // Доп. палитра статусов (tailwind orange/purple/pink/slate/red).
  orange100: '#FFEDD5',
  orange500: '#F97316',
  orange600: '#EA580C',
  purple100: '#F3E8FF',
  purple500: '#A855F7',
  purple600: '#9333EA',
  pink100: '#FCE7F3',
  pink500: '#EC4899',
  pink600: '#DB2777',
  slate100: '#F1F5F9',
  slate300: '#CBD5E1',
  red100: '#FEE2E2',
  red400: '#F87171',
  red500: '#EF4444',
  red600: '#DC2626',
  green600: '#16A34A',
} as const;

// Отступы в духе tailwind (4px-сетка).
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// Скругления: PWA rounded-lg=8, xl=12, 2xl=16, full=999.
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

// Размеры шрифта (PWA base 15px, line-height 1.4).
export const fontSize = {
  xs: 11,
  tab: 14,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 26,
} as const;

/** Мягкая тень карточек — PWA shadow-card (очень лёгкая). */
export const cardShadow = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 1,
} as const;

/** Тень для всплывающих элементов — PWA shadow-soft. */
export const softShadow = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 6,
} as const;

/** Fixed mobile layout tokens copied from the PWA waiter UI. */
export const waiterLayout = {
  inputHeight: 44,
  pillHeight: 36,
  pillRadius: 8,
  dishCardHeight: 100,
  dishCardRadius: 12,
  tableCardRadius: 22,
  tablePickerCardHeight: 60,
  cartBarHeight: 65,
  navBarHeight: 58,
  roundButton: 28,
  sheetRadius: 16,
} as const;
