import { useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { useApplyFoodCostPrices, type FoodCostPosition, type FoodCostPriceChange, type FoodCostReport } from './food-cost-api';
import { MAX_MENU_PRICE, projectFoodCostBasket } from './food-cost-model';
import { formatFoodCost, formatMarginChange, priceCaption } from './FoodCostReportTables';
import { financeMoney } from './finance/finance-format';

type PlannedPrice = FoodCostPriceChange & { id: string; name: string };
const planLimit = 100;

function readBasket(key: string): PlannedPrice[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((row): row is PlannedPrice => row != null && typeof row === 'object' &&
      typeof row.id === 'string' && typeof row.name === 'string' && typeof row.dishId === 'string' &&
      (row.variantId === null || typeof row.variantId === 'string') &&
      Number.isFinite(row.price) && Number.isFinite(row.expectedPrice) && Number.isFinite(row.expectedPriceBase) &&
      ['pcs', 'g', 'ml'].includes(row.expectedUnit)).slice(0, planLimit);
  } catch {
    return [];
  }
}

export function usePriceBasket() {
  const userId = useAuth((state) => state.user?.id);
  const push = useNotifications((state) => state.push);
  const key = `edu-pos-food-cost-basket:${userId ?? 'guest'}`;
  const [saved, save] = useState(() => ({ key, entries: readBasket(key) }));
  const entries = saved.key === key ? saved.entries : readBasket(key);
  function replace(next: PlannedPrice[]) {
    save({ key, entries: next });
    try {
      if (next.length) window.localStorage.setItem(key, JSON.stringify(next));
      else window.localStorage.removeItem(key);
    } catch { /* The current workspace can still use the draft. */ }
  }
  return {
    entries,
    prices: Object.fromEntries(entries.map(({ id, price }) => [id, price])),
    set(row: FoodCostPosition, price: number) {
      if (!row.dishId || !row.active || row.price == null || !Number.isFinite(price) || price < 0 || price > MAX_MENU_PRICE) return;
      if (price === row.price) return;
      const remaining = entries.filter(({ id }) => id !== row.id);
      if (remaining.length >= planLimit) {
        push({ type: 'error', message: `В одном плане можно изменить до ${planLimit} цен.`, at: new Date().toISOString() });
        return;
      }
      replace([...remaining, {
        id: row.id, name: row.name, dishId: row.dishId, variantId: row.variantId,
        expectedPrice: row.price, expectedPriceBase: row.priceBasis, expectedUnit: row.priceUnit, price,
      }]);
      push({ type: 'success', message: 'Цена добавлена в план', at: new Date().toISOString() });
    },
    remove(id: string) { replace(entries.filter((row) => row.id !== id)); },
    clear() { replace([]); },
  };
}

export function FoodCostPriceBasket({ basket, report, close }: {
  basket: ReturnType<typeof usePriceBasket>; report: FoodCostReport; close: () => void;
}) {
  const apply = useApplyFoodCostPrices();
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const push = useNotifications((state) => state.push);
  const positions = new Map(report.positions.map((row) => [row.id, row]));
  const projection = projectFoodCostBasket(report, basket.prices);
  const hasCompleteProjection = basket.entries.every(({ id }) => projection.positions[id] != null);
  const stale = basket.entries.some(({ id, expectedPrice, price, expectedPriceBase, expectedUnit }) => {
    const current = positions.get(id);
    return current != null && (!current.active || (current.price !== expectedPrice && current.price !== price)
      || current.priceBasis !== expectedPriceBase || current.priceUnit !== expectedUnit);
  });
  function requestClose() { if (!inFlight.current) close(); }
  async function confirm() {
    if (!basket.entries.length || inFlight.current || stale) return;
    setError('');
    inFlight.current = true;
    try {
      const changes = basket.entries.map(({ dishId, variantId, expectedPrice, expectedPriceBase, expectedUnit, price }) => ({
        dishId, variantId, expectedPrice, expectedPriceBase, expectedUnit, price,
      }));
      const result = await apply.mutateAsync(changes);
      basket.clear();
      close();
      push({ type: 'success', message: result.changed ? `Цены обновлены · ${result.changed}` : 'Цены уже применены', at: new Date().toISOString() });
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      inFlight.current = false;
    }
  }
  return <Modal open manageFocus title="План изменения цен" onClose={requestClose} panelClassName="max-w-3xl"
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={apply.isPending} onClick={requestClose}>Закрыть</button>
      <button type="button" className="btn-primary btn-md" disabled={apply.isPending || !basket.entries.length || stale}
        onClick={() => void confirm()}>{apply.isPending ? 'Применяем…' : 'Применить цены сейчас'}</button>
    </div>}>
    <p className="mb-3 text-sm text-text-secondary">После подтверждения новые цены сразу появятся в меню.</p>
    {!basket.entries.length ? <p className="text-sm text-text-muted">План пока пуст.</p> : <>
      <ul className="food-cost-basket-list">
        {basket.entries.map(({ id, name, expectedPrice, expectedPriceBase, expectedUnit, price }) => {
          const caption = priceCaption({ priceBasis: expectedPriceBase, priceUnit: expectedUnit });
          const forecast = projection.positions[id];
          return <li key={id}>
            <div className="min-w-0">
              <strong>{name}</strong>
              <div className="text-sm text-text-secondary">{financeMoney(expectedPrice)} → {financeMoney(price)}{caption}</div>
            </div>
            <div className="text-sm text-text-secondary">
              {forecast ? <>
                <p>Фудкост {formatFoodCost(forecast.baselineFoodCostPercent)} → {formatFoodCost(forecast.foodCostPercent)}</p>
                <p>Изменение маржи за 30 дней {formatMarginChange(forecast.monthlyMarginChange)}</p>
              </> : <p>Прогноз недоступен за выбранный период</p>}
            </div>
            <button type="button" className="text-sm text-danger" aria-label={`Убрать из плана — ${name}`}
              disabled={apply.isPending} onClick={() => basket.remove(id)}>Убрать</button>
          </li>;
        })}
      </ul>
      {hasCompleteProjection ? <p className="mt-3 text-sm">Фудкост заведения {formatFoodCost(projection.business.baselineFoodCostPercent)}
        {' → '}{formatFoodCost(projection.business.foodCostPercent)}
        {' · Изменение маржи за 30 дней '}{formatMarginChange(projection.business.monthlyMarginChange)}</p> :
        <p className="mt-3 text-sm text-text-muted">Для общего прогноза выберите период с продажами всех позиций из плана.</p>}
    </>}
    {(error || stale) && <p className="mt-3 text-sm text-danger" role="alert">
      {error || 'Цена или единица продажи изменилась. Уберите устаревшую строку и заново запланируйте цену.'}
    </p>}
  </Modal>;
}
