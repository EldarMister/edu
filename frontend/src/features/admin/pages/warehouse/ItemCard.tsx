import { useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { costLabel } from './cost-format';
import { money } from '@/lib/format';
import {
  ITEM_KINDS,
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
import { DocumentFooter } from './WarehouseUi';
import { UNIT_OPTIONS, type UnitCode } from './units';

export function ItemCard({
  id,
  defaultKind,
  onClose,
  onSaved,
  onHistory,
  onRecipe,
}: {
  id?: string;
  defaultKind?: ItemKind;
  onClose: () => void;
  onSaved?: (item: Ingredient) => void;
  onHistory?: (id: string) => void;
  onRecipe?: (item: Ingredient) => void;
}) {
  const query = useIngredient(id ?? null);
  return (
    <Modal
      open
      onClose={onClose}
      title={id ? 'Карточка товара' : 'Добавить товар'}
      panelClassName="max-w-2xl"
    >
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
    </Modal>
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
  const mutations = useIngredientMutations();
  const { can } = usePermissions();
  const editable = can(item ? 'actions.warehouseSettings' : 'actions.warehouseReceive');
  const costs = can('actions.warehouseCosts');
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<ItemKind>(
    item?.kind ?? defaultKind ?? (item?.isPrepared ? 'preparation' : 'raw'),
  );
  const [unit, setUnit] = useState<UnitCode>(item?.displayUnit ?? (defaultKind === 'goods' ? 'pcs' : 'kg'));
  const [category, setCategory] = useState(item?.category ?? '');
  const [barcode, setBarcode] = useState(item?.barcode ?? '');
  const [supplier, setSupplier] = useState(item?.supplier ?? '');
  const [threshold, setThreshold] = useState(String(item?.lowStockThreshold ?? 0));
  const suppliers = useSuppliers(editable);
  const [packs, setPacks] = useState<{ key: string; name: string; factor: string }[]>(() =>
    (item?.purchaseUnits?.length
      ? item.purchaseUnits
      : item?.purchaseUnit && item.purchaseFactor
        ? [{ name: item.purchaseUnit, factor: item.purchaseFactor }]
        : []
    ).map((pack, index) => ({ key: String(index), name: pack.name, factor: String(pack.factor) })),
  );
  const [mode, setMode] = useState<'stocked' | 'virtual'>(item?.preparationMode ?? 'stocked');
  const [losses, setLosses] = useState<Partial<Record<ProcessingMethod, number>>>(
    item?.processingLosses ?? {},
  );
  const [error, setError] = useState('');
  const pending = mutations.create.isPending || mutations.update.isPending;
  const prepared = kind === 'preparation' || kind === 'prepared_dish';
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !editable) return;
    if (
      !name.trim() ||
      !Number.isFinite(Number(threshold)) ||
      Number(threshold) < 0 ||
      packs.some((pack) => !pack.name.trim() || !(Number(pack.factor) > 0))
    ) {
      setError('Проверьте название, минимальный остаток и количество в закупочной упаковке.');
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
        supplierId: suppliers.data?.find((s) => s.name === supplier.trim())?.id ?? null,
        lowStockThreshold: Number(threshold),
        purchaseUnits: packs.map((pack) => ({ name: pack.name.trim(), factor: Number(pack.factor) })),
        preparationMode: mode,
        processingLosses: losses,
      };
      const saved = item
        ? await mutations.update.mutateAsync({ ...body, id: item.id })
        : await mutations.create.mutateAsync(body);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <fieldset disabled={!editable} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Название">
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Единица учёта">
            <Select
              ariaLabel="Единица учёта"
              className="h-10 w-full"
              value={unit}
              onChange={(v) => setUnit(v as UnitCode)}
              options={UNIT_OPTIONS}
              disabled={!!item}
            />
          </Field>
        </div>
        {prepared && (
          <Field label="Учёт заготовки">
            <Select
              ariaLabel="Учёт заготовки"
              className="h-10 w-full"
              value={mode}
              onChange={(v) => setMode(v as typeof mode)}
              options={[
                { value: 'stocked', label: 'Готовим партиями и храним на складе' },
                { value: 'virtual', label: 'При продаже списываем состав по рецепту' },
              ]}
            />
          </Field>
        )}
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">
            Дополнительно: свойства, обработка и упаковки
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Тип позиции">
              <Select
                ariaLabel="Тип позиции"
                className="h-10 w-full"
                value={kind}
                onChange={(v) => setKind(v as ItemKind)}
                options={ITEM_KINDS}
              />
            </Field>
            <Field label="Категория">
              <input
                className="input w-full"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Например, бакалея"
              />
            </Field>
            <Field label="Минимальный остаток">
              <input
                className="input w-full"
                type="number"
                min="0"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </Field>
            <Field label="Основной поставщик">
              <Select
                ariaLabel="Основной поставщик"
                className="h-10 w-full"
                value={supplier}
                onChange={setSupplier}
                options={[
                  { value: '', label: 'Не выбран' },
                  ...(suppliers.data ?? []).map((s) => ({ value: s.name, label: s.name })),
                ]}
              />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Штрихкод">
              <input className="input w-full" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PROCESSING_METHODS.map((method) => (
              <Field key={method.value} label={`${method.label}, потери %`}>
                <input
                  className="input w-full"
                  type="number"
                  min="0"
                  max="99.99"
                  step="any"
                  value={losses[method.value] ?? 0}
                  onChange={(e) => setLosses({ ...losses, [method.value]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {packs.map((pack) => (
              <div key={pack.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Закупочная упаковка">
                  <input
                    className="input w-full"
                    value={pack.name}
                    onChange={(e) =>
                      setPacks((current) =>
                        current.map((p) => (p.key === pack.key ? { ...p, name: e.target.value } : p)),
                      )
                    }
                    placeholder="Коробка"
                  />
                </Field>
                <Field label={`Количество, ${UNIT_OPTIONS.find((u) => u.value === unit)?.label}`}>
                  <input
                    className="input w-full"
                    type="number"
                    min="0"
                    step="any"
                    value={pack.factor}
                    onChange={(e) =>
                      setPacks((current) =>
                        current.map((p) => (p.key === pack.key ? { ...p, factor: e.target.value } : p)),
                      )
                    }
                  />
                </Field>
                <button
                  type="button"
                  className="btn-secondary btn-md"
                  aria-label={`Удалить упаковку ${pack.name}`}
                  onClick={() => setPacks((current) => current.filter((p) => p.key !== pack.key))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary btn-md mt-3"
            onClick={() =>
              setPacks((current) => [...current, { key: crypto.randomUUID(), name: '', factor: '' }])
            }
          >
            + Закупочная упаковка
          </button>
        </details>
      </fieldset>
      {item && (
        <>
          <div className="rounded-xl border border-border p-3">
            <h4 className="mb-2 text-sm font-semibold">Остатки по складам</h4>
            {(item.balances ?? []).map((balance) => (
              <div
                className="flex flex-wrap justify-between gap-2 border-t border-border py-2 text-sm"
                key={balance.warehouseId}
              >
                <span>{balance.warehouseName}</span>
                <span>
                  {qty(balance.stock, item.unit)}
                  {costs ? ` · ${costLabel(balance.avgCost)} / ${item.unit}` : ''}
                </span>
              </div>
            ))}
            {costs && (
              <p className="mt-2 text-xs text-text-muted">
                Последняя закупочная цена:{' '}
                {item.lastPurchasePrice == null
                  ? 'ещё нет закупок'
                  : `${money(item.lastPurchasePrice)} / ${item.unit}`}
              </p>
            )}
          </div>
          {!!item.usedInDishes?.length && (
            <p className="text-sm text-text-secondary">
              Используется в меню: {item.usedInDishes.map((dish) => dish.name).join(', ')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {onHistory && (
              <button type="button" className="btn-secondary btn-md" onClick={() => onHistory(item.id)}>
                История операций
              </button>
            )}
            {prepared && onRecipe && (
              <button type="button" className="btn-secondary btn-md" onClick={() => onRecipe(item)}>
                Рецептура и выход
              </button>
            )}
          </div>
        </>
      )}
      {!item && (
        <p className="text-xs text-text-muted">
          После создания внесите остатки документом прихода. Все изменения количества сохраняются в истории.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {editable && (
        <DocumentFooter>
          <button type="button" className="btn-secondary btn-md" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn-primary btn-md" disabled={pending || !name.trim()}>
            {pending ? <Spinner /> : item ? 'Сохранить карточку' : 'Добавить товар'}
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
