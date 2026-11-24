import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
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
  useIngredients,
  useIngredientMutations,
  useWarehouseLocations,
  type Ingredient,
  type IngredientDetails,
  type ItemKind,
} from './api';
import { useSuppliers } from './settings-api';
import { DocumentField } from './WarehouseUi';
import { UNIT_OPTIONS, unitConversionFactor, unitLabel, unitTypeOf, unitsForType, type UnitCode } from './units';
import { IngredientUsageTable } from './CatalogueDetails';
import { parsePieceWeightGrams } from './recipe-draft-values';

export function ItemCard({
  id,
  defaultKind,
  initialName,
  onClose,
  onSaved,
  onHistory,
  onRecipe,
  compact = false,
}: {
  compact?: boolean;
  id?: string;
  defaultKind?: ItemKind;
  initialName?: string;
  onClose: () => void;
  onSaved?: (item: Ingredient) => void;
  onHistory?: (id: string) => void;
  onRecipe?: (item: Ingredient) => void;
}) {
  const query = useIngredient(id ?? null);
  const mutations = useIngredientMutations();
  const pending = mutations.create.isPending || mutations.update.isPending;
  const title = id
    ? 'Редактирование ингредиента'
    : defaultKind === 'goods'
      ? 'Добавление товара'
      : 'Добавление ингредиента';
  return createPortal(!id || query.data ? (
    <ItemForm key={id ?? 'new'} title={title} item={query.data} defaultKind={defaultKind} initialName={initialName}
      onClose={onClose} onSaved={onSaved} onHistory={onHistory} onRecipe={onRecipe} compact={compact}
      mutations={mutations} pending={pending} />
  ) : (
    <Modal open manageFocus onClose={onClose} title={title} panelClassName="max-w-lg">
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
    </Modal>
  ), document.body);
}

