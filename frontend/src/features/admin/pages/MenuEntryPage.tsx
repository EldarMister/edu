import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { api, apiError } from '@/lib/api';
import { money, taxRateLabel } from '@/lib/format';
import { downscaleToDataUrl, resolveApiImage } from '@/lib/image';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { routingOptions, usePreparationStations } from '@/features/kitchen/stations';
import { useAdminCategories, type AdminDish } from '../api';
import { dishTaxInput, dishTaxValue, MenuTaxSelect } from '../../settings/MenuTaxSelect';
import { useIngredients, type Ingredient, type Recipe, type RecipeMetadata } from './warehouse/api';
import { EditorPage } from './warehouse/EditorPage';
import { RecipeDraftFields, recipeDraftCost, recipeDraftPayload, recipeDraftRows } from './warehouse/RecipeDraftFields';
import { ModifierDraftFields, type ModifierDraft } from './warehouse/ModifierDraftFields';
import { normalizeUnitLabel, unitLabelOptions } from './warehouse/units';

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
  stockIngredientId?: string | null;
};

function newVariant(): VariantDraft {
  return { key: crypto.randomUUID(), name: '', price: '', unit: 'шт' };
}

function salePrice(value: string, minimum: number) {
  return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= minimum;
}

export function MenuEntryPage({ id, kind, categoryId, onClose, initialTab = 'main' }: {
  id?: string;
  kind: 'goods' | 'recipe';
  categoryId?: string;
  onClose: () => void;
  initialTab?: 'main' | 'recipe';
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
  return <MenuEntryForm key={id ?? next?.count ?? 'new'} incoming={query.data} kind={kind}
    categoryId={next?.categoryId ?? categoryId} onClose={onClose} initialTab={initialTab}
    onCreateAnother={(selectedCategory) => setNext((current) => ({ count: (current?.count ?? 0) + 1, categoryId: selectedCategory }))} />;
}

function MenuEntryForm({ incoming, kind, categoryId, onClose, initialTab, onCreateAnother }: {
  incoming?: MenuEntry;
  kind: 'goods' | 'recipe';
  categoryId?: string;
  onClose: () => void;
  initialTab: 'main' | 'recipe';
  onCreateAnother: (categoryId: string) => void;
}) {
  // The loaded version belongs to the current draft even if the query refreshes in the background.
  const [initial] = useState(incoming);
  const dish = initial?.dish;
  const catalogKind = dish?.catalogKind ?? kind;
  const isGoods = catalogKind === 'goods';
  const title = dish ? (isGoods ? 'Редактирование товара' : 'Редактирование техкарты')
    : (isGoods ? 'Добавление товара' : 'Добавление техкарты');
  const categories = useAdminCategories().data ?? [];
  const stations = usePreparationStations().data ?? [];
  const { can, canEditSection } = usePermissions();
  const canEdit = can('actions.editMenu');
  const canRecipe = can('actions.warehouseRecipes');
  const canCosts = can('actions.warehouseCosts');
  const stock = useIngredients('', undefined, isGoods && !!dish && canCosts && can('sections.warehouse')).data;
  const qc = useQueryClient();
  const push = useNotifications((state) => state.push);
  const [requestKey] = useState(() => crypto.randomUUID());
  const formId = useId();
  const startRef = useRef<HTMLFieldSetElement>(null);
  const recipeRef = useRef<HTMLFieldSetElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const draggedVariant = useRef<number | null>(null);
  const [tax, setTax] = useState(() => dishTaxValue(dish));
  const [form, setForm] = useState(() => ({
    name: dish?.name ?? '',
    categoryId: dish?.categoryId ?? categoryId ?? '',
    price: dish ? String(Number(dish.price)) : '',
    description: dish?.description ?? '',
    voiceName: dish?.voiceName ?? '',
    prepStation: dish?.prepStation ?? '',
    imageUrl: dish?.imageUrl ?? '',
    isAvailable: dish?.isAvailable ?? true,
    isWeighted: dish?.isWeighted ?? false,
    weightedMeasure: dish?.weightedMeasure ?? 'weight',
    weightedPriceBase: dish?.weightedPriceBase ?? 100,
    unit: normalizeUnitLabel(dish?.unit),
  }));
  const [variants, setVariants] = useState<VariantDraft[]>(() => (dish?.variants ?? []).map((variant) => ({
    key: variant.id,
    id: variant.id,
    name: variant.name,
    price: String(Number(variant.price)),
    unit: normalizeUnitLabel(variant.unit),
    stockIngredientId: variant.stockIngredientId,
  })));
  const [withVariants, setWithVariants] = useState(variants.length > 0);
  const activeVariants = !isGoods || withVariants ? variants : [];
  const [rows, setRows] = useState(() => recipeDraftRows(initial?.recipe.items ?? []));
  const [metadata, setMetadata] = useState<RecipeMetadata>(() => initial?.recipe.metadata ?? {});
  const [modifiers, setModifiers] = useState<ModifierDraft>(
    () => initial?.modifiers ?? { allowIngredientExclusions: false, groups: [] },
  );
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(form.imageUrl.startsWith('http') ? form.imageUrl : '');
  const submission = useRef(false);
  const snapshot = JSON.stringify([form, tax, activeVariants, withVariants, rows, metadata, modifiers, photoUrl]);
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
  const ingredientCost = (id?: string | null) => stock?.find((item) => item.id === id);
  const baseCost = ingredientCost(dish?.stockIngredientId);
  const productCost = form.isWeighted
    ? baseCost?.avgCostBase != null ? baseCost.avgCostBase * form.weightedPriceBase : null
    : baseCost?.avgCost;
  const recipeCost = canCosts && !isGoods ? recipeDraftCost(rows) : undefined;

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
    if (!activeVariants.length && !salePrice(form.price, 0)) {
      setError('Укажите цену продажи.');
      return;
    }
    if (activeVariants.some((variant) => !variant.name.trim() || !salePrice(variant.price, 0.01))) {
      setError('Проверьте название и цену каждого варианта.');
      return;
    }
    if (canRecipe && !isGoods && rows.some((row) => row.amount <= 0 || (row.netAmount ?? row.amount) > row.amount)) {
      recipeRef.current?.scrollIntoView({ block: 'start' });
      setError('Укажите брутто больше нуля и нетто не больше брутто.');
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
      const pricedVariants = activeVariants.map(({ key, id, name, price, unit }) => ({
        id, clientKey: key, name: name.trim(), price: Number(price), unit,
      }));
      const body = {
        catalogKind, requestKey, expectedVersion: initial?.recipe.version,
        dish: {
          ...form,
          ...(tax !== dishTaxValue(dish) ? dishTaxInput(tax) : {}),
          name: form.name.trim(),
          price: Number(form.price),
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
          },
          ...(JSON.stringify(modifiers) !== JSON.stringify(initial?.modifiers ?? { allowIngredientExclusions: false, groups: [] })
            ? { modifiers } : {}),
        } : {}),
      };
      if (dish) await api.put('/admin/menu/entries/' + dish.id, body);
      else await api.post('/admin/menu/entries', body);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin'] }),
        qc.invalidateQueries({ queryKey: ['menu'] }),
      ]);
      push({ message: isGoods ? 'Товар сохранён' : 'Техкарта сохранена', at: new Date().toISOString() });
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
    setVariants((current) => [...current, variant]);
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
      count={activeVariants.length} isGoods={isGoods}
      cost={canCosts && isGoods && variant.id ? ingredientCost(variant.stockIngredientId ?? dish?.stockIngredientId)?.avgCost : undefined}
      showCost={canCosts && isGoods} onChange={(value) => changeVariant(variant.key, value)}
      onMove={(direction) => moveVariant(index, index + direction)}
      onDragStart={canEdit && !busy ? () => { draggedVariant.current = index; } : undefined}
      onDragEnd={() => { draggedVariant.current = null; }}
      onDrop={() => {
        if (draggedVariant.current !== null) moveVariant(draggedVariant.current, index);
        draggedVariant.current = null;
      }}
      onRemove={() => setVariants((current) => current.filter((item) => item.key !== variant.key))} />)}
    <button type="button" className="btn-secondary btn-md" onClick={addVariant}>+ Добавить вариант</button>
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
      <form id={formId} className="mx-auto min-w-0 max-w-6xl space-y-5" noValidate
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          void save();
        }}>
        <fieldset ref={startRef} disabled={!canEdit || busy} className="grid min-w-0 scroll-mt-4 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.62fr)]">
          <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
            <h2 className="font-semibold">Основное</h2>
            <Field label="Название" htmlFor={formId + '-name'}>
              <input id={formId + '-name'} ref={nameRef} className="input" value={form.name} maxLength={120}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder={isGoods ? 'Например, лимонад 0,5 л' : 'Например, капучино'} required />
            </Field>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="Категория">
                <Select ariaLabel="Категория" className="h-11 w-full" value={form.categoryId}
                  onChange={(value) => patch({ categoryId: value })}
                  options={[{ value: '', label: 'Выберите категорию' }, ...categories.map(({ id, name }) => ({ value: id, label: name }))]} />
              </Field>
              <Field label="Цех приготовления">
                <Select ariaLabel="Цех приготовления" className="h-11 w-full" value={form.prepStation}
                  onChange={(value) => patch({ prepStation: value })}
                  options={[{ value: '', label: 'По категории' }, ...routingOptions(stations, form.prepStation)]} />
              </Field>
            </div>
            <Field label="Налог">
              <MenuTaxSelect value={tax} onChange={setTax} inherit disabled={!canEdit || busy}
                categoryTaxId={categories.find((category) => category.id === form.categoryId)?.taxId} />
            </Field>
          </section>
          <section className="min-w-0 rounded-xl border border-border p-4 sm:p-5">
            <h2 className="mb-3 font-semibold">Обложка</h2>
            <CoverEditor name={form.name} imageUrl={form.imageUrl} photoUrl={photoUrl} loading={photoBusy}
              onUrl={setPhotoUrl} onBusy={setPhotoBusy} onError={setError}
              onImage={(imageUrl) => patch({ imageUrl })} />
          </section>
          <section className="space-y-3 rounded-xl border border-border p-4 sm:p-5 lg:col-span-2">
            <h2 className="font-semibold">Продажа</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isAvailable}
                onChange={(event) => patch({ isAvailable: event.target.checked })} />Доступно для заказа</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isWeighted}
                disabled={activeVariants.length > 0 || (isGoods && withVariants) || weightedLocked}
                onChange={(event) => patch({ isWeighted: event.target.checked })} />
                {isGoods ? 'Весовой товар' : 'Весовое блюдо'}
              </label>
            </div>
            {form.isWeighted && <div className="grid max-w-xl gap-3 rounded-lg bg-background p-3 sm:grid-cols-2">
              <Field label="Мера весовой позиции">
                <Select ariaLabel="Мера весовой позиции" className="h-11 w-full" value={form.weightedMeasure}
                  disabled={!!dish && isGoods}
                  onChange={(value) => patch({ weightedMeasure: value as 'weight' | 'volume' })}
                  options={[{ value: 'weight', label: 'г / кг' }, { value: 'volume', label: 'мл / л' }]} />
              </Field>
              <Field label="Цена указана за">
                <Select ariaLabel="Количество в цене" className="h-11 w-full" value={String(form.weightedPriceBase)}
                  onChange={(value) => patch({ weightedPriceBase: Number(value) })} options={weightedPriceUnits} />
              </Field>
            </div>}
          </section>
        </fieldset>

        <fieldset disabled={!canEdit || busy} className="min-w-0 rounded-xl border border-border p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">{isGoods ? 'Цена товара' : 'Цена и варианты порций'}</h2>
          {isGoods && <div role="group" aria-label="Формат товара" className="mb-4 grid gap-2 sm:grid-cols-2">
            <ModeOption name={formId + '-mode'} checked={!withVariants} label="Одна позиция"
              description="Одна цена и общий остаток" onSelect={() => setWithVariants(false)} />
            <ModeOption name={formId + '-mode'} checked={withVariants} label="С вариантами"
              description="Отдельные цены и остатки" disabled={form.isWeighted} onSelect={() => {
                setWithVariants(true);
                if (!variants.length) addVariant();
              }} />
          </div>}
          {isGoods && withVariants ? variantCards : <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {!activeVariants.length && <Field label={priceBasis && form.isWeighted ? 'Цена за ' + priceBasis : 'Цена продажи'}>
                <PriceInput label="Цена продажи" value={form.price} onChange={(price) => patch({ price })} />
              </Field>}
              {isGoods && !form.isWeighted && <Field label="Единица учёта">
                <Select ariaLabel="Единица учёта" className="h-11 w-full" value={form.unit}
                  disabled={!!dish?.stockIngredientId} onChange={(unit) => patch({ unit })} options={unitLabelOptions(form.unit)} />
              </Field>}
            </div>
            {canCosts && <PriceMetrics
              cost={isGoods ? productCost : recipeCost?.complete ? recipeCost.total : null}
              price={!activeVariants.length && (isGoods || !form.isWeighted) ? form.price : undefined}
              costLabel={isGoods ? 'Себестоимость по складу' : 'Себестоимость базового состава'} />}
            {!isGoods && !form.isWeighted && <div className="mt-4 border-t border-border pt-4">{variantCards}</div>}
          </>}
        </fieldset>

        <fieldset disabled={!canEdit || busy} className="min-w-0">
          <details className="rounded-xl border border-border p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold">Дополнительно</summary>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Описание">
                <textarea aria-label="Описание" className="input min-h-24 py-2.5" value={form.description} maxLength={300}
                  onChange={(event) => patch({ description: event.target.value })} />
              </Field>
              <Field label="Название для озвучки">
                <input aria-label="Название для озвучки" className="input" value={form.voiceName} maxLength={120}
                  placeholder="Как произносить вслух" onChange={(event) => patch({ voiceName: event.target.value })} />
              </Field>
            </div>
          </details>
        </fieldset>

        {!isGoods && canRecipe && <fieldset ref={recipeRef} disabled={!canEdit || busy} className="min-w-0 scroll-mt-4 space-y-5">
          <RecipeDraftFields rows={rows} onChange={setRows} showCosts={canCosts}
            allowCreate={canEditSection('warehouse') && can('actions.warehouseReceive')}
            variants={activeVariants.map((variant) => ({ id: variant.id ?? variant.key, name: variant.name }))} />
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
          <ModifierDraftFields value={modifiers} onChange={setModifiers} />
        </fieldset>}
      </form>
    </EditorPage>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const className = 'mb-1.5 block text-sm font-medium text-text-secondary';
  return <div className="min-w-0">
    {htmlFor ? <label htmlFor={htmlFor} className={className}>{label}</label> : <p className={className}>{label}</p>}
    {children}
  </div>;
}

