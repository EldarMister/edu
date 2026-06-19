import { BadRequestException } from '@nestjs/common';

/**
 * Единицы измерения склада с автоматической конвертацией.
 *
 * Всё хранится в БАЗОВЫХ единицах (g | ml | pcs). Админ выбирает display-единицу
 * (g/kg/ml/l/pcs), а конвертация в базу и обратно живёт здесь. Это единственный
 * источник правды по коэффициентам — и backend, и расчёты опираются на него.
 *
 *   масса:  база g   → kg = 1000 g
 *   объём:  база ml  → l  = 1000 ml
 *   штуки:  база pcs (без конвертации)
 */
export type UnitType = 'mass' | 'volume' | 'count';
export type UnitCode = 'g' | 'kg' | 'ml' | 'l' | 'pcs';

interface UnitDef {
  code: UnitCode;
  type: UnitType;
  base: UnitCode;
  factor: number; // сколько базовых единиц в одной display-единице
  label: string; // кириллица для UI
}

const UNITS: Record<UnitCode, UnitDef> = {
  g: { code: 'g', type: 'mass', base: 'g', factor: 1, label: 'г' },
  kg: { code: 'kg', type: 'mass', base: 'g', factor: 1000, label: 'кг' },
  ml: { code: 'ml', type: 'volume', base: 'ml', factor: 1, label: 'мл' },
  l: { code: 'l', type: 'volume', base: 'ml', factor: 1000, label: 'л' },
  pcs: { code: 'pcs', type: 'count', base: 'pcs', factor: 1, label: 'шт' },
};

const BASE_BY_TYPE: Record<UnitType, UnitCode> = { mass: 'g', volume: 'ml', count: 'pcs' };

// Кириллические подписи, которые мог сохранить старый код (legacy) или прислать UI.
const CYRILLIC_TO_CODE: Record<string, UnitCode> = {
  г: 'g',
  кг: 'kg',
  мл: 'ml',
  л: 'l',
  шт: 'pcs',
};

/** Нормализует ввод (код или кириллица) в канонический UnitCode. Бросает 400 при неизвестной единице. */
export function normalizeUnit(input: string | null | undefined): UnitCode {
  const raw = (input ?? '').trim();
  if (raw in UNITS) return raw as UnitCode;
  const lower = raw.toLowerCase();
  if (lower in UNITS) return lower as UnitCode;
  if (raw in CYRILLIC_TO_CODE) return CYRILLIC_TO_CODE[raw];
  throw new BadRequestException(`Неизвестная единица измерения: «${input}»`);
}

export function unitDef(code: UnitCode): UnitDef {
  return UNITS[code];
}

export function unitType(code: UnitCode): UnitType {
  return UNITS[code].type;
}

export function baseUnitForType(type: UnitType): UnitCode {
  return BASE_BY_TYPE[type];
}

/** Кириллическая подпись единицы (для UI). */
export function unitLabel(code: UnitCode): string {
  return UNITS[code].label;
}

/** Все display-единицы данного типа (для селектов на фронте). */
export function unitsForType(type: UnitType): Array<{ code: UnitCode; label: string }> {
  return (Object.values(UNITS) as UnitDef[])
    .filter((u) => u.type === type)
    .map((u) => ({ code: u.code, label: u.label }));
}

/** Количество display → база: 30 кг → 30000 г. */
export function toBase(value: number, code: UnitCode): number {
  return value * UNITS[code].factor;
}

/** Количество база → display: 29500 г → 29.5 кг. */
export function fromBase(baseValue: number, code: UnitCode): number {
  return baseValue / UNITS[code].factor;
}

/** Цена за display-единицу → за базовую: 400 с/кг → 0.4 с/г. */
export function costToBase(costPerDisplay: number, code: UnitCode): number {
  return costPerDisplay / UNITS[code].factor;
}

/** Цена за базовую единицу → за display: 0.4 с/г → 400 с/кг. */
export function costFromBase(costPerBase: number, code: UnitCode): number {
  return costPerBase * UNITS[code].factor;
}

/** «с/кг», «с/г», «с/л», «с/шт» — подпись себестоимости для UI (ТЗ §11). */
export function costUnitLabel(code: UnitCode): string {
  return `с/${UNITS[code].label}`;
}

/**
 * Проверяет, что выбранная единица совместима с типом ингредиента.
 * кг с л, шт сам по себе и т.д. (ТЗ §10). Иначе — 400.
 */
export function assertUnitMatchesType(code: UnitCode, type: UnitType): void {
  if (UNITS[code].type !== type) {
    throw new BadRequestException(
      `Единица «${unitLabel(code)}» несовместима с типом ингредиента (${baseUnitForType(type)})`,
    );
  }
}
