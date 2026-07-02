// Единицы измерения (зеркало frontend warehouse/units.ts, минимум для меню/склада).
export type UnitCode = 'g' | 'kg' | 'ml' | 'l' | 'pcs';

const UNIT_LABELS_BY_CODE: Record<UnitCode, string> = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };

export const UNIT_LABEL_OPTIONS: { value: string; label: string }[] = Object.values(UNIT_LABELS_BY_CODE).map((l) => ({
  value: l,
  label: l,
}));

const UNIT_LABELS = new Set(UNIT_LABEL_OPTIONS.map((u) => u.value));

export function normalizeUnitLabel(value?: string | null): string {
  const unit = (value ?? '').trim();
  if (!unit) return 'шт';
  const byCode = (Object.keys(UNIT_LABELS_BY_CODE) as UnitCode[]).find((code) => code === unit);
  if (byCode) return UNIT_LABELS_BY_CODE[byCode];
  return unit;
}

export function unitLabelOptions(currentUnit: string): { value: string; label: string }[] {
  if (UNIT_LABELS.has(currentUnit)) return UNIT_LABEL_OPTIONS;
  return [{ value: currentUnit, label: currentUnit }, ...UNIT_LABEL_OPTIONS];
}
