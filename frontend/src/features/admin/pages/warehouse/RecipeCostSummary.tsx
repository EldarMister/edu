import { apiError } from '@/lib/api';
import { money, taxRateLabel } from '@/lib/format';
import { qty } from './api';
import type { RecipePreview, useRecipePreview } from './recipe-preview-api';
import { unitLabel } from './units';

export function RecipeStockBasis({ stockItem }: { stockItem: NonNullable<RecipePreview['stockItem']> }) {
  return <p className="text-sm text-text-secondary">
    При продаже списывается <strong className="text-text-primary">{stockItem.name}</strong>
    {' · '}{qty(stockItem.amount, unitLabel(stockItem.unit))}
    {stockItem.warehouseName ? ' · ' + stockItem.warehouseName : ''}
  </p>;
}

export function RecipeCostSummary({ preview, showCosts, showPriceMetrics = true, showMissing = true, showError = true }: {
  preview: ReturnType<typeof useRecipePreview>;
  showCosts: boolean;
  showPriceMetrics?: boolean;
  showMissing?: boolean;
  showError?: boolean;
}) {
  const match = preview.data;
  const stockItem = match?.stockItem;
  const missing = stockItem ? match?.productionMissingCosts ?? match?.missingCosts : match?.missingCosts;
  const metrics = match && showPriceMetrics ? [
    { key: 'food', label: 'Фудкост', value: match.foodCostPercent, format: taxRateLabel },
    { key: 'markup', label: 'Наценка', value: match.markupPercent, format: taxRateLabel },
    { key: 'margin', label: 'Маржа', value: match.marginAmount, format: money },
  ].filter(({ value }) => value != null && Number.isFinite(value)) : [];
  if (!showCosts && !stockItem) return null;
  return <div className="space-y-2 text-sm">
    {showCosts && <dl className="flex flex-wrap gap-x-5 gap-y-2" aria-live="polite">
      <div><dt className="text-text-muted">{stockItem ? 'Себестоимость по складу' : 'Себестоимость'}</dt>
        <dd className="font-medium tabular-nums">{match?.foodCost == null
          ? preview.pending ? 'Расчёт…' : match && !match.accountingConfigured ? 'Не настроена' : 'Не рассчитана'
          : money(match.foodCost)}</dd></div>
      {metrics.map(({ key, label, value, format }) => <div key={key}>
        <dt className="text-text-muted">{label}</dt><dd className="font-medium tabular-nums">{format(value!)}</dd>
      </div>)}
    </dl>}
    {stockItem && <RecipeStockBasis stockItem={stockItem} />}
    {showCosts && showMissing && !!missing?.length && <p className="text-text-secondary">Нет данных о себестоимости: {missing.join(', ')}.</p>}
    {showError && preview.error && <p role="alert" className="text-danger">{apiError(preview.error)}{' '}
      <button type="button" className="underline" onClick={() => void preview.retry()}>Повторить расчёт</button></p>}
  </div>;
}
