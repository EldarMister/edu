import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Select } from '@/components/Select';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { Toggle } from '@/components/Toggle';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { api, apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { printReport } from '@/lib/report-output';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { routingOptions, usePreparationStations } from '@/features/kitchen/stations';
import { useAdminCategories, type AdminDish } from '../api';
import { IconPrinter } from '../components/icons';
import { dishTaxInput, dishTaxValue, MenuTaxSelect } from '../../settings/MenuTaxSelect';
import { useIngredients, type Ingredient, type Recipe, type RecipeMetadata } from './warehouse/api';
import { EditorPage } from './warehouse/EditorPage';
import { RecipeDraftFields } from './warehouse/RecipeDraftFields';
import {
  recipeDraftPayload, recipeDraftRows, recipePreviewItems, recipeQuantity, scaleRecipeDraftRows, validRecipeRows,
} from './warehouse/recipe-draft-values';
import { RecipeCostSummary } from './warehouse/RecipeCostSummary';
import { RecipeBatchPanel } from './warehouse/RecipeBatchPreview';
import { useRecipePreview, type RecipePreview } from './warehouse/recipe-preview-api';
import { ModifierDraftFields, type ModifierDraft } from './warehouse/ModifierDraftFields';
import { normalizeUnitLabel, unitLabel, unitLabelOptions } from './warehouse/units';
import { useWarehousePolicy } from './warehouse/settings-api';
import { salePrice } from './menu-sale-price';
import { WorkspaceHeaderActions } from './WorkspaceHeader';
import { MenuEntryPhoto } from './MenuEntryPhoto';

type MenuEntry = {
  dish: Omit<AdminDish, 'variants'> & {
    variants: (AdminDish['variants'][number] & { stockIngredientId?: string | null })[];
  };
  recipe: Recipe;
  modifiers: ModifierDraft;
};

type VariantDraft = {
  key: string;
  id?: string;
  name: string;
  price: string;
  unit: string;
};

const emptyModifiers: ModifierDraft = { allowIngredientExclusions: false, groups: [] };
const maxRecipePortions = 10_000;

function validPortionCount(count: number) {
  return Number.isSafeInteger(count) && count >= 1 && count <= maxRecipePortions;
}

function newVariant(): VariantDraft {
  return { key: crypto.randomUUID(), name: '', price: '', unit: 'шт' };
}

export function MenuEntryPage({ id, kind, categoryId, onClose, initialTab = 'main', initialVariantId, copy = false }: {
  id?: string;
  kind: 'goods' | 'recipe';
  categoryId?: string;
  onClose: () => void;
  initialTab?: 'main' | 'recipe';
  initialVariantId?: string;
  copy?: boolean;
}) {
  const [next, setNext] = useState<{ count: number; categoryId: string }>();
  const query = useQuery({
    queryKey: ['admin', 'menu-entry', id],
    enabled: !!id,
    queryFn: () => api.get<MenuEntry>('/admin/menu/entries/' + id).then((response) => response.data),
  });
  if (id && query.isPending) {
    return <EditorPage title="Загрузка позиции" onClose={onClose}><Spinner /></EditorPage>;
  }
  if (id && query.isError) {
    return <EditorPage title="Позиция меню" onClose={onClose}>
      <p role="alert" className="text-danger">{apiError(query.error)}</p>
      <button type="button" className="btn-secondary btn-md mt-4" onClick={() => query.refetch()}>Повторить</button>
    </EditorPage>;
  }
  return <MenuEntryForm key={next?.count ?? `${id ?? 'new'}:${copy}`} incoming={next ? undefined : query.data} kind={kind}
    copy={copy && !next}
    categoryId={next?.categoryId ?? categoryId} onClose={onClose} initialTab={initialTab} initialVariantId={initialVariantId}
    onCreateAnother={(selectedCategory) => setNext((current) => ({ count: (current?.count ?? 0) + 1, categoryId: selectedCategory }))} />;
}

function MenuEntryForm({ incoming, kind, categoryId, onClose, initialTab, initialVariantId, copy, onCreateAnother }: {
  incoming?: MenuEntry;
  kind: 'goods' | 'recipe';
  categoryId?: string;
  onClose: () => void;
  initialTab: 'main' | 'recipe';
  initialVariantId?: string;
  copy: boolean;
  onCreateAnother: (categoryId: string) => void;
}) {
  // The loaded version belongs to the current draft even if the query refreshes in the background.
  const [initial] = useState(incoming);
  const source = initial?.dish;
  const dish = copy ? undefined : source;
  const catalogKind = source?.catalogKind ?? kind;
  const isGoods = catalogKind === 'goods';
  const title = copy ? 'Копирование техкарты' : dish ? (isGoods ? 'Редактирование товара' : 'Редактирование техкарты')
    : (isGoods ? 'Добавление товара' : 'Добавление техкарты');
  const categories = useAdminCategories().data ?? [];
  const stations = usePreparationStations().data ?? [];
  const { can, canEditSection } = usePermissions();
  const canEdit = can('actions.editMenu');
  const canRecipe = can('actions.warehouseRecipes');
  const canCosts = can('actions.warehouseCosts');
  const canWarehouse = can('sections.warehouse');
  const warehousePolicy = useWarehousePolicy(canWarehouse && !isGoods && canRecipe);
  const productionEnabled = warehousePolicy.data?.warehouseProductionEnabled || warehousePolicy.data?.productionInUse;
  const stockQuery = useIngredients('', undefined, canWarehouse && !isGoods && canRecipe && !!productionEnabled);
  const stock = stockQuery.data;
  const qc = useQueryClient();
  const push = useNotifications((state) => state.push);
  const [requestKey] = useState(() => crypto.randomUUID());
  const formId = useId();
  const startRef = useRef<HTMLFieldSetElement>(null);
  const recipeRef = useRef<HTMLFieldSetElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const draggedVariant = useRef<number | null>(null);
  const [tax, setTax] = useState(() => dishTaxValue(source));
  const [form, setForm] = useState(() => ({
    name: copy && source ? `${source.name.slice(0, 112).trimEnd()} (копия)` : source?.name ?? '',
    categoryId: source?.categoryId ?? categoryId ?? '',
    price: source ? String(Number(source.price)) : '',
    description: source?.description ?? '',
    voiceName: source?.voiceName ?? '',
    prepStation: source?.prepStation ?? '',
    imageUrl: source?.imageUrl ?? '',
    isAvailable: copy ? false : source?.isAvailable ?? true,
    isWeighted: source?.isWeighted ?? false,
    weightedMeasure: source?.weightedMeasure ?? 'weight',
    weightedPriceBase: source?.weightedPriceBase ?? 100,
    unit: normalizeUnitLabel(source?.unit),
  }));
  const [variants, setVariants] = useState<VariantDraft[]>(() => (source?.variants ?? []).map((variant) => ({
    key: variant.id,
    id: copy ? undefined : variant.id,
    name: variant.name,
    price: String(Number(variant.price)),
    unit: normalizeUnitLabel(variant.unit),
  })));
  const [withVariants, setWithVariants] = useState(variants.length > 0);
  const activeVariants = !isGoods || withVariants ? variants : [];
  const [costVariantKey, setCostVariantKey] = useState(initialVariantId ?? '');
  const costVariant = activeVariants.find((variant) => variant.key === costVariantKey) ?? (isGoods ? activeVariants[0] : undefined);
  const [metadata, setMetadata] = useState<RecipeMetadata>(() => initial?.recipe.metadata ?? {});
  const savedPortions = initial?.recipe.metadata?.recipePortions ?? 1;
  const [recipePortions, setRecipePortions] = useState(validPortionCount(savedPortions) ? savedPortions : 1);
  const [inputPortions, setInputPortions] = useState(1);
  const [rows, setRows] = useState(() => recipeDraftRows(initial?.recipe.items ?? [], copy));
  const [basisOpen, setBasisOpen] = useState(false);
  const savedStockId = copy ? '' : initial?.recipe.stockIngredientId ?? '';
  const [producedStockId, setProducedStockId] = useState(savedStockId);
  const producedStock = stock?.find((item) => item.id === producedStockId && item.isPrepared);
  const canBindProducedStock = !!productionEnabled && !isGoods && canWarehouse && canRecipe
    && (!savedStockId || !!stock?.find((item) => item.id === savedStockId && item.isPrepared));
  const [initialModifiers] = useState<ModifierDraft>(() => {
    const { allowIngredientExclusions, excludableIngredientIds, groups } = initial?.modifiers ?? emptyModifiers;
    return { allowIngredientExclusions, excludableIngredientIds, groups: copy ? groups.map(({ id: _id, options, ...group }) => ({
      ...group, options: options.map(({ id: _id, ...option }) => option),
    })) : groups };
  });
  const [modifiers, setModifiers] = useState(initialModifiers);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [variantEditor, setVariantEditor] = useState<VariantDraft>();
  const submission = useRef(false);
  const snapshot = JSON.stringify([
    form, tax, activeVariants, withVariants, scaleRecipeDraftRows(rows, inputPortions, 1), metadata, modifiers, recipePortions, producedStockId,
  ]);
  const [baseline] = useState(snapshot);
  const { markSaved } = useEditorDirty(snapshot !== baseline || pending);
  const busy = pending || photoBusy;
  const weightedLocked = !!dish && isGoods && (!!dish.stockIngredientId || !!dish.hasDirectStock);
  const smallUnit = form.weightedMeasure === 'weight' ? 'г' : 'мл';
  const largeUnit = form.weightedMeasure === 'weight' ? 'кг' : 'л';
  const weightedPriceUnits = [1, 100, 1000].map((amount) => ({
    value: String(amount), label: amount === 1000 ? '1 ' + largeUnit : amount + ' ' + smallUnit,
  }));
  const priceBasis = weightedPriceUnits.find((unit) => unit.value === String(form.weightedPriceBase))?.label;
  const hasStockBinding = !isGoods && !!producedStockId;
  const validRows = validRecipeRows(rows);
  const hasVariantNorms = !!costVariant && rows.some((row) => row.variantAmounts?.[costVariant.id ?? costVariant.key] != null);
  const previewPrice = salePrice(costVariant?.price ?? form.price);
  const goodsBindingPending = isGoods && (!!costVariant && !costVariant.id || !withVariants && !dish?.stockIngredientId);
  const preview = useRecipePreview(canWarehouse && !goodsBindingPending && !!form.categoryId && (dish || rows.length || hasStockBinding)
    && (validRows || hasStockBinding || isGoods) ? {
      dishId: dish?.id,
      categoryId: form.categoryId,
      prepStation: form.prepStation === (dish?.prepStation ?? '') ? undefined : form.prepStation || null,
      variantId: costVariant?.id,
      price: previewPrice ?? 0,
      ...dishTaxInput(tax),
      ...(!isGoods && producedStockId !== savedStockId ? { producedStockIngredientId: producedStockId || null } : {}),
      weightedPriceBase: form.isWeighted ? form.weightedPriceBase : undefined,
      inputPortions: !isGoods && !dish?.isSet ? inputPortions : undefined,
      metadata: !isGoods ? { outputQuantity: hasVariantNorms ? undefined : metadata.outputQuantity, outputUnit: metadata.outputUnit } : undefined,
      items: !isGoods && !dish?.isSet && validRows
        ? recipePreviewItems(rows, activeVariants.flatMap(({ id }) => id ? [id] : []), costVariant?.id ? undefined : costVariant?.key)
        : [],
    } : null);

  useLayoutEffect(() => {
    if (initialTab === 'recipe' && canRecipe && !isGoods) {
      recipeRef.current?.scrollIntoView({ block: 'start' });
      return;
    }
    startRef.current?.scrollIntoView({ block: 'start' });
    if (canEdit) nameRef.current?.focus({ preventScroll: true });
  }, [initialTab, canEdit, canRecipe, isGoods]);

  function patch(value: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...value }));
  }

  function focusMain() {
    startRef.current?.scrollIntoView({ block: 'start' });
  }

  async function save(createAnother = false) {
    if (submission.current || photoBusy || !canEdit) return;
    setError('');
    if (!form.name.trim() || !form.categoryId) {
      focusMain();
      setError('Укажите название и категорию.');
      return;
    }
    if (isGoods && withVariants && !activeVariants.length) {
      setError('Добавьте хотя бы один вариант товара или выберите одну позицию.');
      return;
    }
    const price = salePrice(form.price);
    if (!activeVariants.length && price === null) {
      setError('Укажите цену продажи с точностью до двух знаков после запятой.');
      return;
    }
    const pricedVariants = activeVariants.map(({ key, id, name, price, unit }) => ({
      id, clientKey: key, name: name.trim(), price: salePrice(price) ?? 0, unit,
    }));
    if (pricedVariants.some((variant) => !variant.name || variant.name.length > 80 || variant.price <= 0)) {
      setError('Укажите название и цену больше нуля для каждого варианта. В цене допускаются два знака после запятой.');
      return;
    }
    if (canRecipe && !isGoods && !validRows) {
      recipeRef.current?.scrollIntoView({ block: 'start' });
      setError('Проверьте количество и этапы обработки. Для расчёта от нетто нужен положительный выход.');
      return;
    }
    submission.current = true;
    setPending(true);
    try {
      const recipeIngredientIds = new Set(rows.map(({ ingredientId }) => ingredientId));
      const modifiersToSave = { ...modifiers, excludableIngredientIds: modifiers.excludableIngredientIds
        ?.filter((ingredientId) => recipeIngredientIds.has(ingredientId)) ?? modifiers.excludableIngredientIds };
      const body = {
        catalogKind, requestKey, expectedVersion: copy ? undefined : initial?.recipe.version,
        dish: {
          ...form,
          ...(tax !== dishTaxValue(dish) ? dishTaxInput(tax) : {}),
          name: form.name.trim(),
          price: price ?? 0,
          prepStation: form.prepStation || null,
          variants: pricedVariants,
        },
        ...(canRecipe && !isGoods ? {
          recipe: {
            items: recipeDraftPayload(rows).map((row) => ({
              ...row,
              variantAmounts: Object.fromEntries(Object.entries(row.variantAmounts ?? {})
                .filter(([id]) => activeVariants.some((variant) => (variant.id ?? variant.key) === id))),
            })),
            metadata: dish?.isSet ? metadata : { ...metadata, recipePortions },
            ...(!dish?.isSet && { inputPortions }),
            ...(producedStockId !== savedStockId || (producedStock && (form.isWeighted !== dish?.isWeighted ||
              form.weightedMeasure !== dish?.weightedMeasure || form.weightedPriceBase !== dish?.weightedPriceBase))
              ? { producedStockIngredientId: producedStockId || null } : {}),
          },
          ...(JSON.stringify(modifiersToSave) !== JSON.stringify(copy ? emptyModifiers : initialModifiers)
            ? { modifiers: modifiersToSave } : {}),
        } : {}),
      };
      if (dish) await api.put('/admin/menu/entries/' + dish.id, body);
      else await api.post('/admin/menu/entries', body);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin'] }),
        qc.invalidateQueries({ queryKey: ['menu'] }),
      ]);
      push({ message: isGoods ? 'Товар сохранён' : 'Блюдо сохранено', at: new Date().toISOString() });
      markSaved();
      if (createAnother && !dish) onCreateAnother(form.categoryId);
      else onClose();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      submission.current = false;
      setPending(false);
    }
  }

  function addVariant() {
    const variant = newVariant();
    setVariants((current) => [...current, isGoods ? { ...variant, unit: form.unit } : variant]);
  }

  function changeVariant(key: string, value: Partial<VariantDraft>) {
    setVariants((current) => current.map((variant) => variant.key === key ? { ...variant, ...value } : variant));
  }

  function moveVariant(from: number, to: number) {
    setVariants((current) => {
      if (to < 0 || to >= current.length || to === from) return current;
      const next = [...current];
      const [variant] = next.splice(from, 1);
      next.splice(to, 0, variant);
      return next;
    });
  }

  function saveRecipeVariant(variant: VariantDraft) {
    setVariants((current) => current.some(({ key }) => key === variant.key)
      ? current.map((value) => value.key === variant.key ? variant : value)
      : [...current, variant]);
    setVariantEditor(undefined);
  }

  function printRecipe() {
    if (!preview.data?.items.length || preview.pending) return;
    const details = preview.data;
    const caption = [costVariant?.name, details.output
      ? 'Выход порции — ' + recipeQuantity(details.output.amount, unitLabel(details.output.unit)) : 'Выход порции не рассчитан']
      .filter(Boolean).join(' · ');
    const printed = printReport(form.name.trim() || 'Техкарта', caption, ['Ингредиент / полуфабрикат', 'Брутто', 'Нетто', 'Склад'],
      details.items.map((item) => [item.name, recipeQuantity(item.amount, unitLabel(item.amountUnit)),
        item.netWeightGrams != null ? recipeQuantity(item.netWeightGrams, 'г')
          : item.netAmount == null ? 'Не рассчитано' : recipeQuantity(item.netAmount, unitLabel(item.amountUnit)),
        item.warehouseName ?? 'По цеху']), { title: 'Технология приготовления', text: metadata.instructions ?? '' });
    setError(printed ? '' : 'Разрешите открытие окна печати в браузере.');
  }

  const variantCards = <div className="space-y-3">
    {activeVariants.map((variant, index) => <VariantCard key={variant.key} value={variant} index={index}
      count={activeVariants.length} disabled={!canEdit || busy} unitLocked={isGoods && !!variant.id}
      onChange={(value) => changeVariant(variant.key, value)}
      onMove={(direction) => moveVariant(index, index + direction)}
      onDragStart={canEdit && !busy ? () => { draggedVariant.current = index; } : undefined}
      onDragEnd={() => { draggedVariant.current = null; }}
      onDrop={() => {
        if (draggedVariant.current !== null) moveVariant(draggedVariant.current, index);
        draggedVariant.current = null;
      }}
      onRemove={() => setVariants((current) => current.filter((item) => item.key !== variant.key))} />)}
    <button type="button" className="btn-ghost btn-md px-2 text-primary" onClick={addVariant}>+ Добавить вариант</button>
  </div>;

  const priceLabel = priceBasis && form.isWeighted ? 'Цена за ' + priceBasis : 'Цена продажи';
  const priceInput = <PriceInput label={priceLabel} value={form.price} disabled={!canEdit || busy}
    onChange={(price) => patch({ price })} />;
  const priceMetrics = canWarehouse && (canCosts || preview.data?.stockItem) && <div className="min-w-0 space-y-3">
    {activeVariants.length > 0 && <div className="max-w-sm">
      <Select ariaLabel="Вариант для расчёта себестоимости" className="h-10 w-full" value={costVariant?.key ?? ''} onChange={setCostVariantKey}
        options={[...(!isGoods ? [{ value: '', label: 'Базовая норма' }] : []),
          ...activeVariants.map(({ key, name }, index) => ({ value: key, label: name || `Вариант ${index + 1}` }))]} />
    </div>}
    {goodsBindingPending ? <p className="text-sm text-text-secondary">Складская привязка появится после сохранения.</p>
      : <RecipeCostSummary preview={preview} showCosts={canCosts} showPriceMetrics={previewPrice != null && (!activeVariants.length || !!costVariant)}
        showMissing={isGoods || hasStockBinding || !!dish?.isSet || !canRecipe}
        showError={isGoods || hasStockBinding || !!dish?.isSet || !canRecipe} compactMetrics={!isGoods} />}
  </div>;
  const outputDetails = <RecipeOutput preview={preview.data} pending={preview.pending} metadata={metadata}
    manualApplies={!hasVariantNorms} editable={canEdit && !busy && !costVariant}
    onChange={(outputQuantity, outputUnit) => setMetadata((current) => ({ ...current, outputQuantity, outputUnit }))} />;

  function changeInputPortions(portions: number) {
    setRows((current) => scaleRecipeDraftRows(current, inputPortions, portions));
    setInputPortions(portions);
  }

  return (
    <EditorPage title={title} onClose={() => !busy && onClose()} footer={
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-2">
          {canEdit && <button type="submit" form={formId} className="btn-primary btn-md min-w-32 font-semibold" disabled={busy}>
            {pending ? <Spinner /> : 'Сохранить'}
          </button>}
          {canEdit && !dish && <button type="button" className="btn-secondary btn-md" onClick={() => void save(true)} disabled={busy}>
            Сохранить и создать ещё
          </button>}
          <button type="button" className="btn-ghost btn-md" onClick={onClose} disabled={busy}>{canEdit ? 'Отмена' : 'Закрыть'}</button>
        </div>
        {error && <p role="alert" className="min-w-0 grow text-sm text-danger">{error}</p>}
      </div>
    }>
      {!isGoods && canRecipe && <WorkspaceHeaderActions>
        <button type="button" className="btn-secondary btn-md inline-flex items-center gap-2" onClick={printRecipe}
          disabled={busy || preview.pending || !preview.data?.items.length}>
          <IconPrinter className="h-4 w-4" aria-hidden="true" /> Распечатать
        </button>
      </WorkspaceHeaderActions>}
      <form id={formId} className={'min-w-0 space-y-5 pt-1 sm:space-y-6 sm:pt-2' + (isGoods ? ' max-w-6xl' : '')} noValidate
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          void save();
        }}>
        <fieldset ref={startRef} disabled={!canEdit || busy} aria-label="Основные параметры"
          className="grid min-w-0 max-w-3xl scroll-mt-4 gap-3">
          <div className={isGoods ? 'grid min-w-0 gap-3' : 'grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-x-5'}>
            <FormRow label="Название" htmlFor={formId + '-name'} stacked={!isGoods}>
              <input id={formId + '-name'} ref={nameRef} className="input" value={form.name} maxLength={120}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder={isGoods ? 'Например, лимонад 0,5 л' : 'Например, капучино'} required />
            </FormRow>
            <FormRow label="Категория" stacked={!isGoods}>
              <Select searchable ariaLabel="Категория" placeholder="Выберите категорию" className="h-11 w-full"
                value={form.categoryId} disabled={!canEdit || busy} onChange={(value) => patch({ categoryId: value })}
                options={categories.map(({ id, name }) => ({ value: id, label: name }))} />
            </FormRow>
            <FormRow label="Цех приготовления" stacked={!isGoods}>
              <Select ariaLabel="Цех приготовления" className="h-11 w-full" value={form.prepStation} disabled={!canEdit || busy}
                onChange={(value) => patch({ prepStation: value })}
                options={[{ value: '', label: 'По категории' }, ...routingOptions(stations, form.prepStation)]} />
            </FormRow>
            <FormRow label="Налог" stacked={!isGoods}>
              <MenuTaxSelect value={tax} onChange={setTax} inherit disabled={!canEdit || busy}
                categoryTaxId={categories.find((category) => category.id === form.categoryId)?.taxId} />
            </FormRow>
          </div>
          <FormRow label="Обложка">
            <MenuEntryPhoto name={form.name} imageUrl={form.imageUrl} loading={photoBusy} onBusy={setPhotoBusy}
              onImage={(imageUrl) => patch({ imageUrl })}>
              <div className="grid min-w-0 gap-2">
                {(isGoods || dish || copy) && <label className="flex items-center justify-between gap-3 text-sm">
                  Доступно для заказа
                  <Toggle ariaLabel="Доступно для заказа" checked={form.isAvailable} onChange={(isAvailable) => patch({ isAvailable })} />
                </label>}
                <label className="flex items-center justify-between gap-3 text-sm">
                  {isGoods ? 'Весовой товар' : 'Весовое блюдо'}
                  <Toggle ariaLabel={isGoods ? 'Весовой товар' : 'Весовое блюдо'} checked={form.isWeighted} onChange={(isWeighted) => patch({ isWeighted })}
                    disabled={activeVariants.length > 0 || (isGoods && withVariants) || weightedLocked} />
                </label>
              </div>
            </MenuEntryPhoto>
            {form.isWeighted && <div className="mt-2 grid gap-3 border-l-2 border-border pl-3 min-[430px]:grid-cols-2">
              <Field label="Мера весовой позиции">
                <Select ariaLabel="Мера весовой позиции" className="h-11 w-full" value={form.weightedMeasure}
                  disabled={!canEdit || busy || (!!dish && isGoods)}
                  onChange={(value) => patch({ weightedMeasure: value as 'weight' | 'volume' })}
                  options={[{ value: 'weight', label: 'г / кг' }, { value: 'volume', label: 'мл / л' }]} />
              </Field>
              <Field label="Цена указана за">
                <Select ariaLabel="Количество в цене" className="h-11 w-full" value={String(form.weightedPriceBase)}
                  disabled={!canEdit || busy} onChange={(value) => patch({ weightedPriceBase: Number(value) })}
                  options={weightedPriceUnits} />
              </Field>
            </div>}
          </FormRow>
        </fieldset>

        <fieldset disabled={busy || (isGoods && !canEdit)} aria-label={isGoods ? 'Цена и варианты' : 'Цена и себестоимость'}
          className={'min-w-0 max-w-3xl' + (isGoods ? ' border-t border-border pt-4' : '')}>
          {isGoods ? <FormRow label="Цена товара">
            <div role="group" aria-label="Формат товара" className="divide-y divide-border rounded-xl border border-border">
              <div className={!withVariants ? 'bg-background/50' : undefined}>
                <ModeOption name={formId + '-mode'} checked={!withVariants} label="Без вариантов"
                  description="Одна цена и общий остаток" onSelect={() => {
                    if (!dish?.stockIngredientId && dish?.variants?.length === 1 && dish.variants[0].stockIngredientId) {
                      patch({ unit: normalizeUnitLabel(dish.variants[0].unit) });
                    }
                    setWithVariants(false);
                  }} />
                {!withVariants && <div className="space-y-3 px-4 pb-4">
                  <div className="grid gap-3 min-[430px]:grid-cols-2">
                    <Field label={priceLabel}>{priceInput}</Field>
                    {!form.isWeighted && <Field label="Единица учёта">
                      <Select ariaLabel="Единица учёта" className="h-11 w-full" value={form.unit}
                        disabled={!canEdit || busy || !!dish?.stockIngredientId}
                        onChange={(unit) => patch({ unit })} options={unitLabelOptions(form.unit)} />
                    </Field>}
                  </div>
                  {priceMetrics}
                </div>}
              </div>
              <div className={withVariants ? 'bg-background/50' : undefined}>
                <ModeOption name={formId + '-mode'} checked={withVariants} label="С вариантами"
                  description="Отдельные цены и остатки" disabled={form.isWeighted} onSelect={() => {
                    setWithVariants(true);
                    if (!variants.length) addVariant();
                  }} />
                {withVariants && <div className="space-y-4 px-4 pb-4">{variantCards}{priceMetrics}</div>}
              </div>
            </div>
          </FormRow> : <FormRow label={priceLabel}>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              {!activeVariants.length ? <div className="w-40 max-w-full">{priceInput}</div>
                : <p className="py-2.5 text-sm text-text-secondary">У каждого варианта своя цена</p>}
              {priceMetrics}
            </div>
          </FormRow>}
        </fieldset>

        {!isGoods && canRecipe && <fieldset ref={recipeRef} aria-label="Состав техкарты" disabled={busy}
          className="min-w-0 scroll-mt-4 space-y-3">
          {!!initial?.recipe.components?.length && <section className="space-y-2 rounded-xl border border-border p-4">
            <h3 className="font-semibold">Состав сета</h3>
            <ul className="divide-y divide-border text-sm">
              {initial.recipe.components.map((component) => <li key={`${component.dishId}:${component.variantId ?? ''}`} className="py-2">
                {component.dishName} × {component.quantity}
              </li>)}
            </ul>
          </section>}
          {!hasStockBinding && !dish?.isSet && <RecipeDraftFields rows={rows} onChange={setRows} showCosts={canCosts} disabled={!canEdit || busy}
            allowCreate={canEditSection('warehouse') && can('actions.warehouseReceive')}
            variants={activeVariants.map((variant) => ({ id: variant.id ?? variant.key, name: variant.name }))}
            preview={preview} previewVariant={costVariant?.key} inputPortions={inputPortions}
            outputDetails={outputDetails} showBatchPreview={false} batchAction={<>
              {!!rows.length && <button type="button" className="btn-ghost btn-md text-primary"
                disabled={busy || !preview.data?.items.length || preview.pending} onClick={() => setBatchOpen(true)}>Рассчитать партию</button>}
              {inputPortions > 1 && <button type="button" className="btn-ghost btn-md text-primary"
                onClick={() => changeInputPortions(1)}>Показать на одну порцию</button>}
            </>} />}
          {canBindProducedStock && hasStockBinding && <fieldset disabled={!canEdit}>
            <ProducedStockField items={stock ?? []} value={producedStockId}
              onChange={setProducedStockId} savedStockId={savedStockId} canProduce={can('actions.warehouseProduce')} />
          </fieldset>}
        </fieldset>}
        {!isGoods && !form.isWeighted && !dish?.isSet && <fieldset aria-label="Варианты порций" disabled={!canEdit || busy}
          className="min-w-0 space-y-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Варианты порций</h2>
            <button type="button" className="btn-ghost btn-md text-primary" onClick={() => setVariantEditor(newVariant())}>+ Добавить вариант</button>
          </div>
          {activeVariants.length > 0 && <ul className="divide-y divide-border">
            {activeVariants.map((variant, index) => <li key={variant.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
              draggable={canEdit && !busy} onDragStart={() => { draggedVariant.current = index; }}
              onDragEnd={() => { draggedVariant.current = null; }} onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedVariant.current !== null) moveVariant(draggedVariant.current, index);
                draggedVariant.current = null;
              }}>
              <span className="grow break-words text-sm font-medium">{variant.name || `Вариант ${index + 1}`}</span>
              <span className="text-sm tabular-nums">{salePrice(variant.price) == null ? 'Цена не указана' : money(variant.price)}</span>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" className="btn-ghost h-8 px-2" aria-label={`Поднять ${variant.name}`}
                  disabled={index === 0} onClick={() => moveVariant(index, index - 1)}>↑</button>
                <button type="button" className="btn-ghost h-8 px-2" aria-label={`Опустить ${variant.name}`}
                  disabled={index === activeVariants.length - 1} onClick={() => moveVariant(index, index + 1)}>↓</button>
                <button type="button" className="btn-ghost h-8 px-2 text-primary" onClick={() => setVariantEditor({ ...variant })}>Изменить</button>
                <button type="button" className="btn-ghost h-8 px-2 text-danger"
                  onClick={() => setVariants((current) => current.filter(({ key }) => key !== variant.key))}>Удалить</button>
              </div>
            </li>)}
          </ul>}
        </fieldset>}
        {!isGoods && canRecipe && <fieldset disabled={!canEdit || busy} className="min-w-0 border-t border-border pt-4">
          <ModifierDraftFields value={modifiers} onChange={setModifiers} recipeIngredientIds={rows.map(({ ingredientId }) => ingredientId)} />
        </fieldset>}
        <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-3 border-t border-border pt-4">
          <details className="max-w-3xl">
            <summary className="w-fit cursor-pointer text-sm font-semibold text-primary">Дополнительно</summary>
            <div className="mt-3 grid gap-3">
              <FormRow label="Описание" htmlFor={formId + '-description'}>
                <textarea id={formId + '-description'} className="input min-h-20 py-2" value={form.description} maxLength={300}
                  onChange={(event) => patch({ description: event.target.value })} />
              </FormRow>
              <FormRow label="Название для озвучки" htmlFor={formId + '-voice-name'}>
                <input id={formId + '-voice-name'} className="input" value={form.voiceName} maxLength={120}
                  placeholder="Как произносить вслух" onChange={(event) => patch({ voiceName: event.target.value })} />
              </FormRow>
              {!isGoods && canRecipe && !dish?.isSet && <>
                <FormRow label="Технология приготовления" htmlFor={formId + '-instructions'}>
                  <textarea id={formId + '-instructions'} className="input min-h-24 py-2" value={metadata.instructions ?? ''} maxLength={12_000}
                    onChange={(event) => setMetadata((current) => ({ ...current, instructions: event.target.value }))} />
                </FormRow>
                {!hasStockBinding && <FormRow label="Нормы рецепта">
                  <button type="button" className="btn-secondary btn-md" onClick={() => setBasisOpen(true)}>Ввести нормы на партию</button>
                </FormRow>}
              </>}
              {canBindProducedStock && !hasStockBinding && <ProducedStockField items={stock ?? []} value={producedStockId}
                onChange={setProducedStockId} savedStockId={savedStockId} canProduce={can('actions.warehouseProduce')} />}
            </div>
          </details>
        </fieldset>
      </form>
      {batchOpen && createPortal(<Modal open manageFocus title="Расчёт партии" onClose={() => setBatchOpen(false)} panelClassName="max-w-xl">
        <RecipeBatchPanel preview={preview.data} pending={preview.pending} showCosts={canCosts} />
      </Modal>, document.body)}
      {basisOpen && <RecipeBasisDialog initial={recipePortions} onClose={() => setBasisOpen(false)}
        onApply={(portions) => {
          changeInputPortions(portions);
          setRecipePortions(portions);
          setBasisOpen(false);
          recipeRef.current?.scrollIntoView({ block: 'start' });
        }} />}
      {variantEditor && <RecipeVariantDialog initial={variantEditor} editing={variants.some(({ key }) => key === variantEditor.key)}
        onSave={saveRecipeVariant} onClose={() => setVariantEditor(undefined)} />}
    </EditorPage>
  );
}