function ModeOption({ name, checked, label, description, onSelect, disabled }: {
  name: string; checked: boolean; label: string; description: string; onSelect: () => void; disabled?: boolean;
}) {
  return <label className={'flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:disabled]:cursor-default ' +
    (checked ? 'border-primary/45 bg-primary/5' : 'border-border')}>
    <input className="mt-1 shrink-0" type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} />
    <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span>
      <span className="block text-xs text-text-muted">{description}</span></span>
  </label>;
}

function PriceInput({ label, value, onChange, minimum = 0 }: {
  label: string; value: string; onChange: (price: string) => void; minimum?: number;
}) {
  return <div className="relative">
    <input aria-label={label} type="number" min={minimum} step="0.01" inputMode="decimal" className="input pr-9"
      value={value} onChange={(event) => onChange(event.target.value)} />
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-text-muted">с</span>
  </div>;
}

function PriceMetrics({ cost, price, costLabel = 'Себестоимость' }: { cost?: number | null; price?: string; costLabel?: string }) {
  const markup = cost != null && cost > 0 && price != null && salePrice(price, 0)
    ? taxRateLabel((Number(price) / cost - 1) * 100) : '—';
  return <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
    <div><dt className="text-text-muted">{costLabel}</dt><dd className="font-medium">{cost == null ? '—' : money(cost)}</dd></div>
    {price != null && <div><dt className="text-text-muted">Наценка</dt><dd className="font-medium">{markup}</dd></div>}
  </dl>;
}

