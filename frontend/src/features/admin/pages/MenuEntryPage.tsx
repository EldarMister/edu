import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { Toggle } from '@/components/Toggle';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { api, apiError } from '@/lib/api';
import { downscaleToDataUrl, resolveApiImage } from '@/lib/image';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { routingOptions, usePreparationStations } from '@/features/kitchen/stations';
import { useAdminCategories, type AdminDish } from '../api';
import { IconPlus } from '../components/icons';
import { dishTaxInput, dishTaxValue, MenuTaxSelect } from '../../settings/MenuTaxSelect';
import { useIngredients, type Ingredient, type Recipe, type RecipeMetadata } from './warehouse/api';
import { EditorPage } from './warehouse/EditorPage';
import { RecipeDraftFields } from './warehouse/RecipeDraftFields';
import { recipeDraftPayload, recipeDraftRows, recipePreviewItems, validRecipeRows } from './warehouse/recipe-draft-values';
import { RecipeCostSummary } from './warehouse/RecipeCostSummary';
import { useRecipePreview } from './warehouse/recipe-preview-api';
import { ModifierDraftFields, type ModifierDraft } from './warehouse/ModifierDraftFields';
import { normalizeUnitLabel, unitLabelOptions } from './warehouse/units';
import { useWarehousePolicy } from './warehouse/settings-api';

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

function newVariant(): VariantDraft {
  return { key: crypto.randomUUID(), name: '', price: '', unit: 'шт' };
}

function salePrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.').replace(/^0+(?=\d)/, '');
  if (!/^(?:\d{1,8}(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return null;
  return Number(normalized);
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
  const title = copy ? 'Копирование техкарты' : dish ? (isGoods ? 'Редактирование товара' : 'Редактирование блюда')
    : (isGoods ? 'Добавление товара' : 'Добавление блюда');
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
  const [rows, setRows] = useState(() => recipeDraftRows(initial?.recipe.items ?? [], copy));
  const [metadata, setMetadata] = useState<RecipeMetadata>(() => initial?.recipe.metadata ?? {});
  const savedStockId = copy ? '' : initial?.recipe.stockIngredientId ?? '';
  const [producedStockId, setProducedStockId] = useState(savedStockId);
  const producedStock = stock?.find((item) => item.id === producedStockId && item.isPrepared);
  const canBindProducedStock = !!productionEnabled && !isGoods && canWarehouse && canRecipe
    && (!savedStockId || !!stock?.find((item) => item.id === savedStockId && item.isPrepared));
  const [initialModifiers] = useState<ModifierDraft>(() => {
    const { allowIngredientExclusions, groups } = initial?.modifiers ?? emptyModifiers;
    return { allowIngredientExclusions, groups: copy ? groups.map(({ id: _id, options, ...group }) => ({
      ...group, options: options.map(({ id: _id, ...option }) => option),
    })) : groups };
  });
  const [modifiers, setModifiers] = useState(initialModifiers);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(form.imageUrl.startsWith('http') ? form.imageUrl : '');
  const submission = useRef(false);
  const snapshot = JSON.stringify([form, tax, activeVariants, withVariants, rows, metadata, modifiers, photoUrl, producedStockId]);
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
      metadata: !isGoods ? { outputQuantity: metadata.outputQuantity, outputUnit: metadata.outputUnit } : undefined,
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
    const typedPhotoUrl = photoUrl.trim();
    if (typedPhotoUrl && !/^https?:\/\/.+/i.test(typedPhotoUrl)) {
      setError('Ссылка на фото должна начинаться с https:// или http://.');
      return;
    }
    submission.current = true;
    setPending(true);
    try {
      const body = {
        catalogKind, requestKey, expectedVersion: copy ? undefined : initial?.recipe.version,
        dish: {
          ...form,
          ...(tax !== dishTaxValue(dish) ? dishTaxInput(tax) : {}),
          name: form.name.trim(),
          price: price ?? 0,
          imageUrl: typedPhotoUrl || form.imageUrl,
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
            metadata,
            ...(producedStockId !== savedStockId || (producedStock && (form.isWeighted !== dish?.isWeighted ||
              form.weightedMeasure !== dish?.weightedMeasure || form.weightedPriceBase !== dish?.weightedPriceBase))
              ? { producedStockIngredientId: producedStockId || null } : {}),
          },
          ...(JSON.stringify(modifiers) !== JSON.stringify(copy ? emptyModifiers : initialModifiers)
            ? { modifiers } : {}),
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
  const priceInput = <PriceInput label={priceLabel} value={form.price} onChange={(price) => patch({ price })} />;
  const priceMetrics = canWarehouse && (canCosts || preview.data?.stockItem) && <div className="space-y-3">
    {activeVariants.length > 0 && <div className="max-w-sm">
      <Select ariaLabel="Вариант для расчёта себестоимости" className="h-10 w-full" value={costVariant?.key ?? ''} onChange={setCostVariantKey}
        options={[...(!isGoods ? [{ value: '', label: 'Базовая норма' }] : []),
          ...activeVariants.map(({ key, name }, index) => ({ value: key, label: name || `Вариант ${index + 1}` }))]} />
    </div>}
    {goodsBindingPending ? <p className="text-sm text-text-secondary">Складская привязка появится после сохранения.</p>
      : <RecipeCostSummary preview={preview} showCosts={canCosts} showPriceMetrics={previewPrice != null && (!activeVariants.length || !!costVariant)}
        showMissing={isGoods || hasStockBinding || !!dish?.isSet || !canRecipe}
        showError={isGoods || hasStockBinding || !!dish?.isSet || !canRecipe} />}
  </div>;

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
      <form id={formId} className="min-w-0 max-w-6xl space-y-5 pt-1 sm:space-y-6 sm:pt-2" noValidate
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          void save();
        }}>
        <fieldset ref={startRef} disabled={!canEdit || busy} aria-label="Основные параметры"
          className="grid min-w-0 max-w-3xl scroll-mt-4 gap-3 sm:gap-4">
          <FormRow label="Название" htmlFor={formId + '-name'}>
            <input id={formId + '-name'} ref={nameRef} className="input" value={form.name} maxLength={120}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder={isGoods ? 'Например, лимонад 0,5 л' : 'Например, капучино'} required />
          </FormRow>
          <FormRow label="Категория">
            <Select searchable ariaLabel="Категория" placeholder="Выберите категорию" className="h-11 w-full"
              value={form.categoryId} disabled={!canEdit || busy} onChange={(value) => patch({ categoryId: value })}
              options={categories.map(({ id, name }) => ({ value: id, label: name }))} />
          </FormRow>
          <FormRow label="Цех приготовления">
            <Select ariaLabel="Цех приготовления" className="h-11 w-full" value={form.prepStation} disabled={!canEdit || busy}
              onChange={(value) => patch({ prepStation: value })}
              options={[{ value: '', label: 'По категории' }, ...routingOptions(stations, form.prepStation)]} />
          </FormRow>
          <FormRow label="Налог">
            <MenuTaxSelect value={tax} onChange={setTax} inherit disabled={!canEdit || busy}
              categoryTaxId={categories.find((category) => category.id === form.categoryId)?.taxId} />
          </FormRow>
          <FormRow label="Обложка">
            <CoverEditor name={form.name} imageUrl={form.imageUrl} photoUrl={photoUrl} loading={photoBusy}
              onUrl={setPhotoUrl} onBusy={setPhotoBusy} onError={setError}
              onImage={(imageUrl) => patch({ imageUrl })}>
              <div className="grid gap-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  Доступно для заказа
                  <Toggle checked={form.isAvailable} onChange={(isAvailable) => patch({ isAvailable })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  {isGoods ? 'Весовой товар' : 'Весовое блюдо'}
                  <Toggle checked={form.isWeighted} onChange={(isWeighted) => patch({ isWeighted })}
                    disabled={activeVariants.length > 0 || (isGoods && withVariants) || weightedLocked} />
                </label>
              </div>
            </CoverEditor>
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

        <fieldset disabled={!canEdit || busy} aria-label="Цена и варианты" className="min-w-0 max-w-3xl border-t border-border pt-5">
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
          </FormRow> : <div className="grid gap-4">
            {(!activeVariants.length || priceMetrics) && <FormRow label={activeVariants.length ? 'Расчёт себестоимости' : priceLabel}>
              <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
                {!activeVariants.length && <div className="w-full min-[480px]:w-44">{priceInput}</div>}
                {priceMetrics}
              </div>
            </FormRow>}
            {!form.isWeighted && <FormRow label="Варианты порций">{variantCards}</FormRow>}
          </div>}
        </fieldset>

        <fieldset disabled={!canEdit || busy} className="min-w-0 max-w-3xl">
          <details className="border-t border-border pt-4">
            <summary className="w-fit cursor-pointer text-sm font-semibold text-primary">Дополнительно</summary>
            <div className="mt-4 grid gap-3 sm:gap-4">
              <FormRow label="Описание" htmlFor={formId + '-description'}>
                <textarea id={formId + '-description'} className="input min-h-24 py-2.5" value={form.description} maxLength={300}
                  onChange={(event) => patch({ description: event.target.value })} />
              </FormRow>
              <FormRow label="Название для озвучки" htmlFor={formId + '-voice-name'}>
                <input id={formId + '-voice-name'} className="input" value={form.voiceName} maxLength={120}
                  placeholder="Как произносить вслух" onChange={(event) => patch({ voiceName: event.target.value })} />
              </FormRow>
            </div>
          </details>
        </fieldset>

        {!isGoods && canRecipe && <fieldset ref={recipeRef} disabled={!canEdit || busy} className="min-w-0 scroll-mt-4 space-y-5">
          {canBindProducedStock && <ProducedStockField items={stock ?? []} value={producedStockId} onChange={setProducedStockId}
            savedStockId={savedStockId} canProduce={can('actions.warehouseProduce')} />}
          {!!initial?.recipe.components?.length && <section className="space-y-2 rounded-xl border border-border p-4">
            <h3 className="font-semibold">Состав сета</h3>
            <ul className="divide-y divide-border text-sm">
              {initial.recipe.components.map((component) => <li key={`${component.dishId}:${component.variantId ?? ''}`} className="py-2">
                {component.dishName} × {component.quantity}
              </li>)}
            </ul>
          </section>}
          {!hasStockBinding && !dish?.isSet && <>
          <RecipeDraftFields rows={rows} onChange={setRows} showCosts={canCosts} disabled={!canEdit || busy}
            allowCreate={canEditSection('warehouse') && can('actions.warehouseReceive')}
            variants={activeVariants.map((variant) => ({ id: variant.id ?? variant.key, name: variant.name }))}
            preview={preview} previewVariant={costVariant?.key} />
          <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <Field label="Выход готового блюда">
              <div className="flex gap-2">
                <input aria-label="Выход готового блюда" className="input min-w-0 flex-1" type="number" min="0.001" step="any"
                  value={metadata.outputQuantity ?? ''}
                  onChange={(event) => setMetadata((current) => ({
                    ...current, outputQuantity: event.target.value ? Number(event.target.value) : undefined,
                  }))} />
                <input aria-label="Единица выхода" className="input w-20" placeholder="г" value={metadata.outputUnit ?? ''}
                  onChange={(event) => setMetadata((current) => ({ ...current, outputUnit: event.target.value }))} />
              </div>
            </Field>
            <Field label="Способ приготовления">
              <textarea aria-label="Способ приготовления" className="input min-h-24" value={metadata.instructions ?? ''}
                onChange={(event) => setMetadata((current) => ({ ...current, instructions: event.target.value }))} />
            </Field>
          </div>
          </>}
          <ModifierDraftFields value={modifiers} onChange={setModifiers} />
        </fieldset>}
      </form>
    </EditorPage>
  );
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

function FormRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const labelClass = 'text-sm font-medium text-text-secondary sm:pt-2.5';
  return <div className="grid min-w-0 gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-5">
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

function PriceInput({ label, value, onChange }: {
  label: string; value: string; onChange: (price: string) => void;
}) {
  return <div className="relative">
    <input aria-label={label} type="text" inputMode="decimal" className="input !pr-9"
      value={value} onChange={(event) => onChange(event.target.value)} />
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

function CoverEditor({ name, imageUrl, photoUrl, loading, onUrl, onImage, onBusy, onError, children }: {
  name: string; imageUrl: string; photoUrl: string; loading: boolean;
  onUrl: (value: string) => void; onImage: (value: string) => void;
  onBusy: (value: boolean) => void; onError: (value: string) => void;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  function previewUrl() {
    const value = photoUrl.trim();
    if (!value) return;
    if (!/^https?:\/\/.+/i.test(value)) {
      onError('Ссылка на фото должна начинаться с https:// или http://.');
      return;
    }
    onImage(value);
    onError('');
  }

  return <div className="space-y-3" onKeyDown={(event) => {
    if (expanded && event.key === 'Escape') {
      event.stopPropagation();
      setExpanded(false);
      trigger.current?.focus();
    }
  }}>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          onError('Фото: только PNG, JPG или WEBP.');
          return;
        }
        onBusy(true);
        onError('');
        try {
          onImage(await downscaleToDataUrl(file));
          onUrl('');
        } catch (failure) {
          onError(apiError(failure));
        } finally {
          onBusy(false);
        }
      }} />
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <button ref={trigger} type="button" aria-label={imageUrl ? 'Изменить обложку' : 'Добавить обложку'}
        aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}
        className={'flex h-24 w-32 items-center justify-center overflow-hidden rounded-lg border bg-background text-primary transition-colors hover:border-primary ' +
          (expanded ? 'border-primary' : 'border-border')}>
        {loading ? <Spinner /> : imageUrl ? <img src={resolveApiImage(imageUrl) ?? undefined} alt={name || 'Фото позиции'}
          className="h-full w-full object-cover" /> : <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium">
          <span aria-hidden="true"><IconPlus className="h-4 w-4" /></span> Добавить фото
        </span>}
      </button>
      {children}
    </div>
    <div id={panelId} hidden={!expanded} className="rounded-xl border border-border bg-background/50 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary btn-md" onClick={() => input.current?.click()}>Выбрать файл</button>
        {imageUrl && <button type="button" className="btn-ghost btn-md text-danger" onClick={() => {
          onImage(''); onUrl(''); onError('');
        }}>Удалить фото</button>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input aria-label="Ссылка на фото" className="input min-w-0 flex-[1_1_11rem]" type="url" placeholder="https://…"
          value={photoUrl} onChange={(event) => onUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); previewUrl(); } }} />
        <button type="button" className="btn-secondary btn-md shrink-0" disabled={!photoUrl.trim()} onClick={previewUrl}>По ссылке</button>
      </div>
    </div>
  </div>;
}