function RecipeBasisDialog({ initial, onApply, onClose }: {
  initial: number; onApply: (portions: number) => void; onClose: () => void;
}) {
  const formId = useId();
  const [value, setValue] = useState(String(initial));
  const portions = Number(value);
  const valid = validPortionCount(portions);
  return createPortal(<Modal open manageFocus title="Нормы на партию" onClose={onClose} panelClassName="max-w-md"
    footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={onClose}>Отмена</button>
      <button type="submit" form={formId} className="btn-primary btn-md" disabled={!valid}>Применить</button>
    </div>}>
    <form id={formId} noValidate className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (valid) onApply(portions);
    }}>
      <p className="text-sm text-text-secondary">Укажите, на сколько порций вы отмерили ингредиенты. EDU POS пересчитает введённые количества на одну порцию.</p>
      <label className="grid w-fit gap-1 text-sm">
        Количество порций
        <input data-dialog-initial-focus type="number" min={1} max={maxRecipePortions} step={1} inputMode="numeric"
          className="input w-32 tabular-nums" value={value} aria-invalid={!valid || undefined}
          aria-describedby={!valid ? formId + '-error' : undefined}
          onChange={(event) => setValue(event.target.value)} />
      </label>
      {!valid && <p id={formId + '-error'} className="text-sm text-danger">Введите целое число от 1 до 10 000.</p>}
    </form>
  </Modal>, document.body);
}

