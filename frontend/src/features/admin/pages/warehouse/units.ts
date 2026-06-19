// Единицы измерения склада (зеркало backend/src/warehouse/units.ts).
// Бэкенд отдаёт значения уже в display-единице + кириллическую метку `unit`,
// поэтому здесь нужны только: список единиц по типу и конвертация для форм.

export type UnitType = 'mass' | 'volume' | 'count';
export type UnitCode = 'g' | 'kg' | 'ml' | 'l' | 'pcs';

interface UnitDef {
  code: UnitCode;
  type: UnitType;
  factor: number;
  label: string;
}

const UNITS: Record<UnitCode, UnitDef> = {
  g: { code: 'g', type: 'mass', factor: 1, label: 'г' },
  kg: { code: 'kg', type: 'mass', factor: 1000, label: 'кг' },
  ml: { code: 'ml', type: 'volume', factor: 1, label: 'мл' },
  l: { code: 'l', type: 'volume', factor: 1000, label: 'л' },
  pcs: { code: 'pcs', type: 'count', factor: 1, label: 'шт' },
};

export const ALL_UNITS: UnitDef[] = Object.values(UNITS);

export function unitLabel(code: UnitCode): string {
  return UNITS[code]?.label ?? code;
}

export function unitTypeOf(code: UnitCode): UnitType {
  return UNITS[code]?.type ?? 'count';
}

/** Единицы того же типа — для селекта в строке техкарты/закупки. */
export function unitsForType(type: UnitType): Array<{ value: UnitCode; label: string }> {
  return ALL_UNITS.filter((u) => u.type === type).map((u) => ({ value: u.code, label: u.label }));
}

/** Опции селекта единицы ингредиента (все 5). */
export const UNIT_OPTIONS: Array<{ value: UnitCode; label: string }> = ALL_UNITS.map((u) => ({
  value: u.code,
  label: u.label,
}));

export const UNIT_LABEL_OPTIONS: Array<{ value: string; label: string }> = UNIT_OPTIONS.map((u) => ({
  value: u.label,
  label: u.label,
}));

const UNIT_LABELS = new Set(UNIT_LABEL_OPTIONS.map((u) => u.value));

export function normalizeUnitLabel(value?: string | null): string {
  const unit = (value ?? '').trim();
  if (!unit) return 'шт';
  const byCode = UNIT_OPTIONS.find((option) => option.value === unit);
  if (byCode) return byCode.label;
  return unit;
}

export function unitLabelOptions(currentUnit: string): Array<{ value: string; label: string }> {
  if (UNIT_LABELS.has(currentUnit)) return UNIT_LABEL_OPTIONS;
  return [{ value: currentUnit, label: currentUnit }, ...UNIT_LABEL_OPTIONS];
}

/** «с/кг», «с/шт» … */
export function costUnitLabel(code: UnitCode): string {
  return `с/${unitLabel(code)}`;
}
