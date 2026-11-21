import { useWarehousePolicy } from './settings-api';
import type { documentStockShortages } from './stock-document-form';

export function DocumentStockWarnings({ shortages, isTransfer = false }: {
  shortages: ReturnType<typeof documentStockShortages>;
  isTransfer?: boolean;
}) {
  const policy = useWarehousePolicy(shortages.length > 0 && !isTransfer);
  if (!shortages.length) return null;
  const allowNegative = isTransfer || policy.data?.allowNegativeIngredientStock;
  const format = (value: number, unit: string) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} ${unit}`;
  return <section className="poster-stock-warning" role="status" aria-label="Недостаточно на складе">
    <h3>Недостаточно на складе</h3>
    <ul>
      {shortages.map(({ ingredientId, name, unit, available, requested, deficit }) =>
        <li key={ingredientId}><strong>{name}</strong><span>На складе {format(available, unit)} · в документе {format(requested, unit)} · не хватает {format(deficit, unit)}</span></li>)}
    </ul>
    {allowNegative === false && <p>При таком остатке документ можно сохранить как черновик. Для проведения пополните склад или уменьшите количество.</p>}
    {allowNegative === true && <p>{isTransfer ? 'Перемещение можно провести. Остаток на складе-отправителе станет отрицательным.' : 'По настройкам заведения документ можно провести. Остаток станет отрицательным.'}</p>}
  </section>;
}
