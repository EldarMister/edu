import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeUnit, toBase, unitType } from './units';

export type PurchaseUnit = { name: string; factor: number };
type ItemUnits = { purchaseUnits?: Prisma.JsonValue; purchaseUnit?: string | null; purchaseFactor?: Prisma.Decimal | null };

export function purchaseUnitsFor(item: ItemUnits): PurchaseUnit[] {
  const entries = Array.isArray(item.purchaseUnits) ? item.purchaseUnits as unknown as PurchaseUnit[] : [];
  if (entries.length) return entries;
  return item.purchaseUnit && item.purchaseFactor ? [{ name: item.purchaseUnit, factor: Number(item.purchaseFactor) }] : [];
}

export function validatePurchaseUnits(units: PurchaseUnit[], displayUnit: string): PurchaseUnit[] {
  if (units.length > 30) throw new BadRequestException('Можно настроить не более 30 закупочных единиц');
  const names = new Set<string>();
  return units.map((entry) => {
    const name = entry.name?.trim();
    if (!name || name.length > 40 || names.has(name.toLocaleLowerCase())) throw new BadRequestException('Укажите разные названия закупочных единиц');
    names.add(name.toLocaleLowerCase());
    if (!Number.isFinite(entry.factor) || entry.factor <= 0 || entry.factor >= 100_000_000) throw new BadRequestException('Коэффициент упаковки должен быть больше нуля');
    const factor = new Prisma.Decimal(entry.factor).toDecimalPlaces(6);
    if (factor.isZero()) throw new BadRequestException('Коэффициент упаковки слишком мал');
    // Standard unit labels have fixed meaning. Custom packages are explicit conversions.
    let standard: ReturnType<typeof normalizeUnit> | undefined;
    try { standard = normalizeUnit(name); } catch { /* Custom unit. */ }
    if (standard && (unitType(standard) !== unitType(normalizeUnit(displayUnit)) || !factor.eq(new Prisma.Decimal(toBase(1, standard)).div(toBase(1, normalizeUnit(displayUnit)))))) {
      throw new BadRequestException('Для упаковки используйте своё название, например «коробка», а не стандартную единицу');
    }
    return { name, factor: Number(factor) };
  });
}