function RecipeVariantDialog({ initial, editing, onSave, onClose }: {
  initial: VariantDraft; editing: boolean; onSave: (variant: VariantDraft) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const canSave = !!value.name.trim() && (salePrice(value.price) ?? 0) > 0;
  return createPortal(<Modal open manageFocus title={editing ? 'Вариант порции' : 'Добавление варианта порции'} onClose={onClose}
    footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={onClose}>Отмена</button>
      <button type="button" className="btn-primary btn-md" disabled={!canSave} onClick={() => onSave(value)}>Применить</button>
    </div>}>
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">Название варианта
        <input className="input" data-dialog-initial-focus maxLength={80} value={value.name}
          onChange={(event) => setValue({ ...value, name: event.target.value })} />
      </label>
      <Field label="Цена продажи"><PriceInput label="Цена варианта" value={value.price}
        onChange={(price) => setValue({ ...value, price })} /></Field>
      <Field label="Единица учёта"><Select ariaLabel="Единица учёта варианта" className="w-full" value={value.unit}
        onChange={(unit) => setValue({ ...value, unit })} options={unitLabelOptions(value.unit)} /></Field>
    </div>
  </Modal>, document.body);
}

function RecipeOutput({ preview, pending, metadata, manualApplies, editable, onChange }: {
  preview?: RecipePreview; pending: boolean; metadata: RecipeMetadata; manualApplies: boolean; editable: boolean;
  onChange: (amount?: number, unit?: string) => void;
}) {
  const amountId = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [unit, setUnit] = useState('г');
  const manual = manualApplies && metadata.outputQuantity != null && !!metadata.outputUnit;
  const calculated = preview?.compositionOutput ?? (!manual ? preview?.output : null);
  const output = manual ? { amount: metadata.outputQuantity!, unit: normalizeUnitLabel(metadata.outputUnit ?? calculated?.unit ?? 'г') }
    : preview?.output;
  const amount = Number(input.trim().replace(',', '.'));
  const valid = Number.isFinite(amount) && amount >= 0.001;
  const close = () => setOpen(false);

  return <>
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span>Выход порции <strong className="tabular-nums">{output
        ? recipeQuantity(output.amount, normalizeUnitLabel(output.unit)) : pending ? 'Расчёт…' : 'Не рассчитан'}</strong></span>
      {manual && <span className="text-xs text-text-muted">Указан вручную{calculated &&
        ` · По составу ${recipeQuantity(calculated.amount, unitLabel(calculated.unit))}`}</span>}
      {editable && <button type="button" className="text-sm text-primary hover:underline" onClick={() => {
        setInput(output ? String(output.amount) : '');
        setUnit(normalizeUnitLabel(output?.unit ?? calculated?.unit ?? 'г'));
        setOpen(true);
      }}>Уточнить выход</button>}
    </span>
    {open && createPortal(<Modal open manageFocus title="Выход порции" onClose={close} footer={
      <div className="flex flex-wrap justify-end gap-2">
        {manual && <button type="button" className="btn-ghost btn-md" onClick={() => { onChange(); close(); }}>Считать по составу</button>}
        <button type="button" className="btn-primary btn-md" disabled={!valid} onClick={() => { onChange(amount, unit); close(); }}>Применить</button>
      </div>}>
      <label className="mb-1 block text-sm" htmlFor={amountId}>Фактический выход одной порции</label>
      <div className="flex items-center gap-2">
        <input id={amountId} className="input min-w-0 flex-1" data-dialog-initial-focus inputMode="decimal"
          value={input} onChange={(event) => setInput(event.target.value)} />
        <Select ariaLabel="Ед. измерения выхода" value={unit} onChange={setUnit} options={unitLabelOptions(unit)} />
      </div>
      {calculated && <p className="mt-2 text-sm text-text-muted">По составу {recipeQuantity(calculated.amount, unitLabel(calculated.unit))}</p>}
    </Modal>, document.body)}
  </>;
}

