import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { api } from '@/lib/api';
import { financeDateTime } from '../finance/finance-format';
import { PROCESSING_METHODS, type ProcessingBasis, type ProcessingMethod, type ProcessingStage } from './api';
import { recipeQuantity } from './recipe-draft-values';
import { normalizeUnitLabel, type UnitCode } from './units';
import { QueryState } from './WarehouseUi';

interface HistoricalIngredient {
  ingredientId: string;
  name: string | null;
  unit: UnitCode | null;
  amount: number | null;
}

interface HistoricalItem extends HistoricalIngredient {
  netAmount: number | null;
  measuredNetWeightGrams: number | null;
  lossPercent: number | null;
  processingMethod: ProcessingMethod | null;
  processingBasis: ProcessingBasis | null;
  processingStages: ProcessingStage[];
  variantAmounts: { variantId: string; name: string | null; amount: number }[];
}

interface RecipeRevision {
  id: string;
  version: number;
  savedAt: string | null;
  savedBy: string | null;
  replacedAt: string;
  replacedBy: string | null;
  items: HistoricalItem[];
  stockItem: HistoricalIngredient | null;
  variants: { id: string; name: string | null; stockItem: HistoricalIngredient | null }[];
  components: { id: string; dishId: string; name: string | null; variantId: string | null; variantName: string | null; quantity: number | null }[] | null;
  modifierGroups: { id: string; name: string; options: { id: string; name: string; ingredient: HistoricalIngredient | null }[] }[];
  instructions: string | null;
  output: { amount: number; unit: string | null } | null;
}

const basisLabels = { gross: 'От брутто', net: 'От нетто', manual: 'Вручную' };
const methodLabels = new Map(PROCESSING_METHODS.map(({ value, label }) => [value, label]));
const itemName = ({ name, ingredientId }: HistoricalIngredient) => name ?? 'Ингредиент · ID ' + ingredientId;

function amountLabel(amount: number | null, unit: string | null) {
  return amount == null ? '—' : recipeQuantity(amount, unit ? normalizeUnitLabel(unit) : 'баз. ед.');
}

export function RecipeHistoryDrawer({ dishId, name, isSet, onClose }: { dishId: string; name: string; isSet: boolean; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState('');
  const query = useQuery({
    queryKey: ['admin', 'warehouse', 'recipe-history', dishId],
    queryFn: async () => (await api.get<RecipeRevision[]>(`/admin/warehouse/dishes/${encodeURIComponent(dishId)}/recipe-revisions`, {
      params: { view: 'composition' },
    })).data,
  });
  const selected = query.data?.find(({ id }) => id === selectedId) ?? query.data?.[0];
  return <Modal open title="История состава" onClose={onClose} panelClassName="max-w-3xl" manageFocus>
    <div className="space-y-4 py-1">
      <p className="text-sm font-medium text-text-secondary">{name}</p>
      <QueryState pending={query.isPending} error={query.error}>
        {selected ? <>
          <Select ariaLabel="Версия состава" value={selected.id} onChange={setSelectedId} className="w-full sm:max-w-sm"
            options={(query.data ?? []).map((row) => ({ value: row.id, label: `Версия ${row.version} · ${financeDateTime(row.replacedAt)}` }))} />
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {selected.savedAt && <HistoryField label="Сохранена">
              <time dateTime={selected.savedAt}>{financeDateTime(selected.savedAt)}</time>
              {selected.savedBy && <span className="block break-words">{selected.savedBy}</span>}
            </HistoryField>}
            <HistoryField label="Заменена">
              <time dateTime={selected.replacedAt}>{financeDateTime(selected.replacedAt)}</time>
              <span className="block break-words">{selected.replacedBy ?? 'Автор не записан'}</span>
            </HistoryField>
            {selected.output && <HistoryField label="Выход">{recipeQuantity(selected.output.amount, selected.output.unit ? normalizeUnitLabel(selected.output.unit) : '')}</HistoryField>}
          </dl>
          <RevisionComposition revision={selected} isSet={isSet} />
        </> : <p className="py-4 text-sm text-text-muted">Сохранённых версий пока нет.</p>}
      </QueryState>
      {query.isError && <button type="button" className="btn-secondary btn-md" onClick={() => void query.refetch()}>Повторить загрузку</button>}
    </div>
  </Modal>;
}

function HistoryField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-text-muted">{label}</dt><dd className="font-medium tabular-nums">{children}</dd></div>;
}