function ItemForm({
  title,
  item,
  defaultKind,
  initialName,
  onClose,
  onSaved,
  onHistory,
  onRecipe,
  compact,
  mutations,
  pending,
}: {
  title: string;
  item?: IngredientDetails;
  defaultKind?: ItemKind;
  initialName?: string;
  onClose: () => void;
  onSaved?: (item: Ingredient) => void;
  onHistory?: (id: string) => void;
  onRecipe?: (item: Ingredient) => void;
  compact: boolean;
  mutations: ReturnType<typeof useIngredientMutations>;
  pending: boolean;
}) {
  const formId = useId();
  const pieceWeightErrorId = useId();
  const saving = useRef(false);
  const openingDetails = useRef<HTMLDetailsElement>(null);
  const { can } = usePermissions();
  const editable = can(item ? 'actions.warehouseSettings' : 'actions.warehouseReceive');
  const costs = can('actions.warehouseCosts');
  const categoriesId = useId();
  const [name, setName] = useState(item?.name ?? initialName ?? '');
  const kind: ItemKind = item?.kind ?? defaultKind ?? 'raw';
  const [unit, setUnit] = useState<UnitCode>(item?.displayUnit ?? (defaultKind === 'goods' ? 'pcs' : 'kg'));
  const [category, setCategory] = useState(item?.category ?? '');
  const catalogue = useIngredients('');
  const categories = [...new Set((catalogue.data ?? [])
    .filter(({ kind }) => kind === 'raw' || kind === 'consumable')
    .flatMap(({ category }) => category ? [category] : []))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const [supplier, setSupplier] = useState(item?.supplier ?? '');
  const [threshold, setThreshold] = useState(String(item?.lowStockThreshold ?? 0));
  const suppliers = useSuppliers(editable);
  const [mode, setMode] = useState<'stocked' | 'virtual'>(item?.preparationMode ?? 'stocked');
  const [losses, setLosses] = useState<Partial<Record<ProcessingMethod, number>>>(
    item?.processingLosses ?? {},
  );
  const [pieceWeight, setPieceWeight] = useState(item?.pieceWeightGrams == null ? '' : String(item.pieceWeightGrams));
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const prepared = kind === 'preparation' || kind === 'prepared_dish';
  const showOpening = !item && !compact && !prepared && editable && costs && can('actions.warehouseApprove');
  const locations = useWarehouseLocations(showOpening);
  const warehouses = locations.data?.locations ?? [];
  const [warehouseId, setWarehouseId] = useState('');
  const openingWarehouse = warehouseId || (warehouses.find((location) => location.isDefault) ?? warehouses[0])?.id || '';
  const [openingQuantity, setOpeningQuantity] = useState('');
  const [openingPrice, setOpeningPrice] = useState('');
  const [openingNotice, setOpeningNotice] = useState('');
  const [openingRequestKey] = useState(() => crypto.randomUUID());
  const mass = unitTypeOf(unit) === 'mass';
  const pieces = unitTypeOf(unit) === 'count';
  const pieceWeightGrams = parsePieceWeightGrams(pieceWeight);
  const unitOptions = item ? unitsForType(item.unitType) : UNIT_OPTIONS;
  const values = JSON.stringify([name, unit, category, supplier, threshold, mode, losses, pieceWeight,
    warehouseId, openingQuantity, openingPrice]);
  const initialValues = useRef(values);
  const dirty = editable && initialValues.current !== values;
  const { markSaved } = useEditorDirty(dirty);

  function requestClose() {
    if (pending || saving.current) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function changeUnit(next: UnitCode) {
    if (next === unit) return;
    const factor = unitConversionFactor(unit, next);
    const quantity = Number(openingQuantity) * (factor ?? 0);
    const format = (value: number) => String(Number(value.toPrecision(15)));
    setUnit(next);
    setOpeningNotice('');
    if (factor == null) setThreshold('0');
    else if (threshold.trim()) setThreshold(format(Number(threshold) * factor));
    if (!openingQuantity && !openingPrice) return;
    const preciseQuantity = Math.round(quantity * 1000) / 1000;
    if (factor == null || (openingQuantity && (quantity < 0.001 || format(quantity) !== format(preciseQuantity)))) {
      setOpeningQuantity('');
      setOpeningPrice('');
      setOpeningNotice('Единица изменилась. Укажите количество и цену для начальной поставки.');
      return;
    }
    if (openingQuantity) setOpeningQuantity(String(preciseQuantity));
    if (openingPrice) setOpeningPrice(format(Number(openingPrice) / factor));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending || saving.current || !editable) return;
    if (!name.trim() || !Number.isFinite(Number(threshold)) || Number(threshold) < 0) {
      setError('Проверьте название и минимальный остаток.');
      return;
    }
    if (pieces && pieceWeightGrams === undefined) return;
    const hasOpening = showOpening && (openingQuantity !== '' || openingPrice !== '');
    const quantity = Number(openingQuantity);
    const unitPrice = Number(openingPrice);
    if (hasOpening && (!Number.isFinite(quantity) || quantity < 0.001 || !openingPrice
      || !Number.isFinite(unitPrice) || unitPrice < 0 || !openingWarehouse)) {
      if (openingDetails.current) openingDetails.current.open = true;
      setError('Для начальной поставки укажите количество, цену за единицу и склад.');
      return;
    }
    setError('');
    saving.current = true;
    try {
      const body = {
        name: name.trim(),
        kind,
        unit,
        category: category.trim() || null,
        supplier: supplier.trim() || null,
        supplierId:
          supplier.trim() === item?.supplier
            ? (item.supplierId ?? null)
            : (suppliers.data?.find((s) => s.name === supplier.trim())?.id ?? null),
        lowStockThreshold: Number(threshold),
        preparationMode: mode,
        ...(mass ? { processingLosses: losses } : {}),
        ...(pieces ? { pieceWeightGrams } : {}),
      };
      const saved = item
        ? await mutations.update.mutateAsync({ ...body, id: item.id })
        : await mutations.create.mutateAsync({
          ...body,
          ...(hasOpening && { initialSupply: { quantity, unitPrice, warehouseId: openingWarehouse, requestKey: openingRequestKey } }),
        });
      markSaved();
      onClose();
      onSaved?.(saved);
    } catch (err) {
      setError(apiError(err));
    } finally {
      saving.current = false;
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
    <>
    <Modal open manageFocus onClose={requestClose} title={title} panelClassName="max-w-lg"
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost btn-md" disabled={pending} onClick={requestClose}>
          {editable ? 'Отмена' : 'Закрыть'}
        </button>
        {editable && <button type="submit" form={formId} className="btn-primary btn-md"
          disabled={pending || !name.trim() || (pieces && pieceWeightGrams === undefined)}>
          {pending ? 'Сохранение…' : 'Сохранить'}
        </button>}
      </div>}>
    <form id={formId} onSubmit={save} className="poster-form poster-form--ingredient">
      <fieldset disabled={!editable || pending} className="space-y-4">
        <DocumentField label="Название">
          <input
            aria-label="Название ингредиента"
            data-dialog-initial-focus
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </DocumentField>
        <DocumentField label="Ед. измерения">
          {unitOptions.length > 1 ? (
            <Select
              ariaLabel="Единица измерения"
              className="h-10 w-[136px]"
              value={unit}
              onChange={(v) => changeUnit(v as UnitCode)}
              options={unitOptions}
            />
          ) : <span className="block py-2.5 text-sm">{unitLabel(unit)}</span>}
        </DocumentField>
        {pieces && <DocumentField label="Вес одной штуки">
          <div className="poster-number-unit w-[136px]">
            <input aria-label="Вес одной штуки, г" aria-invalid={pieceWeightGrams === undefined || undefined}
              aria-describedby={pieceWeightGrams === undefined ? pieceWeightErrorId : undefined}
              className="input min-w-0 w-full" inputMode="decimal" maxLength={15} placeholder="—"
              value={pieceWeight} onChange={(event) => setPieceWeight(event.target.value)} />
            <span>г</span>
          </div>
          {pieceWeightGrams === undefined && <span id={pieceWeightErrorId} className="mt-1 block text-xs text-danger">
            Укажите положительный вес с точностью до трёх знаков после запятой.
          </span>}
        </DocumentField>}
        <DocumentField label="Категория">
          <input
            aria-label="Категория ингредиента"
            className="input w-full"
            list={categoriesId}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id={categoriesId}>{categories.map((entry) => <option key={entry} value={entry} />)}</datalist>
        </DocumentField>
        <details className="poster-advanced">
          <summary>Дополнительно</summary>
          <div className="space-y-4 pt-5">
            {mass && PROCESSING_METHODS.map((method) => (
              <DocumentField key={method.value} label={lossLabels[method.value]}>
                <div className="poster-number-unit w-[136px]">
                  <input
                    aria-label={lossLabels[method.value]}
                    className="input min-w-0 w-full"
                    type="number"
                    min="-999.99"
                    max="99.99"
                    step="0.01"
                    value={losses[method.value] ?? 0}
                    onChange={(e) => setLosses({ ...losses, [method.value]: Number(e.target.value) })}
                  />
                  <span>%</span>
                </div>
              </DocumentField>
            ))}
            {mass && <p className="text-xs text-text-muted">Отрицательный процент обозначает увеличение веса после обработки.</p>}
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
        {showOpening && <details ref={openingDetails} className="border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">Начальная поставка</summary>
          <div className="mt-3 space-y-4">
          <p className="max-w-3xl text-sm text-text-secondary">
            Если ингредиент уже есть в наличии, укажите количество, цену и склад. При сохранении будет проведена поставка.
          </p>
          {openingNotice && <p role="status" className="text-sm text-text-secondary">{openingNotice}</p>}
          <DocumentField label="Количество в наличии">
            <div className="poster-number-unit w-52 max-w-full">
              <input aria-label="Количество в наличии" className="input" type="number" inputMode="decimal"
                min="0.001" step="0.001" value={openingQuantity} onChange={(event) => setOpeningQuantity(event.target.value)} />
              <span>{unitLabel(unit)}</span>
            </div>
          </DocumentField>
          <DocumentField label={`Цена за ${unitLabel(unit)}`}>
            <div className="poster-number-unit w-52 max-w-full">
              <input aria-label={`Цена за ${unitLabel(unit)}`} className="input" type="number" inputMode="decimal"
                min="0" step="any" value={openingPrice} onChange={(event) => setOpeningPrice(event.target.value)} />
              <span>с</span>
            </div>
          </DocumentField>
          <DocumentField label="Склад">
            <Select ariaLabel="Склад начальной поставки" className="h-10 w-52 max-w-full" value={openingWarehouse}
              onChange={setWarehouseId} disabled={pending || !warehouses.length}
              options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
          </DocumentField>
          {locations.isError && <p role="alert" className="text-sm text-danger">{apiError(locations.error)}</p>}
          </div>
        </details>}
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
            <div className="mt-5"><IngredientUsageTable item={item} /></div>
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
    </form>
    </Modal>
    {confirmDiscard && <Modal open manageFocus title="Есть несохранённые изменения" onClose={() => setConfirmDiscard(false)}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary btn-md" data-dialog-initial-focus
          onClick={() => setConfirmDiscard(false)}>Продолжить редактирование</button>
        <button type="button" className="btn-danger btn-md" onClick={() => { markSaved(); onClose(); }}>Выйти без сохранения</button>
      </div>}>
      <p className="text-sm text-text-secondary">Изменения в карточке ингредиента ещё не сохранены.</p>
    </Modal>}
    </>
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