function ProducedStockField({ items, value, onChange, savedStockId, canProduce }: {
  items: Ingredient[];
  value: string;
  onChange: (id: string) => void;
  savedStockId: string;
  canProduce: boolean;
}) {
  const options = items.filter((item) => item.isPrepared && item.preparationMode === 'stocked' &&
    (item.recipeOutputQuantity != null || item.id === savedStockId));
  const target = (action: 'recipe' | 'produce') => ({ search: new URLSearchParams({
    section: 'warehouse', view: 'production', editor: 'preparation', action, id: value,
  }).toString() });
  return <div className="space-y-3 rounded-xl border border-border p-4">
    <Field label="Складской учёт блюда">
      <Select ariaLabel="Складской учёт блюда" value={value} onChange={onChange} options={[
        { value: '', label: 'Списывать ингредиенты по техкарте' },
        ...options.map((item) => ({ value: item.id, label: item.name })),
      ]} />
    </Field>
    {value && <p className="text-sm text-text-secondary">При продаже списывается готовая продукция со склада.</p>}
    {value && value === savedStockId && <div className="flex flex-wrap gap-3">
      <Link className="text-sm text-primary" to={target('recipe')}>Рецептура выпуска</Link>
      {canProduce && <Link className="text-sm text-primary" to={target('produce')}>Провести производство</Link>}
    </div>}
  </div>;
}