function VariantCard({ value, index, count, isGoods, cost, showCost, onChange, onMove, onRemove, onDragStart, onDragEnd, onDrop }: {
  value: VariantDraft; index: number; count: number; isGoods: boolean;
  cost?: Ingredient['avgCost']; showCost: boolean; onChange: (value: Partial<VariantDraft>) => void;
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
      <Field label="Название варианта">
        <input aria-label="Название варианта" className="input" placeholder="Например, 250 мл" value={value.name}
          maxLength={120} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <Field label="Цена продажи">
        <PriceInput label={'Цена ' + caption} value={value.price} minimum={0.01} onChange={(price) => onChange({ price })} />
      </Field>
      <Field label="Единица учёта">
        <Select ariaLabel={'Единица учёта ' + caption} className="h-11 w-full" value={value.unit}
          disabled={isGoods && !!value.id} onChange={(unit) => onChange({ unit })} options={unitLabelOptions(value.unit)} />
      </Field>
    </div>
    {showCost && <PriceMetrics cost={cost} price={value.price} costLabel="Себестоимость по складу" />}
  </div>;
}

function CoverEditor({ name, imageUrl, photoUrl, loading, onUrl, onImage, onBusy, onError }: {
  name: string; imageUrl: string; photoUrl: string; loading: boolean;
  onUrl: (value: string) => void; onImage: (value: string) => void;
  onBusy: (value: boolean) => void; onError: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

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

  return <div className="space-y-3">
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
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" aria-label="Загрузить обложку" onClick={() => input.current?.click()}
        className="relative flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-background hover:border-primary">
        {loading ? <Spinner /> : imageUrl ? <img src={resolveApiImage(imageUrl) ?? undefined} alt={name || 'Фото позиции'}
          className="h-full w-full object-cover" /> : <span className="text-xs font-medium text-primary">Загрузить фото</span>}
      </button>
      {imageUrl && <button type="button" className="btn-ghost btn-md text-danger" onClick={() => {
        onImage(''); onUrl(''); onError('');
      }}>Удалить фото</button>}
    </div>
    <div className="flex gap-2">
      <input aria-label="Ссылка на фото" className="input min-w-0 flex-1" type="url" placeholder="https://…"
        value={photoUrl} onChange={(event) => onUrl(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); previewUrl(); } }} />
      <button type="button" className="btn-secondary btn-md shrink-0" disabled={!photoUrl.trim()} onClick={previewUrl}>По ссылке</button>
    </div>
  </div>;
}
