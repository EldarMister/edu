import { ALL_UNITS } from './units';

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
  const definition = ALL_UNITS.find((entry) => entry.code === unit || entry.label === unit.replace(/\.$/, ''));
  return definition ? Math.max(0, remainingBase / definition.factor) : undefined;
}
