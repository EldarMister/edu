import { balanceMoney } from './balance-format';

export function PreparationCost({ value, known = 0 }: { value: number | null | undefined; known?: number | null }) {
  if (value != null) return <>{balanceMoney(value)}</>;
  const reason = 'Неполная себестоимость. Оформите поставку для ингредиентов без закупочной цены.';
  return <span className="text-warning" title={reason} aria-label={`${balanceMoney(known ?? 0)}. ${reason}`}>{balanceMoney(known ?? 0)}</span>;
}