function RevisionComposition({ revision, isSet }: { revision: RecipeRevision; isSet: boolean }) {
  const bindings = revision.variants.filter(({ stockItem }) => stockItem != null);
  return <div className="space-y-4 text-sm">
    {(revision.stockItem || bindings.length > 0) && <section aria-label="Прямое списание" className="space-y-2">
      <h4 className="font-medium">Прямое списание</h4>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {revision.stockItem && <BindingRow item={revision.stockItem} />}
        {bindings.map(({ id, name, stockItem }) => stockItem && <BindingRow key={id} item={stockItem} variant={name ?? 'ID ' + id} />)}
      </ul>
    </section>}
    {revision.items.length > 0 && <ul aria-label="Ингредиенты прежнего состава" className="divide-y divide-border rounded-lg border border-border">
      {revision.items.map((item) => <IngredientRow key={item.ingredientId} item={item} />)}
    </ul>}
    {!!revision.components?.length && <ul aria-label="Прежний состав сета" className="divide-y divide-border rounded-lg border border-border">
      {revision.components.map((component) => <li key={component.id} className="flex justify-between gap-3 p-3">
        <span className="min-w-0 break-words">{component.name ?? 'Блюдо · ID ' + component.dishId}
          {(component.variantName || component.variantId) && <span className="block text-xs text-text-muted">{component.variantName ?? 'ID ' + component.variantId}</span>}</span>
        <span className="shrink-0 tabular-nums">{component.quantity == null ? '—' : recipeQuantity(component.quantity, 'шт')}</span>
      </li>)}
    </ul>}
    {isSet && revision.components === null && <p className="text-text-muted">Список блюд в этой версии сета не был записан.</p>}
    {!revision.stockItem && !bindings.length && !revision.items.length && !revision.components?.length && (!isSet || revision.components !== null)
      && <p className="text-text-muted">Состав в этой версии не задан.</p>}
    {revision.modifierGroups.length > 0 && <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer font-medium">Модификаторы</summary>
      {revision.modifierGroups.map((group) => <div className="mt-2" key={group.id}>
        <h4 className="text-xs font-medium text-text-muted">{group.name}</h4>
        <ul>{group.options.map((option) => <li key={option.id}>{option.name}{option.ingredient && <> · {itemName(option.ingredient)} · {amountLabel(option.ingredient.amount, option.ingredient.unit)}</>}</li>)}</ul>
      </div>)}
    </details>}
    {revision.instructions && <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer font-medium">Технология приготовления</summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{revision.instructions}</p>
    </details>}
  </div>;
}

function BindingRow({ item, variant }: { item: HistoricalIngredient; variant?: string }) {
  return <li className="flex justify-between gap-3 p-3">
    <span className="min-w-0 break-words">{itemName(item)}{variant && <span className="block text-xs text-text-muted">{variant}</span>}</span>
    <span className="shrink-0 tabular-nums">{amountLabel(item.amount, item.unit)}</span>
  </li>;
}

function IngredientRow({ item }: { item: HistoricalItem }) {
  const stages = item.processingStages.length ? item.processingStages : item.processingMethod
    ? [{ method: item.processingMethod, lossPercent: item.lossPercent }] : [];
  return <li className="space-y-2 p-3">
    <p className="break-words font-medium">{itemName(item)}</p>
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <HistoryField label="Брутто">{amountLabel(item.amount, item.unit)}</HistoryField>
      <HistoryField label="Нетто">{amountLabel(item.netAmount, item.unit)}</HistoryField>
      {item.measuredNetWeightGrams != null && <HistoryField label="Измеренный вес нетто">{recipeQuantity(item.measuredNetWeightGrams, 'г')}</HistoryField>}
      {item.processingBasis && <HistoryField label="Основа расчёта">{basisLabels[item.processingBasis]}</HistoryField>}
    </dl>
    {stages.length > 0 && <p className="text-xs text-text-muted">
      {stages.map(({ method, lossPercent }) => `${methodLabels.get(method)}${lossPercent == null ? '' : ` (${recipeQuantity(lossPercent, '%')})`}`).join(' → ')}
    </p>}
    {item.variantAmounts.length > 0 && <dl className="flex flex-wrap gap-x-4 gap-y-1">
      {item.variantAmounts.map(({ variantId, name, amount }) => <HistoryField key={variantId} label={name ?? 'Вариант · ID ' + variantId}>
        {amountLabel(amount, item.unit)} брутто
      </HistoryField>)}
    </dl>}
  </li>;
}