function FormRow({ label, htmlFor, children, stacked = false }: { label: string; htmlFor?: string; children: ReactNode; stacked?: boolean }) {
  const labelClass = 'text-sm font-medium text-text-secondary' + (stacked ? '' : ' sm:pt-2.5');
  return <div className={'grid min-w-0 gap-1.5' + (stacked ? '' : ' sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-5')}>
    {htmlFor ? <label htmlFor={htmlFor} className={labelClass}>{label}</label> : <div className={labelClass}>{label}</div>}
    <div className="min-w-0">{children}</div>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0">
    <p className="mb-1.5 text-sm font-medium text-text-secondary">{label}</p>
    {children}
  </div>;
}

function ModeOption({ name, checked, label, description, onSelect, disabled }: {
  name: string; checked: boolean; label: string; description: string; onSelect: () => void; disabled?: boolean;
}) {
  return <label className="flex min-h-12 cursor-pointer items-start gap-3 px-4 py-3 has-[:disabled]:cursor-default">
    <input className="mt-1 shrink-0" type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} />
    <span className="min-w-0"><span className={'block text-sm font-semibold ' + (checked ? 'text-primary' : 'text-text-primary')}>{label}</span>
      <span className="block text-xs text-text-muted">{description}</span></span>
  </label>;
}

