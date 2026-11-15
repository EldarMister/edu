import { ALL_UNITS } from './units';

function documentUnit(unit: string) {
  const label = unit.trim().replace(/\.$/, '');
  return ALL_UNITS.find((entry) => entry.code === label || entry.label === label);
}

export function documentQuantityInUnit(value: number, from: string, to: string): number | undefined {
  const source = documentUnit(from);
  const target = documentUnit(to);
  if (!source || !target || source.type !== target.type) return undefined;
  return value * source.factor / target.factor;
}

export function documentUnitCost(unit: string, costBase: number | null | undefined): number | null {
  const definition = documentUnit(unit);
  return definition && costBase != null ? definition.factor * costBase : null;
}

export function documentQuantityFromBase(value: number, unit: string): number | undefined {
  const definition = documentUnit(unit);
  return definition ? value / definition.factor : undefined;
}

export interface StockDemand {
  ingredientId: string;
  quantity: number | null;
  unit: string;
}

export function documentStockShortages(
  catalog: { id: string; name: string; unit: string; stockBase: number }[],
  demands: StockDemand[],
) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const needed = new Map<string, number>();
  for (const { ingredientId, quantity, unit } of demands) {
    const item = byId.get(ingredientId);
    if (!item || quantity == null || !Number.isFinite(quantity) || quantity <= 0) continue;
    const definition = documentUnit(unit);
    if (!definition || definition.type !== documentUnit(item.unit)?.type) continue;
    needed.set(ingredientId, (needed.get(ingredientId) ?? 0) + quantity * definition.factor);
  }
  return [...needed].flatMap(([ingredientId, base]) => {
    const item = byId.get(ingredientId)!;
    const deficit = base - item.stockBase;
    if (deficit < 0.0005) return [];
    const factor = documentUnit(item.unit)!.factor;
    return [{ ingredientId, name: item.name, unit: item.unit, available: item.stockBase / factor,
      requested: base / factor, deficit: deficit / factor }];
  });
}

export function documentQuantityError(input: string, inventory: boolean, remaining?: number): string | undefined {
  if (!input.trim()) return inventory ? undefined : 'Введите количество больше нуля.';
  const quantity = Number(input);
  if (!Number.isFinite(quantity) || quantity < 0 || (!inventory && quantity === 0))
    return inventory ? 'Введите фактическое количество от 0 и выше.' : 'Введите количество больше нуля.';
  if (remaining !== undefined && quantity > remaining + 1e-8)
    return `Можно вернуть не больше ${remaining.toLocaleString('ru-RU', { maximumFractionDigits: 6 })}.`;
  return undefined;
}

export function documentQuantityValue(input: string): number | null {
  return input.trim() ? Number(input) : null;
}

export function returnableQuantityInUnit(remainingBase: number, unit: string): number | undefined {
  return documentQuantityFromBase(Math.max(0, remainingBase), unit);
}
