export type ThemeMode = 'light' | 'dark';

export const darkPalette = {
  background: '#101010', card: '#191919', raised: '#252525', inset: '#131313', selected: '#303030', border: '#373737',
  textPrimary: '#F0F0F0', textSecondary: '#D3D3D3', textMuted: '#AEAEAE', textLight: '#999999',
  primary: '#2664D8', primaryHover: '#245BC1', link: '#8AB6FF', focus: '#8AB6FF',
  danger: '#FF8B90', dangerFill: '#B62740', success: '#5CD395', successFill: '#157347', warning: '#FAC668',
  onColor: '#FFFFFF', paper: '#FFFFFF',
} as const;

const neutralText: Record<string, string> = {
  '#0f172a': darkPalette.textPrimary, '#14213e': darkPalette.textPrimary, '#162445': darkPalette.textPrimary,
  '#1a294a': darkPalette.textPrimary, '#1f3156': darkPalette.textPrimary, '#334155': darkPalette.textPrimary,
  '#475569': darkPalette.textSecondary, '#536686': darkPalette.textSecondary, '#506383': darkPalette.textSecondary,
  '#354767': darkPalette.textSecondary, '#64748b': darkPalette.textMuted, '#64799e': darkPalette.textMuted,
  '#657691': darkPalette.textMuted, '#62789c': darkPalette.textMuted, '#94a3b8': darkPalette.textLight,
  '#93a3be': darkPalette.textLight,
  '#172440': darkPalette.textPrimary, '#1c2a48': darkPalette.textPrimary,
  '#6e7e9a': darkPalette.textMuted, '#a4b0c2': darkPalette.textLight, '#b8c2d2': darkPalette.textLight,
};
const neutralSurface = new Set(['#f8fafc', '#f1f5f9', '#edf1f5', '#f3f5f7', '#f8fafd', '#fafbfc', '#f9fafb', '#f7faff', '#f4f8ff', '#f5f7fb', '#f5f8fd']);
const selectedSurface = new Set(['#edf4ff', '#edf3ff', '#edf6ff', '#eef4ff', '#f2f7ff', '#eaf1ff', '#f1f6ff', '#eff6ff', '#dbeafe']);
const neutralBorder = new Set(['#e2e8f0', '#e8eef7', '#dce5f2', '#e1e8f3', '#e4ebf5', '#e9eef5', '#e8eef6', '#e4eaf4', '#d8dee6', '#dbe7ff', '#d1d5db', '#e6ecf5', '#edf1f7', '#d8e2f0']);

function hex(value: string) {
  const lowered = value.toLowerCase();
  return /^#[a-f0-9]{3}$/.test(lowered) ? `#${[...lowered.slice(1)].map((v) => v + v).join('')}` : lowered;
}

/** Interpret the existing light palette by usage, never mutate a StyleSheet.
 * White foregrounds stay white; white surfaces become cards. Public/paper
 * content bypasses this mapping through a light ThemeScope. */
export function themeColor(value: unknown, property: string, mode: ThemeMode): any {
  if (mode === 'light' || typeof value !== 'string') return value;
  const key = hex(value);
  const background = property === 'backgroundColor';
  const border = property.toLowerCase().includes('border') || property === 'outlineColor';
  if (property === 'shadowColor') return '#000000';
  if (key === '#ffffff' || key === 'white') return background ? darkPalette.card : '#FFFFFF';
  if (key === '#005bff') return background ? darkPalette.primary : darkPalette.link;
  if (key === '#0049cc') return background ? darkPalette.primaryHover : '#AECEFF';
  if (key === '#397eff' || key === '#a7c6ff') return darkPalette.focus;
  if (key === '#ef4444' || key === '#dc2626') return background ? darkPalette.dangerFill : darkPalette.danger;
  if (key === '#16a34a') return background ? darkPalette.successFill : darkPalette.success;
  if (key === '#f59e0b') return background ? '#925C00' : darkPalette.warning;
  if (key === '#b45309') return background ? '#925C00' : darkPalette.warning;
  if (neutralText[key]) return background ? darkPalette.raised : neutralText[key];
  if (neutralBorder.has(key)) return border ? darkPalette.border : background ? darkPalette.raised : darkPalette.textLight;
  if (key === '#f8fafc') return background ? darkPalette.background : value;
  if (neutralSurface.has(key)) return background ? darkPalette.raised : border ? darkPalette.border : value;
  if (selectedSurface.has(key)) return background ? darkPalette.selected : border ? '#3D577C' : darkPalette.link;
  if (key === '#ffedd5') return background ? '#332819' : darkPalette.warning;
  if (key === '#f3e8ff') return background ? '#2C2340' : '#C4ACFF';
  if (key === '#fce7f3') return background ? '#382333' : '#F5A4D2';
  if (key === '#fee2e2' || key === '#fff1f1') return background ? '#352129' : darkPalette.danger;
  if (key === '#f97316' || key === '#ea580c') return background ? '#A54C16' : darkPalette.warning;
  if (key === '#a855f7' || key === '#9333ea') return background ? '#7843AD' : '#C4ACFF';
  if (key === '#ec4899' || key === '#db2777') return background ? '#B42B71' : '#F5A4D2';
  if (key === '#f87171') return darkPalette.danger;
  if (key === '#cbd5e1') return background ? '#484848' : darkPalette.border;
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(key);
  if (rgba) {
    const rgb = rgba.slice(1, 4).map(Number);
    const base = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    const solidSurface = background && Number(rgba[4] ?? 1) >= 0.5;
    const mapped = themeColor(base, border ? 'borderColor' : solidSurface ? 'backgroundColor' : 'color', mode);
    if (typeof mapped === 'string' && /^#[a-f\d]{6}$/i.test(mapped) && mapped.toLowerCase() !== base) {
      return `rgba(${[1, 3, 5].map((i) => parseInt(mapped.slice(i, i + 2), 16)).join(', ')}, ${rgba[4] ?? 1})`;
    }
  }
  return value;
}

export function themeStyle<T>(style: T, mode: ThemeMode): T {
  if (!style || mode === 'light') return style;
  if (Array.isArray(style)) return style.map((item) => themeStyle(item, mode)) as T;
  if (typeof style !== 'object') return style;
  const next = { ...style };
  for (const property of Object.keys(next)) {
    if (property === 'color' || property.endsWith('Color')) {
      (next as Record<string, unknown>)[property] = themeColor((next as Record<string, unknown>)[property], property, mode);
    }
  }
  return next;
}