function PriceInput({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (price: string) => void; disabled?: boolean;
}) {
  return <div className="relative">
    <input aria-label={label} type="text" inputMode="decimal" className="input !pr-9"
      value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-text-muted">с</span>
  </div>;
}

function VariantCard({ value, index, count, disabled, unitLocked, onChange, onMove, onRemove, onDragStart, onDragEnd, onDrop }: {
  value: VariantDraft; index: number; count: number; disabled: boolean; unitLocked: boolean;
  onChange: (value: Partial<VariantDraft>) => void;
  onMove: (direction: -1 | 1) => void; onRemove: () => void;
  onDragStart?: () => void; onDragEnd: () => void; onDrop: () => void;
}) {
  const caption = value.name || 'Вариант ' + (index + 1);
  return <div className="min-w-0 rounded-lg border border-border bg-background/50 p-3 sm:p-4"
    draggable={!!onDragStart} onDragStart={onDragStart} onDragEnd={onDragEnd}
    onDragOver={(event) => { if (onDragStart) event.preventDefault(); }}
    onDrop={(event) => { if (onDragStart) { event.preventDefault(); onDrop(); } }}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{caption}</h3>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={'Поднять ' + caption} className="btn-ghost h-8 px-2"
          disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button type="button" aria-label={'Опустить ' + caption} className="btn-ghost h-8 px-2"
          disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
        <button type="button" aria-label={'Удалить ' + caption} className="btn-ghost h-8 px-2 text-danger" onClick={onRemove}>Удалить</button>
      </div>
    </div>
    <div className="grid gap-3 min-[430px]:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr]">
      <Field label="Название варианта">
        <input aria-label="Название варианта" className="input" placeholder="Например, 250 мл" value={value.name}
          maxLength={80} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <Field label="Цена продажи">
        <PriceInput label={'Цена ' + caption} value={value.price} onChange={(price) => onChange({ price })} />
      </Field>
      <Field label="Единица учёта">
        <Select ariaLabel={'Единица учёта ' + caption} className="h-11 w-full" value={value.unit}
          disabled={disabled || unitLocked} onChange={(unit) => onChange({ unit })} options={unitLabelOptions(value.unit)} />
      </Field>
    </div>
  </div>;
}
