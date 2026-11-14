import { useId, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { EditorPage, EditorFooterTarget } from './EditorPage';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { costLabel } from './cost-format';
import { money } from '@/lib/format';
import {
  PROCESSING_METHODS,
  type ProcessingMethod,
  qty,
  useIngredient,
  useIngredientMutations,
  type Ingredient,
  type IngredientDetails,
  type ItemKind,
} from './api';
import { useSuppliers } from './settings-api';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { UNIT_OPTIONS, unitLabel, type UnitCode } from './units';

export function ItemCard({
  id,
  defaultKind,
  onClose,
  onSaved,
  onHistory,
  onRecipe,
  compact = false,
}: {
  compact?: boolean;
  id?: string;
  defaultKind?: ItemKind;
  onClose: () => void;
  onSaved?: (item: Ingredient) => void;
  onHistory?: (id: string) => void;
  onRecipe?: (item: Ingredient) => void;
}) {
  const query = useIngredient(id ?? null);
  const title = id
    ? 'Редактирование ингредиента'
    : defaultKind === 'goods'
      ? 'Добавление товара'
      : 'Добавление ингредиента';
  const Container = compact ? Modal : EditorPage;
  return (
    <EditorFooterTarget.Provider value={null}>
      <Container open onClose={onClose} title={title} panelClassName="max-w-2xl">
        {id && query.isPending && (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        )}
        {query.isError && (
          <p role="alert" className="text-sm text-danger">
            {apiError(query.error)}
          </p>
        )}
        {(!id || query.data) && (
          <ItemForm
            key={id ?? 'new'}
            item={query.data}
            defaultKind={defaultKind}
            onClose={onClose}
            onSaved={onSaved}
            onHistory={onHistory}
            onRecipe={onRecipe}
          />
        )}
      </Container>
    </EditorFooterTarget.Provider>
  );
}

function ItemForm({
  item,
  defaultKind,
  onClose,
  onSaved,
  onHistory,
  onRecipe,
}: {
  item?: IngredientDetails;
  defaultKind?: ItemKind;
  onClose: () => void;
  onSaved?: (item: Ingredient) => void;
  onHistory?: (id: string) => void;
  onRecipe?: (item: Ingredient) => void;
}) {
  const formId = useId();
  const mutations = useIngredientMutations();
  const { can } = usePermissions();
  const editable = can(item ? 'actions.warehouseSettings' : 'actions.warehouseReceive');
  const costs = can('actions.warehouseCosts');
  const [name, setName] = useState(item?.name ?? '');
  const kind: ItemKind = item?.kind ?? defaultKind ?? 'raw';
  const [unit, setUnit] = useState<UnitCode>(item?.displayUnit ?? (defaultKind === 'goods' ? 'pcs' : 'kg'));
  const [category, setCategory] = useState(item?.category ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [supplier, setSupplier] = useState(item?.supplier ?? '');
  const [threshold, setThreshold] = useState(String(item?.lowStockThreshold ?? 0));
  const suppliers = useSuppliers(editable);
  const [mode, setMode] = useState<'stocked' | 'virtual'>(item?.preparationMode ?? 'stocked');
  const [losses, setLosses] = useState<Partial<Record<ProcessingMethod, number>>>(
    item?.processingLosses ?? {},
  );
  const [error, setError] = useState('');
  const pending = mutations.create.isPending || mutations.update.isPending;
  const prepared = kind === 'preparation' || kind === 'prepared_dish';
  async function save(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending || !editable) return;
    if (!name.trim() || !Number.isFinite(Number(threshold)) || Number(threshold) < 0) {
      setError('Проверьте название и минимальный остаток.');
      return;
    }
    setError('');
    try {
      const body = {
        name: name.trim(),
        kind,
        unit,
        category: category.trim() || null,
        barcode: barcode.trim() || null,
        supplier: supplier.trim() || null,
        supplierId:
          supplier.trim() === item?.supplier
            ? (item.supplierId ?? null)
            : (suppliers.data?.find((s) => s.name === supplier.trim())?.id ?? null),
        lowStockThreshold: Number(threshold),
        preparationMode: mode,
        processingLosses: losses,
      };
      const saved = item
        ? await mutations.update.mutateAsync({ ...body, id: item.id })
        : await mutations.create.mutateAsync(body);
      onClose();
      onSaved?.(saved);
    } catch (err) {
      setError(apiError(err));
    }
  }
  const lossLabels: Record<ProcessingMethod, string> = {
    cleaning: '% потерь при очистке',
    boiling: '% потерь при варке',
    frying: '% потерь при жарке',
    stewing: '% потерь при тушении',
    baking: '% потерь при запекании',
  };
  return (
    <form id={formId} onSubmit={save} className="poster-form poster-form--ingredient">
      <fieldset disabled={!editable} className="space-y-4">
        <DocumentField label="Название">
          <input
            aria-label="Название ингредиента"
            autoFocus={!item}
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </DocumentField>
        <DocumentField label="Ед. измерения">
          {item ? (
            <span
              className="block py-2.5 text-sm"
              title="Единица измерения сохраняется при создании ингредиента"
            >
              {unitLabel(unit)}
            </span>
          ) : (
            <Select
              ariaLabel="Единица измерения"
              className="h-10 w-[136px]"
              value={unit}
              onChange={(v) => setUnit(v as UnitCode)}
              options={UNIT_OPTIONS}
            />
          )}
        </DocumentField>
        <details className="poster-advanced">
          <summary>Дополнительно</summary>
          <div className="space-y-4 pt-5">
            <DocumentField label="Штрихкод">
              <input
                aria-label="Штрихкод"
                className="input w-full"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </DocumentField>
            {PROCESSING_METHODS.map((method) => (
              <DocumentField key={method.value} label={lossLabels[method.value]}>
                <div className="poster-number-unit w-[136px]">
                  <input
                    aria-label={lossLabels[method.value]}
                    className="input min-w-0 w-full"
                    type="number"
                    min="0"
                    max="99.99"
                    step="any"
                    value={losses[method.value] ?? 0}
                    onChange={(e) => setLosses({ ...losses, [method.value]: Number(e.target.value) })}
                  />
                  <span>%</span>
                </div>
              </DocumentField>
            ))}
            <DocumentField label="Категория">
              <input
                aria-label="Категория ингредиента"
                className="input w-full"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </DocumentField>
            <DocumentField label="Минимальный остаток">
              <div className="poster-number-unit w-[220px]">
                <input
                  aria-label="Минимальный остаток"
                  className="input min-w-0 w-full"
                  type="number"
                  min="0"
                  step="any"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                />
                <span>{unitLabel(unit)}</span>
              </div>
            </DocumentField>
            <DocumentField label="Основной поставщик">
              <Select
                ariaLabel="Основной поставщик"
                className="h-10 w-full"
                value={supplier}
                onChange={setSupplier}
                options={[
                  { value: '', label: 'Не выбран' },
                  ...(supplier && !suppliers.data?.some((entry) => entry.name === supplier)
                    ? [{ value: supplier, label: supplier }]
                    : []),
                  ...(suppliers.data ?? []).map((entry) => ({ value: entry.name, label: entry.name })),
                ]}
              />
            </DocumentField>
            {prepared && (
              <DocumentField label="Использование полуфабриката">
                <Select
                  ariaLabel="Использование полуфабриката"
                  className="h-10 w-full"
                  value={mode}
                  onChange={(value) => setMode(value as typeof mode)}
                  options={[
                    { value: 'stocked', label: 'Производить и хранить на складе' },
                    { value: 'virtual', label: 'Списывать состав при продаже' },
                  ]}
                />
              </DocumentField>
            )}
          </div>
        </details>
      </fieldset>
      {item && (
        <details className="poster-advanced mt-5">
          <summary>Остатки и использование</summary>
          <div className="mt-4 max-w-[720px]">
            <table className="poster-table w-full">
              <thead>
                <tr>
                  <th>Склад</th>
                  <th className="text-right">Остаток</th>
                  {costs && <th className="text-right">Себестоимость</th>}
                </tr>
              </thead>
              <tbody>
                {(item.balances ?? []).map((balance) => (
                  <tr key={balance.warehouseId}>
                    <td>{balance.warehouseName}</td>
                    <td className="text-right">{qty(balance.stock, item.unit)}</td>
                    {costs && (
                      <td className="text-right">
                        {costLabel(balance.avgCost)} / {item.unit}
                      </td>
                    )}
                  </tr>
                ))}
                {!item.balances?.length && (
                  <tr>
                    <td colSpan={costs ? 3 : 2} className="py-4 text-text-muted">
                      Остатков по складам пока нет.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {costs && (
              <p className="mt-3 text-xs text-text-muted">
                Последняя закупочная цена:{' '}
                {item.lastPurchasePrice == null
                  ? 'ещё нет закупок'
                  : `${money(item.lastPurchasePrice)} / ${item.unit}`}
              </p>
            )}
            {!!item.usedInDishes?.length && (
              <p className="mt-3 text-sm text-text-secondary">
                Используется в меню: {item.usedInDishes.map((dish) => dish.name).join(', ')}
              </p>
            )}
            <div className="poster-row-actions mt-3">
              {onHistory && can('actions.warehouseReports') && costs && (
                <button type="button" onClick={() => onHistory(item.id)}>
                  История операций
                </button>
              )}
              {prepared && onRecipe && (
                <button type="button" onClick={() => onRecipe(item)}>
                  Рецептура и выход
                </button>
              )}
            </div>
          </div>
        </details>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      {editable && (
        <DocumentFooter>
          <button
            type="submit"
            form={formId}
            className="btn-primary btn-md"
            disabled={pending || !name.trim()}
          >
            {pending ? <Spinner /> : 'Сохранить'}
          </button>
          <button type="button" className="btn-ghost btn-md" onClick={onClose}>
            Отмена
          </button>
        </DocumentFooter>
      )}
    </form>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 text-xs font-medium text-text-secondary">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
