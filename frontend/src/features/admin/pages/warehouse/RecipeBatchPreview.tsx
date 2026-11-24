import { useState } from 'react';
import { money } from '@/lib/format';
import type { RecipePreview } from './recipe-preview-api';
import { recipeQuantity } from './recipe-draft-values';
import { unitLabel } from './units';

export function RecipeBatchPreview({ preview, pending, showCosts }: {
  preview?: RecipePreview;
  pending: boolean;
  showCosts: boolean;
}) {
  return <details className="rounded-xl border border-border bg-background px-4 py-3">
    <summary className="cursor-pointer font-medium">Расчёт партии</summary>
    <div className="mt-3"><RecipeBatchPanel preview={preview} pending={pending} showCosts={showCosts} /></div>
  </details>;
}

export function RecipeBatchPanel({ preview, pending, showCosts }: {
  preview?: RecipePreview;
  pending: boolean;
  showCosts: boolean;
}) {
  const [value, setValue] = useState('1');
  const portions = Number(value);
  const valid = Number.isSafeInteger(portions) && portions > 0;
  const { items, output, compositionFoodCost, compositionCostForScaling } = preview ?? {};
  const batchCost = compositionCostForScaling ?? compositionFoodCost;

  return <div className="space-y-4 text-sm">
      <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
        Количество порций
        <input type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} inputMode="numeric" value={value}
          aria-invalid={!valid} className="input h-10 w-32 tabular-nums" onChange={(event) => setValue(event.target.value)} />
      </label>
      {!valid ? <p className="text-danger" role="status">Введите целое число порций больше нуля.</p>
        : !items?.length ? <p className="text-text-muted" role="status">{pending ? 'Расчёт…' : 'Расчёт партии пока недоступен.'}</p>
        : <>
          <dl className="flex flex-wrap gap-x-6 gap-y-2" aria-live="polite">
            <div><dt className="text-text-muted">Выход партии</dt>
              <dd className="font-medium tabular-nums">{output ? recipeQuantity(output.amount * portions, unitLabel(output.unit)) : 'Не указан'}</dd></div>
            {showCosts && <>
              <div><dt className="text-text-muted">Стоимость порции</dt>
                <dd className="font-medium tabular-nums">{compositionFoodCost == null ? 'Не рассчитана' : money(compositionFoodCost)}</dd></div>
              <div><dt className="text-text-muted">Стоимость партии</dt>
                <dd className="font-medium tabular-nums">{batchCost == null ? 'Не рассчитана' : money(batchCost * portions)}</dd></div>
            </>}
          </dl>
          <table className="w-full table-fixed text-left">
            <thead className="border-b border-border text-text-muted"><tr>
              <th scope="col" className="py-2 font-medium">Ингредиент</th>
              <th scope="col" className="w-32 py-2 text-right font-medium">Брутто на партию</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => <tr key={item.ingredientId}>
                <td className="break-words py-2 pr-2">{item.name}
                  {item.warehouseName && <div className="text-xs text-text-muted">{item.warehouseName}</div>}</td>
                <td className="break-words py-2 text-right tabular-nums">{recipeQuantity(item.amount * portions, unitLabel(item.amountUnit))}</td>
              </tr>)}
            </tbody>
          </table>
        </>}
  </div>;
}
