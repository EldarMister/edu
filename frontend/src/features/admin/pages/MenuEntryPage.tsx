import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { downscaleToDataUrl, resolveApiImage } from '@/lib/image';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { routingOptions, usePreparationStations } from '@/features/kitchen/stations';
import { useAdminCategories, type AdminDish } from '../api';
import { type Recipe, type RecipeMetadata } from './warehouse/api';
import {
  RecipeDraftFields,
  recipeDraftRows,
  recipeDraftPayload,
} from './warehouse/RecipeDraftFields';
import { ModifierDraftFields, type ModifierDraft } from './warehouse/ModifierDraftFields';
import { normalizeUnitLabel, unitLabelOptions } from './warehouse/units';

interface MenuEntry {
  dish: AdminDish;
  recipe: Recipe;
  modifiers: ModifierDraft;
}
export function MenuEntryPage({
  id,
  kind,
  categoryId,
  onClose,
  initialTab = 'main',
}: {
  id?: string;
  kind: 'goods' | 'recipe';
  categoryId?: string;
  onClose: () => void;
  initialTab?: 'main' | 'recipe';
}) {
  const query = useQuery({
    queryKey: ['admin', 'menu-entry', id],
    enabled: !!id,
    queryFn: () =>
      api.get<MenuEntry>(`/admin/menu/entries/${id}`).then((response) => response.data),
  });
  if (id && query.isPending)
    return (
      <MenuEntryShell title="Загрузка позиции" onClose={onClose}>
        <Spinner />
      </MenuEntryShell>
    );
  if (id && query.isError)
    return (
      <MenuEntryShell title="Позиция меню" onClose={onClose}>
        <p role="alert" className="text-danger">
          {apiError(query.error)}
        </p>
        <button className="btn-secondary btn-md mt-4" onClick={() => query.refetch()}>
          Повторить
        </button>
      </MenuEntryShell>
    );
  return (
    <MenuEntryForm
      key={id ?? 'new'}
      initial={query.data}
      kind={kind}
      categoryId={categoryId}
      onClose={onClose}
      initialTab={initialTab}
    />
  );
}

