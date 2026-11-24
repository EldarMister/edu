import { useState } from 'react';
import { money } from '@/lib/format';
import { apiError } from '@/lib/api';
import { useRecipePreview, type RecipePreview, type RecipePreviewInput } from './recipe-preview-api';
import { recipeQuantity } from './recipe-draft-values';
import { unitLabel } from './units';

interface BatchPanelProps {
  preview?: RecipePreview;
  input: RecipePreviewInput | null;
  pending: boolean;
  showCosts: boolean;
}

export function RecipeBatchPreview(props: BatchPanelProps) {
  return <details className="rounded-xl border border-border bg-background px-4 py-3">
    <summary className="cursor-pointer font-medium">Расчёт партии</summary>
    <div className="mt-3"><RecipeBatchPanel {...props} /></div>
  </details>;
}

export function RecipeBatchPanel({ preview, pending, input, showCosts }: BatchPanelProps) {
  const [value, setValue] = useState(String(input?.inputPortions ?? 1));
  const portions = Number(value);
  const valid = Number.isInteger(portions) && portions > 0 && portions <= 10_000;
  const fetchBatch = !!input && valid && portions > 1 && portions !== input.batchPortions;
  const batchPreview = useRecipePreview(fetchBatch ? { ...input, batchPortions: portions } : null);
  const batch = (fetchBatch ? batchPreview.data : preview)?.batch;
  const { items, output } = preview ?? {};
  const batchCost = portions === 1 ? preview?.compositionCostForScaling ?? preview?.compositionFoodCost : batch?.compositionCost;
  const loading = pending || (fetchBatch && batchPreview.pending);
  const batchItems = new Map(batch?.items.map((item) => [item.ingredientId, item]));

  return <div className="space-y-4 text-sm">
      <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
        Количество порций
        <input type="number" min={1} max={10000} step={1} inputMode="numeric" value={value}
          aria-invalid={!valid} className="input h-10 w-32 tabular-nums" onChange={(event) => setValue(event.target.value)} />
      </label>
      {!valid ? <p className="text-danger" role="status">Введите целое число порций от 1 до 10 000.</p>
        : batchPreview.error ? <p className="text-danger" role="alert">{apiError(batchPreview.error)}{' '}
          <button type="button" className="underline" onClick={() => void batchPreview.retry()}>Повторить расчёт</button></p>
        : loading || !items?.length ? <p className="text-text-muted" role="status">{loading ? 'Расчёт…' : 'Расчёт партии пока недоступен.'}</p>
        : <>
          <dl className="flex flex-wrap gap-x-6 gap-y-2" aria-live="polite">
            <div><dt className="text-text-muted">Выход партии</dt>
              <dd className="font-medium tabular-nums">{output ? recipeQuantity(output.amount * portions, unitLabel(output.unit)) : 'Не указан'}</dd></div>
            {showCosts && <>
              <div><dt className="text-text-muted">Стоимость порции</dt>
                <dd className="font-medium tabular-nums">{batchCost == null ? 'Не рассчитана' : money(batchCost / portions)}</dd></div>
              <div><dt className="text-text-muted">Стоимость партии</dt>
                <dd className="font-medium tabular-nums">{batchCost == null ? 'Не рассчитана' : money(batchCost)}</dd></div>
            </>}
          </dl>
          <table className="w-full table-fixed text-left">
            <thead className="border-b border-border text-text-muted"><tr>
              <th scope="col" className="py-2 font-medium">Ингредиент</th>
              <th scope="col" className="w-32 py-2 text-right font-medium">Брутто на партию</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => {
                const gross = Number((item.amount * portions).toFixed(6));
                const writeoff = portions === 1 ? item.stockWriteoffAmount : batchItems.get(item.ingredientId)?.stockWriteoffAmount;
                return <tr key={item.ingredientId}>
                <td className="break-words py-2 pr-2">{item.name}
                  {item.warehouseName && <div className="text-xs text-text-muted">{item.warehouseName}</div>}</td>
                <td className="break-words py-2 text-right tabular-nums">{recipeQuantity(gross, unitLabel(item.amountUnit))}
                  {writeoff != null && writeoff !== gross && <div className="text-xs text-text-muted">
                    Спишется {recipeQuantity(writeoff, unitLabel(item.amountUnit))}</div>}</td>
              </tr>; })}
            </tbody>
          </table>
        </>}
  </div>;
}