function MenuEntryForm({
  initial: incoming,
  kind,
  categoryId,
  onClose,
  initialTab,
}: {
  initial?: MenuEntry;
  kind: 'goods' | 'recipe';
  categoryId?: string;
  onClose: () => void;
  initialTab: 'main' | 'recipe';
}) {
  // Keep the version paired with the draft. Background query refreshes must not
  // silently authorize an older form to overwrite a newer server version.
  const [initial] = useState(incoming);
  const dish = initial?.dish;
  const catalogKind = dish?.catalogKind ?? kind;
  const isGoods = catalogKind === 'goods';
  const title = dish
    ? isGoods
      ? 'Изменить товар'
      : 'Изменить блюдо'
    : isGoods
      ? 'Новый товар'
      : 'Новое блюдо';
  const categories = useAdminCategories().data ?? [];
  const stations = usePreparationStations().data ?? [];
  const { can } = usePermissions();
  const canEdit = can('actions.editMenu');
  const canRecipe = can('actions.warehouseRecipes');
  const qc = useQueryClient();
  const push = useNotifications((state) => state.push);
  const requestKey = useRef(crypto.randomUUID());
  const imageInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
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
  });
  const [variants, setVariants] = useState(() =>
    (dish?.variants ?? []).map((variant) => ({
      key: variant.id,
      id: variant.id as string | undefined,
      name: variant.name,
      price: String(Number(variant.price)),
      unit: normalizeUnitLabel(variant.unit),
    })),
  );
  const [rows, setRows] = useState(() => recipeDraftRows(initial?.recipe.items ?? []));
  const [metadata, setMetadata] = useState<RecipeMetadata>(() => initial?.recipe.metadata ?? {});
  const [modifiers, setModifiers] = useState<ModifierDraft>(
    () => initial?.modifiers ?? { allowIngredientExclusions: false, groups: [] },
  );
  const [showModifiers, setShowModifiers] = useState(
    !!modifiers.groups.length || modifiers.allowIngredientExclusions,
  );
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<'main' | 'recipe'>(initialTab);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(form.imageUrl.startsWith('http') ? form.imageUrl : '');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  function patch(value: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...value }));
  }
  async function save() {
    if (pending || photoBusy || !canEdit) return;
    setError('');
    if (!form.name.trim() || !form.categoryId) {
      setTab('main');
      setError('Укажите название и категорию.');
      return;
    }
    if (
      (!variants.length &&
        (form.price.trim() === '' ||
          !Number.isFinite(Number(form.price)) ||
          Number(form.price) < 0)) ||
      variants.some(
        (variant) =>
          !variant.name.trim() ||
          !Number.isFinite(Number(variant.price)) ||
          Number(variant.price) <= 0,
      )
    ) {
      setTab('main');
      setError('Проверьте название и цену каждого варианта.');
      return;
    }
    if (rows.some((row) => row.amount <= 0 || (row.netAmount ?? row.amount) > row.amount)) {
      setTab('recipe');
      setError('В составе укажите брутто больше нуля. Нетто не должно превышать брутто.');
      return;
    }
    const typedPhotoUrl = photoUrl.trim();
    if (typedPhotoUrl && !/^https?:\/\/.+/i.test(typedPhotoUrl)) {
      setTab('main');
      setError('Ссылка на фото должна начинаться с https://');
      return;
    }
    setPending(true);
    try {
      const modifierPayload = {
        allowIngredientExclusions: modifiers.allowIngredientExclusions,
        groups: modifiers.groups,
      };
      const initialModifierPayload = {
        allowIngredientExclusions: initial?.modifiers.allowIngredientExclusions ?? false,
        groups: initial?.modifiers.groups ?? [],
      };
      const modifiersChanged =
        JSON.stringify(modifierPayload) !== JSON.stringify(initialModifierPayload);
      const body = {
        catalogKind,
        requestKey: requestKey.current,
        expectedVersion: initial?.recipe.version,
        dish: {
          ...form,
          imageUrl: typedPhotoUrl || form.imageUrl,
          name: form.name.trim(),
          price: Number(form.price),
          prepStation: form.prepStation || null,
          variants: variants.map(({ key, ...variant }) => ({
            ...variant,
            clientKey: key,
            name: variant.name.trim(),
            price: Number(variant.price),
          })),
        },
        ...(canRecipe && !isGoods
          ? {
              recipe: {
                items: recipeDraftPayload(rows).map((row) => ({
                  ...row,
                  variantAmounts: Object.fromEntries(
                    Object.entries(row.variantAmounts ?? {}).filter(([id]) =>
                      variants.some((variant) => (variant.id ?? variant.key) === id),
                    ),
                  ),
                })),
                metadata,
              },
              ...(modifiersChanged ? { modifiers: modifierPayload } : {}),
            }
          : {}),
      };
      if (dish) await api.put(`/admin/menu/entries/${dish.id}`, body);
      else await api.post('/admin/menu/entries', body);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin'] }),
        qc.invalidateQueries({ queryKey: ['menu'] }),
      ]);
      push({
        message: `${isGoods ? 'Товар' : 'Техкарта'} сохранён${isGoods ? '' : 'а'}`,
        at: new Date().toISOString(),
      });
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      setPending(false);
    }
  }
  function changeVariant(key: string, value: Partial<(typeof variants)[number]>) {
    setVariants((current) =>
      current.map((variant) => (variant.key === key ? { ...variant, ...value } : variant)),
    );
  }
  function moveVariant(from: number, to: number) {
    if (from === to || to < 0 || to >= variants.length) return;
    setVariants((current) => {
      const next = [...current];
      const [variant] = next.splice(from, 1);
      next.splice(to, 0, variant);
      return next;
    });
  }
  function commitPhotoUrl() {
    const value = photoUrl.trim();
    if (!value) return;
    if (!/^https?:\/\/.+/i.test(value)) {
      setError('Ссылка на фото должна начинаться с https://');
      return;
    }
    patch({ imageUrl: value });
    setError('');
  }
  const weightedLocked = !!dish && isGoods && (!!dish.stockIngredientId || !!dish.hasDirectStock);
  const smallUnit = form.weightedMeasure === 'weight' ? 'г' : 'мл';
  const largeUnit = form.weightedMeasure === 'weight' ? 'кг' : 'л';
  const priceBaseLabel =
    form.weightedPriceBase === 1000 ? `1 ${largeUnit}` : `${form.weightedPriceBase} ${smallUnit}`;
  const busy = pending || photoBusy;
  return (
    <MenuEntryShell
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role={error ? 'alert' : undefined} className="min-w-0 flex-1 text-sm text-danger">
            {error}
          </p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn-secondary btn-md px-6"
              onClick={onClose}
              disabled={busy}
            >
              Отмена
            </button>
            <button
              type="submit"
              form="menu-entry-form"
              className="btn-primary btn-md min-w-36 font-semibold"
              disabled={busy || !canEdit}
            >
              {pending ? <Spinner /> : 'Сохранить'}
            </button>
          </div>
        </div>
      }
    >
      <div
        role="tablist"
        aria-label="Карточка блюда"
        className="-mt-1 mb-4 flex gap-1 border-b border-border"
      >
        <EditorTab active={tab === 'main'} id="main" onClick={() => setTab('main')}>
          Основное
        </EditorTab>
        {!isGoods && canRecipe && (
          <EditorTab active={tab === 'recipe'} id="recipe" onClick={() => setTab('recipe')}>
            Состав
          </EditorTab>
        )}
      </div>
      <form
        id="menu-entry-form"
        className="min-w-0 w-full"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div
          role="tabpanel"
          id="menu-panel-main"
          aria-labelledby="menu-tab-main"
          hidden={tab !== 'main'}
        >
          <fieldset
            disabled={!canEdit || busy}
            className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)]"
          >
            <section className="min-w-0 rounded-xl border border-border p-4">
              <CompactField label={isGoods ? 'Фото товара' : 'Фото блюда'}>
                <input
                  ref={imageInput}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
                      setError('Фото: только PNG, JPG или WEBP');
                      return;
                    }
                    setPhotoBusy(true);
                    setError('');
                    try {
                      patch({ imageUrl: await downscaleToDataUrl(file) });
                      setPhotoUrl('');
                    } catch (failure) {
                      setError(apiError(failure));
                    } finally {
                      setPhotoBusy(false);
                    }
                  }}
                />
                <div className="flex gap-3 sm:gap-4">
                  <div className="group relative flex h-[108px] w-[108px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background sm:h-[118px] sm:w-[130px]">
                    {form.imageUrl ? (
                      <img
                        src={resolveApiImage(form.imageUrl) ?? undefined}
                        alt={form.name || 'Фото позиции'}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-text-muted">Нет фото</span>
                    )}
                    {form.imageUrl && (
                      <button
                        type="button"
                        aria-label="Удалить фото"
                        className="absolute right-1.5 top-1.5 rounded-md bg-white/90 px-2 py-0.5 text-danger shadow"
                        onClick={() => {
                          patch({ imageUrl: '' });
                          setPhotoUrl('');
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/35 bg-primary/[0.02] px-2 text-sm font-medium text-primary hover:bg-primary/5"
                      onClick={() => imageInput.current?.click()}
                    >
                      {photoBusy ? <Spinner /> : '+ Загрузить фото'}
                    </button>
                    <p className="mt-2 text-[11px] text-text-muted">
                      PNG, JPG, WEBP · рекомендуем 800 × 800 px
                    </p>
                    <div className="mt-2 flex gap-2">
                      <input
                        aria-label="Ссылка на фото"
                        className="input h-9 min-w-0 flex-1 text-xs"
                        placeholder="или ссылка https://…"
                        value={photoUrl}
                        onChange={(event) => setPhotoUrl(event.target.value)}
                        onBlur={commitPhotoUrl}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            commitPhotoUrl();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn-secondary h-9 shrink-0 px-2 text-xs"
                        onClick={commitPhotoUrl}
                      >
                        По ссылке
                      </button>
                    </div>
                  </div>
                </div>
              </CompactField>
              <div className="mt-3 space-y-3">
                <CompactField label="Название">
                  <input
                    aria-label="Название"
                    autoFocus
                    className="input h-11"
                    value={form.name}
                    maxLength={120}
                    onChange={(event) => patch({ name: event.target.value })}
                    placeholder={isGoods ? 'Например, Coca-Cola 0,5 л' : 'Например, Капучино'}
                  />
                </CompactField>
                <div className="grid grid-cols-2 gap-3">
                  <CompactField label="Категория">
                    <Select
                      ariaLabel="Категория"
                      className="h-11 w-full"
                      value={form.categoryId}
                      onChange={(value) => patch({ categoryId: value })}
                      options={[
                        { value: '', label: 'Выберите категорию' },
                        ...categories.map((category) => ({
                          value: category.id,
                          label: category.name,
                        })),
                      ]}
                    />
                  </CompactField>
                  <CompactField label="Куда отправлять">
                    <Select
                      ariaLabel="Куда отправлять"
                      className="h-11 w-full"
                      value={form.prepStation}
                      onChange={(value) => patch({ prepStation: value })}
                      options={[
                        { value: '', label: 'По категории' },
                        ...routingOptions(stations, form.prepStation),
                      ]}
                    />
                  </CompactField>
                </div>
                <CompactField label="Описание">
                  <div className="relative">
                    <textarea
                      aria-label="Описание"
                      className="input min-h-[84px] resize-none py-2.5 pr-12"
                      value={form.description}
                      maxLength={300}
                      placeholder="Необязательно"
                      onChange={(event) => patch({ description: event.target.value })}
                    />
                    <span className="absolute bottom-2 right-3 text-[11px] text-text-muted">
                      {form.description.length}/300
                    </span>
                  </div>
                </CompactField>
                {!variants.length && !form.isWeighted && (
                  <div className="grid grid-cols-2 gap-3">
                    <CompactField label="Цена (с)">
                      <input
                        aria-label="Цена продажи"
                        className="input h-11"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={form.price}
                        onChange={(event) => patch({ price: event.target.value })}
                      />
                    </CompactField>
                    {isGoods && (
                      <CompactField label="Ед. измерения">
                        <Select
                          ariaLabel="Единица учёта"
                          className="h-11 w-full"
                          value={form.unit}
                          disabled={!!dish?.stockIngredientId}
                          onChange={(value) => patch({ unit: value })}
                          options={unitLabelOptions(form.unit)}
                        />
                      </CompactField>
                    )}
                  </div>
                )}
                {isGoods && (
                  <p className="rounded-lg border border-border bg-background/60 p-3 text-xs leading-relaxed text-text-secondary">
                    Остаток товара учитывается на складе. Поставки и инвентаризации доступны в
                    разделе «Склад».
                  </p>
                )}
              </div>
            </section>
            <section className="min-w-0 rounded-xl border border-border p-4">
              <h4 className="text-base font-semibold text-text-primary">
                Настройки {isGoods ? 'товара' : 'блюда'}
              </h4>
              <div className="mt-3 grid grid-cols-2 gap-3 divide-x divide-border">
                <EditorToggle
                  checked={form.isAvailable}
                  onChange={(checked) => patch({ isAvailable: checked })}
                  label="Доступно для заказа"
                />
                <div className="pl-3">
                  <EditorToggle
                    checked={form.isWeighted}
                    disabled={variants.length > 0 || weightedLocked}
                    onChange={(checked) => patch({ isWeighted: checked })}
                    label={isGoods ? 'Весовой товар' : 'Весовое блюдо'}
                  />
                </div>
              </div>
              {form.isWeighted && (
                <div className="mt-4 space-y-3 rounded-xl border border-border p-3 sm:p-4">
                  <h5 className="font-semibold text-text-primary">
                    Параметры весового {isGoods ? 'товара' : 'блюда'}
                  </h5>
                  <div className="grid grid-cols-2 gap-3">
                    <CompactField label="Единицы измерения">
                      <Select
                        ariaLabel="Мера весовой позиции"
                        className="h-11 w-full"
                        value={form.weightedMeasure}
                        disabled={!!dish && isGoods}
                        onChange={(value) =>
                          patch({ weightedMeasure: value as 'weight' | 'volume' })
                        }
                        options={[
                          { value: 'weight', label: 'г / кг' },
                          { value: 'volume', label: 'мл / л' },
                        ]}
                      />
                    </CompactField>
                    <CompactField label="Цена указана за">
                      <Select
                        ariaLabel="Количество в цене"
                        className="h-11 w-full"
                        value={String(form.weightedPriceBase)}
                        onChange={(value) => patch({ weightedPriceBase: Number(value) })}
                        options={[1, 100, 1000].map((value) => ({
                          value: String(value),
                          label: value === 1000 ? `1 ${largeUnit}` : `${value} ${smallUnit}`,
                        }))}
                      />
                    </CompactField>
                  </div>
                  <CompactField label="Цена (с)">
                    <input
                      aria-label="Цена продажи"
                      className="input h-11"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={form.price}
                      onChange={(event) => patch({ price: event.target.value })}
                    />
                  </CompactField>
                  <p className="rounded-lg bg-primary/5 p-3 text-xs leading-relaxed text-text-secondary">
                    Например, при цене {form.price || '0'} сом за {priceBaseLabel}:{' '}
                    <strong className="text-primary">
                      1250 {smallUnit} ={' '}
                      {((Number(form.price || 0) * 1250) / form.weightedPriceBase).toFixed(2)} сом
                    </strong>
                  </p>
                </div>
              )}
              <div className="mt-4 space-y-4">
                <CompactField label="Название для озвучки">
                  <input
                    aria-label="Название для озвучки"
                    className="input h-11"
                    value={form.voiceName}
                    maxLength={120}
                    placeholder="Как произносить вслух (необязательно)"
                    onChange={(event) => patch({ voiceName: event.target.value })}
                  />
                </CompactField>
                {!form.isWeighted && (
                  <section className="min-w-0 rounded-xl border border-border p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-semibold text-text-primary">
                        Варианты {isGoods ? 'товара' : 'блюда'}
                      </h4>
                      <button
                        type="button"
                        className="btn-secondary btn-md"
                        onClick={() =>
                          setVariants((current) => [
                            ...current,
                            {
                              key: crypto.randomUUID(),
                              id: undefined,
                              name: '',
                              price: '',
                              unit: 'шт',
                            },
                          ])
                        }
                      >
                        + Добавить вариант
                      </button>
                    </div>
                    <div className="min-w-0 overflow-x-auto rounded-xl border border-border">
                      <div className="grid min-w-[400px] grid-cols-[30px_minmax(110px,1fr)_90px_75px_28px] gap-2 border-b border-border bg-background px-2 py-2 text-xs text-text-muted">
                        <span />
                        <span>Название</span>
                        <span>Цена (с)</span>
                        <span>Ед.</span>
                        <span />
                      </div>
                      {!variants.length ? (
                        <p className="px-3 py-4 text-sm text-text-muted">Варианты не добавлены</p>
                      ) : (
                        variants.map((variant, index) => (
                          <div
                            key={variant.key}
                            draggable={canEdit}
                            onDragStart={() => setDragIndex(index)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => {
                              if (dragIndex !== null) moveVariant(dragIndex, index);
                              setDragIndex(null);
                            }}
                            onDragEnd={() => setDragIndex(null)}
                            className={`grid min-w-[400px] grid-cols-[30px_minmax(110px,1fr)_90px_75px_28px] items-center gap-2 border-b border-border px-2 py-2 last:border-0 ${dragIndex === index ? 'bg-primary/5' : ''}`}
                          >
                            <div className="flex flex-col items-center">
                              <button
                                type="button"
                                aria-label={`Вариант ${variant.name || index + 1} выше`}
                                className="px-1 text-xs text-text-muted disabled:opacity-30"
                                disabled={index === 0}
                                onClick={() => moveVariant(index, index - 1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Вариант ${variant.name || index + 1} ниже`}
                                className="px-1 text-xs text-text-muted disabled:opacity-30"
                                disabled={index === variants.length - 1}
                                onClick={() => moveVariant(index, index + 1)}
                              >
                                ↓
                              </button>
                            </div>
                            <input
                              aria-label="Название варианта"
                              className="input h-10 min-w-0"
                              placeholder="Например, 250 мл"
                              value={variant.name}
                              onChange={(event) =>
                                changeVariant(variant.key, { name: event.target.value })
                              }
                            />
                            <input
                              aria-label={`Цена ${variant.name}`}
                              className="input h-10 min-w-0"
                              type="number"
                              min="0.01"
                              step="0.01"
                              inputMode="decimal"
                              value={variant.price}
                              placeholder="Цена"
                              onChange={(event) =>
                                changeVariant(variant.key, { price: event.target.value })
                              }
                            />
                            <Select
                              ariaLabel={`Единица ${variant.name}`}
                              className="h-10 w-full"
                              value={variant.unit}
                              disabled={isGoods && !!variant.id}
                              onChange={(value) => changeVariant(variant.key, { unit: value })}
                              options={unitLabelOptions(variant.unit)}
                            />
                            <button
                              type="button"
                              aria-label={`Удалить вариант ${variant.name}`}
                              className="h-9 rounded-lg text-xl text-danger hover:bg-danger/5"
                              onClick={() =>
                                setVariants((current) =>
                                  current.filter((item) => item.key !== variant.key),
                                )
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                )}
              </div>
            </section>
          </fieldset>
        </div>
        {!isGoods && canRecipe && (
          <div
            role="tabpanel"
            id="menu-panel-recipe"
            aria-labelledby="menu-tab-recipe"
            hidden={tab !== 'recipe'}
          >
            <fieldset disabled={!canEdit || busy} className="min-w-0 w-full space-y-5">
              <RecipeDraftFields
                rows={rows}
                onChange={setRows}
                showCosts={can('actions.warehouseCosts')}
                variants={variants.map((variant) => ({
                  id: variant.id ?? variant.key,
                  name: variant.name,
                }))}
              />
              <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-[220px_minmax(0,1fr)]">
                <CompactField label="Выход готового блюда">
                  <div className="flex gap-2">
                    <input
                      aria-label="Выход готового блюда"
                      className="input h-11 min-w-0 flex-1"
                      type="number"
                      min="0.001"
                      step="any"
                      value={metadata.outputQuantity ?? ''}
                      onChange={(event) =>
                        setMetadata((current) => ({
                          ...current,
                          outputQuantity: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        }))
                      }
                    />
                    <input
                      aria-label="Единица выхода"
                      className="input h-11 w-20"
                      placeholder="г"
                      value={metadata.outputUnit ?? ''}
                      onChange={(event) =>
                        setMetadata((current) => ({ ...current, outputUnit: event.target.value }))
                      }
                    />
                  </div>
                </CompactField>
                <CompactField label="Способ приготовления">
                  <textarea
                    aria-label="Способ приготовления"
                    className="input min-h-24"
                    value={metadata.instructions ?? ''}
                    onChange={(event) =>
                      setMetadata((current) => ({ ...current, instructions: event.target.value }))
                    }
                  />
                </CompactField>
              </div>
              {showModifiers ? (
                <ModifierDraftFields value={modifiers} onChange={setModifiers} />
              ) : (
                <button
                  type="button"
                  className="btn-secondary btn-md"
                  onClick={() => setShowModifiers(true)}
                >
                  + Добавить модификаторы
                </button>
              )}
            </fieldset>
          </div>
        )}
      </form>
    </MenuEntryShell>
  );
}
function MenuEntryShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return createPortal(
    <div data-edu-menu-editor>
      <Modal
        open
        title={title}
        onClose={onClose}
        footer={footer}
        panelClassName="sm:w-[min(1160px,calc(100vw-48px))] sm:max-w-none"
      >
        {children}
      </Modal>
    </div>,
    document.body,
  );
}
function CompactField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm font-medium text-text-secondary">{label}</p>
      {children}
    </div>
  );
}
function EditorTab({
  active,
  id,
  onClick,
  children,
}: {
  active: boolean;
  id: 'main' | 'recipe';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`menu-tab-${id}`}
      aria-controls={`menu-panel-${id}`}
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
    >
      {children}
    </button>
  );
}
function EditorToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-secondary">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-primary peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
      <span>{label}</span>
    </label>
  );
}
