import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { minDishUnitPrice, money, variantNamesLine } from '@/lib/format';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { StatCard, StatCardsRow } from '../components/StatCard';
import { IconMenu, IconCategory, IconCheck, IconEdit, IconTrash, IconPlus } from '../components/icons';
import {
  useMenuOverview,
  useAdminCategories,
  useAdminDishes,
  useCategoryMutations,
  useDishMutations,
  useSetMutations,
  type AdminDish,
  type AdminCategory,
  type AdminDishVariant,
} from '../api';

export function MenuPage() {
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [dishModal, setDishModal] = useState<AdminDish | null | 'new'>(null);
  const [setModal, setSetModal] = useState<AdminDish | null | 'new'>(null);
  const [catModal, setCatModal] = useState(false);

  const overview = useMenuOverview();
  const categoriesQ = useAdminCategories();
  const dishesQ = useAdminDishes(categoryId, search);
  const { remove } = useDishMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();
  const o = overview.data;

  // Эффективное направление блюда: своё, иначе — направление категории.
  const stationByCat = new Map((categoriesQ.data ?? []).map((c) => [c.id, c.prepStation ?? 'kitchen']));
  const dishStation = (d: AdminDish) => d.prepStation ?? stationByCat.get(d.categoryId) ?? 'kitchen';

  async function onDelete(d: AdminDish) {
    if (!confirm(`Удалить блюдо «${d.name}»?`)) return;
    try {
      await remove.mutateAsync(d.id);
      push({ message: 'Блюдо удалено', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard label={tr('Всего блюд')} value={o?.dishesCount ?? '—'} icon={<IconMenu />} tone="primary" />
        <StatCard label={tr('Категорий')} value={o?.categoriesCount ?? '—'} icon={<IconCategory />} tone="warning" />
        <StatCard label={tr('Активных блюд')} value={o?.activeDishesCount ?? '—'} icon={<IconCheck />} tone="success" />
      </StatCardsRow>

      <div className="card overflow-hidden">
        {/* Категории + действия */}
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              className="input h-10 sm:max-w-xs"
              placeholder={tr('Поиск блюда')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="btn-secondary btn-md" onClick={() => setCatModal(true)}>
                <IconPlus className="h-4 w-4" /> {tr('Категория')}
              </button>
              <button className="btn-secondary btn-md" onClick={() => setSetModal('new')}>
                <IconPlus className="h-4 w-4" /> {tr('Сет')}
              </button>
              <button className="btn-primary btn-md font-medium" onClick={() => setDishModal('new')}>
                <IconPlus className="h-4 w-4" /> {tr('Добавить блюдо')}
              </button>
            </div>
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            <CatTab active={categoryId === ''} onClick={() => setCategoryId('')}>
              {tr('Все блюда')}
            </CatTab>
            {categoriesQ.data?.map((c) => (
              <CatTab key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                {c.name}
              </CatTab>
            ))}
          </div>
        </div>

        {/* Таблица блюд */}
        {dishesQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-4 py-3 font-medium">{tr('Название')}</th>
                  <th className="px-4 py-3 font-medium">{tr('Категория')}</th>
                  <th className="px-4 py-3 text-right font-medium">{tr('Цена')}</th>
                  <th className="px-4 py-3 text-right font-medium">{tr('Остаток')}</th>
                  <th className="px-4 py-3 font-medium">{tr('Статус')}</th>
                  <th className="px-4 py-3 text-right font-medium">{tr('Действия')}</th>
                </tr>
              </thead>
              <tbody>
                {dishesQ.data?.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-background/60">
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-2 font-medium text-text-primary">
                        {d.name}
                        {d.isSet && (
                          <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                            Сет
                          </span>
                        )}
                        {dishStation(d) === 'bar' && (
                          <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            Бар
                          </span>
                        )}
                        {dishStation(d) === 'none' && (
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                            Без отправки
                          </span>
                        )}
                      </p>
                      {d.variants.length > 0 && (
                        <p className="text-xs font-medium text-primary">{variantNamesLine(d.variants)}</p>
                      )}
                      {d.description && <p className="text-xs text-text-muted">{d.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{d.category.name}</td>
                    <td className="px-4 py-3 text-right font-medium text-text-primary">
                      {d.variants.length > 0 ? `от ${money(minDishUnitPrice(d))}` : money(d.price)}
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary">
                      {(() => {
                        if (!d.trackInventory) return '—';
                        const hasVar = d.variants.length > 0;
                        const stock = hasVar ? d.variants.reduce((a, v) => a + (v.stock ?? 0), 0) : (d.stock ?? 0);
                        return `${stock} ${d.unit || 'шт'}`;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const hasVar = d.variants.length > 0;
                        const stock = hasVar ? d.variants.reduce((a, v) => a + (v.stock ?? 0), 0) : (d.stock ?? 0);
                        if (d.trackInventory && stock === 0) {
                          return <Badge tone="danger">{tr('Нет в наличии')}</Badge>;
                        }
                        if (d.isActive && d.isAvailable) {
                          return <Badge tone="success">{tr('Активно')}</Badge>;
                        }
                        return <Badge tone="muted">{tr('Скрыто')}</Badge>;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn onClick={() => (d.isSet ? setSetModal(d) : setDishModal(d))} title="Изменить">
                          <IconEdit className="h-4 w-4" />
                        </IconBtn>
                        <IconBtn onClick={() => onDelete(d)} title="Удалить" danger>
                          <IconTrash className="h-4 w-4" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
                {dishesQ.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                      Блюда не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dishModal !== null && (
        <DishModal
          dish={dishModal === 'new' ? null : dishModal}
          categories={categoriesQ.data ?? []}
          defaultCategoryId={categoryId}
          onClose={() => setDishModal(null)}
        />
      )}
      {setModal !== null && (
        <SetModal set={setModal === 'new' ? null : setModal} onClose={() => setSetModal(null)} />
      )}
      {catModal && (
        <CategoryModal categories={categoriesQ.data ?? []} onClose={() => setCatModal(false)} />
      )}
    </div>
  );
}

interface DishVariantDraft {
  uid: string;
  id?: string;
  name: string;
  price: string;
  stock: string;
  unit: string;
}

function variantDraft(variant?: AdminDishVariant): DishVariantDraft {
  return {
    uid: variant?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: variant?.id,
    name: variant?.name ?? '',
    price: variant ? String(Number(variant.price)) : '',
    stock: variant?.stock != null ? String(variant.stock) : '',
    unit: variant?.unit ?? 'шт',
  };
}

function DishModal({
  dish,
  categories,
  defaultCategoryId,
  onClose,
}: {
  dish: AdminDish | null;
  categories: AdminCategory[];
  defaultCategoryId: string;
  onClose: () => void;
}) {
  const isEdit = !!dish;
  const { create, update } = useDishMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(dish?.name ?? '');
  const [categoryId, setCategoryId] = useState(
    dish?.categoryId ?? (defaultCategoryId || categories[0]?.id || ''),
  );
  const [price, setPrice] = useState(dish ? (dish.variants.length > 0 ? '' : String(Number(dish.price))) : '');
  const [stock, setStock] = useState(dish?.stock != null ? String(dish.stock) : '');
  const [unit] = useState(dish?.unit ?? 'шт');
  const [description, setDescription] = useState(dish?.description ?? '');
  const [isAvailable, setIsAvailable] = useState(dish?.isAvailable ?? true);
  // '' = брать направление из категории; иначе приоритет блюда.
  const [prepStation, setPrepStation] = useState<'' | 'kitchen' | 'bar' | 'none'>(dish?.prepStation ?? '');
  const [variants, setVariants] = useState<DishVariantDraft[]>(() => dish?.variants.map(variantDraft) ?? []);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  function updateVariant(uid: string, patch: Partial<Pick<DishVariantDraft, 'name' | 'price' | 'stock' | 'unit'>>) {
    setVariants((current) => current.map((variant) => (variant.uid === uid ? { ...variant, ...patch } : variant)));
  }

  function addVariant() {
    setVariants((current) => [...current, variantDraft()]);
  }

  function removeVariant(uid: string) {
    setVariants((current) => current.filter((variant) => variant.uid !== uid));
  }

  function moveVariant(from: number, to: number) {
    setVariants((current) => {
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function onSubmit() {
    setError('');
    if (!name.trim() || !categoryId) {
      setError('Заполните название и категорию');
      return;
    }
    const filledVariants = variants
      .map((variant) => ({
        id: variant.id,
        name: variant.name.trim(),
        price: variant.price.trim(),
        stock: variant.stock.trim(),
        unit: variant.unit.trim(),
      }))
      .filter((variant) => variant.name || variant.price);
    for (const variant of filledVariants) {
      const variantPrice = Number(variant.price);
      if (!variant.name || !variant.price || !Number.isFinite(variantPrice) || variantPrice <= 0) {
        setError('У каждого варианта должны быть название и цена больше 0');
        return;
      }
    }
    const priceValue = price.trim() ? Number(price) : undefined;
    if (priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0)) {
      setError('Цена блюда должна быть числом');
      return;
    }
    if (filledVariants.length === 0 && (!priceValue || priceValue <= 0)) {
      setError('Укажите цену блюда или добавьте варианты с ценами');
      return;
    }
    try {
      const body = {
        name: name.trim(),
        categoryId,
        price: priceValue,
        description: description.trim() || undefined,
        isAvailable,
        prepStation: prepStation === '' ? null : prepStation,
        trackInventory: filledVariants.length > 0 ? filledVariants.some(v => v.stock.trim() !== '') : stock.trim() !== '',
        stock: priceValue !== undefined ? (stock.trim() ? Number(stock) : undefined) : undefined,
        initialStock: !isEdit && priceValue !== undefined ? (stock.trim() ? Number(stock) : undefined) : undefined,
        unit: priceValue !== undefined ? unit : undefined,
        variants: filledVariants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          price: Number(variant.price),
          stock: variant.stock.trim() ? Number(variant.stock) : undefined,
          initialStock: (!isEdit || !variant.id) && variant.stock.trim() ? Number(variant.stock) : undefined,
          unit: variant.unit,
        })),
      };
      if (isEdit) {
        await update.mutateAsync({ id: dish!.id, ...body });
        push({ message: 'Блюдо обновлено', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Блюдо добавлено', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Изменить блюдо' : 'Новое блюдо'}
      panelClassName="max-w-xl"
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={pending} onClick={onSubmit}>
          {pending ? <Spinner /> : isEdit ? 'Сохранить' : 'Добавить'}
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Название">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Категория">
            <Select
              className="h-11 w-full"
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field label="Куда отправлять">
            <Select
              className="h-11 w-full"
              value={prepStation}
              onChange={(v) => setPrepStation(v as '' | 'kitchen' | 'bar' | 'none')}
              options={[
                { value: '', label: 'По категории' },
                { value: 'kitchen', label: 'Кухня' },
                { value: 'bar', label: 'Бар' },
                { value: 'none', label: 'Без отправки' },
              ]}
            />
          </Field>
        </div>
          {variants.length === 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Цена (с)">
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <Field label="Остаток">
              <input
                className="input"
                type="number"
                inputMode="numeric"
                value={stock}
                placeholder="Без учета"
                onChange={(e) => setStock(e.target.value)}
              />
            </Field>
          </div>
          )}
        <Field label="Описание">
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Необязательно"
          />
        </Field>
        <label className="flex items-center gap-2.5 pt-1 text-sm text-text-secondary">
          <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
          Доступно для заказа
        </label>
        <div className="pt-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-text-primary">Варианты блюда</h4>
            <button type="button" className="btn-secondary btn-md" onClick={addVariant}>
              <IconPlus className="h-4 w-4" /> Добавить вариант
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-border overflow-x-auto">
            <div className="grid min-w-[420px] grid-cols-[28px_minmax(120px,1fr)_100px_100px_36px] gap-2 border-b border-border bg-background px-3 py-2 text-xs font-medium text-text-muted">
              <span />
              <span>Название варианта</span>
              <span>Цена (с)</span>
              <span>Остаток</span>
              <span />
            </div>
            {variants.length === 0 ? (
              <div className="px-3 py-4 text-sm text-text-muted">Варианты не добавлены</div>
            ) : (
              <div className="min-w-[500px]">
                {variants.map((variant, index) => (
                  <div
                    key={variant.uid}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) moveVariant(dragIndex, index);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={`grid grid-cols-[28px_minmax(120px,1fr)_100px_100px_36px] items-center gap-2 border-b border-border px-3 py-2 last:border-0 ${
                      dragIndex === index ? 'bg-primary/5' : 'bg-white'
                    }`}
                  >
                    <span className="cursor-grab select-none text-center text-lg leading-none text-text-light" title="Изменить порядок">
                      ⋮⋮
                    </span>
                    <input
                      className="input h-10"
                      value={variant.name}
                      placeholder="30 см"
                      onChange={(e) => updateVariant(variant.uid, { name: e.target.value })}
                    />
                    <input
                      className="input h-10"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={variant.price}
                      placeholder="400"
                      onChange={(e) => updateVariant(variant.uid, { price: e.target.value })}
                    />
                    <input
                      className="input h-10"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={variant.stock}
                      placeholder="Без учета"
                      onChange={(e) => updateVariant(variant.uid, { stock: e.target.value })}
                    />
                    <button
                      type="button"
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/5"
                      title="Удалить вариант"
                      onClick={() => removeVariant(variant.uid)}
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function CategoryModal({
  categories,
  onClose,
}: {
  categories: AdminCategory[];
  onClose: () => void;
}) {
  const { create, update, reorder } = useCategoryMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState('');
  const [prepStation, setPrepStation] = useState<'kitchen' | 'bar' | 'none'>('kitchen');
  const [error, setError] = useState('');
  // Инлайн-переименование.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // Категория, которую удаляем (открывает выбор: перенести блюда или удалить вместе).
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);

  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  async function add() {
    setError('');
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), prepStation });
      setName('');
      setPrepStation('kitchen');
      push({ message: 'Категория добавлена', at: new Date().toISOString() });
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function changeStation(id: string, value: 'kitchen' | 'bar' | 'none') {
    try {
      await update.mutateAsync({ id, prepStation: value });
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  async function saveRename(id: string) {
    const newName = editName.trim();
    setEditingId(null);
    if (!newName || newName === sorted.find((c) => c.id === id)?.name) return;
    try {
      await update.mutateAsync({ id, name: newName });
      push({ message: 'Категория переименована', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= sorted.length) return;
    const ids = sorted.map((c) => c.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    try {
      await reorder.mutateAsync(ids);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <Modal open onClose={onClose} title="Категории">
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input flex-1"
          placeholder="Название категории"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Select
          className="h-11 w-40 shrink-0"
          value={prepStation}
          onChange={(v) => setPrepStation(v as 'kitchen' | 'bar' | 'none')}
          options={[
            { value: 'kitchen', label: 'Кухня' },
            { value: 'bar', label: 'Бар' },
            { value: 'none', label: 'Без отправки' },
          ]}
        />
        <button className="btn-primary btn-md shrink-0" disabled={create.isPending} onClick={add}>
          {create.isPending ? <Spinner /> : 'Добавить'}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <ul className="space-y-2">
        {sorted.map((c, index) => (
          <li key={c.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5">
            {/* Порядок */}
            <div className="flex shrink-0 flex-col">
              <button
                onClick={() => move(index, -1)}
                disabled={index === 0 || reorder.isPending}
                className="text-text-muted hover:text-primary disabled:opacity-30"
                title="Выше"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m18 15-6-6-6 6" /></svg>
              </button>
              <button
                onClick={() => move(index, 1)}
                disabled={index === sorted.length - 1 || reorder.isPending}
                className="text-text-muted hover:text-primary disabled:opacity-30"
                title="Ниже"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
              </button>
            </div>

            {/* Название / инлайн-правка */}
            {editingId === c.id ? (
              <input
                className="input h-9 min-w-0 flex-1"
                value={editName}
                autoFocus
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename(c.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onBlur={() => saveRename(c.id)}
              />
            ) : (
              <button
                className="min-w-0 flex-1 truncate text-left text-[15px] text-text-primary hover:text-primary"
                onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                title="Переименовать"
              >
                {c.name}
              </button>
            )}

            <div className="flex shrink-0 items-center gap-2">
              <Select
                className="h-9 w-32"
                value={c.prepStation ?? 'kitchen'}
                onChange={(v) => changeStation(c.id, v as 'kitchen' | 'bar' | 'none')}
                options={[
                  { value: 'kitchen', label: 'Кухня' },
                  { value: 'bar', label: 'Бар' },
                  { value: 'none', label: 'Без отправки' },
                ]}
              />
              <span className="w-14 text-right text-xs text-text-muted">{c._count.dishes} бл.</span>
              <button
                onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                className="text-text-muted hover:text-primary"
                title="Переименовать"
              >
                <IconEdit className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDeleteTarget(c)}
                className="text-danger hover:opacity-80"
                title="Удалить"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deleteTarget && (
        <DeleteCategorySheet
          category={deleteTarget}
          categories={sorted}
          onDone={() => setDeleteTarget(null)}
        />
      )}
    </Modal>
  );
}

/** Подтверждение удаления категории: перенести блюда или удалить вместе с блюдами. */
function DeleteCategorySheet({
  category,
  categories,
  onDone,
}: {
  category: AdminCategory;
  categories: AdminCategory[];
  onDone: () => void;
}) {
  const { remove } = useCategoryMutations();
  const push = useNotifications((s) => s.push);
  const others = categories.filter((c) => c.id !== category.id);
  const [targetId, setTargetId] = useState(others[0]?.id ?? '');
  const hasDishes = category._count.dishes > 0;

  async function run(strategy?: 'move' | 'delete', targetCategoryId?: string) {
    try {
      await remove.mutateAsync({ id: category.id, strategy, targetCategoryId });
      push({ message: 'Категория удалена', at: new Date().toISOString() });
      onDone();
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <Modal open onClose={onDone} title={`Удалить «${category.name}»`} panelClassName="max-w-md">
      {!hasDishes ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">В категории нет блюд. Удалить её?</p>
          <button className="btn-danger btn-lg w-full font-semibold" disabled={remove.isPending} onClick={() => run()}>
            {remove.isPending ? <Spinner /> : 'Удалить категорию'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            В категории {category._count.dishes} блюд. Что сделать с ними?
          </p>

          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm font-medium text-text-primary">Перенести блюда в другую категорию</p>
            {others.length === 0 ? (
              <p className="text-xs text-text-muted">Нет другой категории для переноса.</p>
            ) : (
              <div className="flex gap-2">
                <Select
                  className="h-10 min-w-0 flex-1"
                  value={targetId}
                  onChange={setTargetId}
                  options={others.map((c) => ({ value: c.id, label: c.name }))}
                />
                <button
                  className="btn-primary btn-md shrink-0"
                  disabled={remove.isPending || !targetId}
                  onClick={() => run('move', targetId)}
                >
                  {remove.isPending ? <Spinner /> : 'Перенести и удалить'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
            <p className="text-sm font-medium text-danger">Удалить категорию вместе с блюдами</p>
            <p className="text-xs text-text-muted">
              Блюда полностью удалятся из меню. История заказов и чеки сохранятся.
            </p>
            <button
              className="btn-danger btn-md w-full font-semibold"
              disabled={remove.isPending}
              onClick={() => run('delete')}
            >
              {remove.isPending ? <Spinner /> : 'Удалить вместе с блюдами'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface SetCompDraft {
  uid: string;
  dishId: string;
  dishVariantId?: string;
  name: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
}

function SetModal({ set, onClose }: { set: AdminDish | null; onClose: () => void }) {
  const isEdit = !!set;
  const { create, update } = useSetMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(set?.name ?? '');
  const [price, setPrice] = useState(set ? String(Number(set.price)) : '');
  const [components, setComponents] = useState<SetCompDraft[]>(() =>
    (set?.setComponents ?? []).map((c) => ({
      uid: c.id,
      dishId: c.dish.id,
      dishVariantId: c.dishVariant?.id,
      name: c.dishVariant ? `${c.dish.name} ${c.dishVariant.name}` : c.dish.name,
      quantity: c.quantity,
      removable: c.removable,
      replaceable: c.replaceable,
    })),
  );
  const [search, setSearch] = useState('');
  const dishesQ = useAdminDishes('', search.trim());
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  // Каждый вариант блюда — отдельный кандидат: «Coca-Cola 0.5 л» и «Coca-Cola 1 л» — разные строки.
  type Candidate = { dishId: string; dishVariantId?: string; name: string };
  const candidates: Candidate[] = (dishesQ.data ?? [])
    .filter((d) => !d.isSet && d.isActive)
    .flatMap((d): Candidate[] =>
      d.variants.length > 0
        ? d.variants.map((v) => ({ dishId: d.id, dishVariantId: v.id, name: `${d.name} ${v.name}` }))
        : [{ dishId: d.id, name: d.name }],
    )
    .filter((c) => !components.some((x) => x.dishId === c.dishId && x.dishVariantId === c.dishVariantId));

  function addComp(c: Candidate) {
    setComponents((cur) => [
      ...cur,
      {
        uid: `tmp-${c.dishId}-${c.dishVariantId ?? ''}-${Date.now()}`,
        dishId: c.dishId,
        dishVariantId: c.dishVariantId,
        name: c.name,
        quantity: 1,
        removable: true,
        replaceable: true,
      },
    ]);
  }
  function patch(uid: string, p: Partial<SetCompDraft>) {
    setComponents((cur) => cur.map((c) => (c.uid === uid ? { ...c, ...p } : c)));
  }

  async function onSubmit() {
    setError('');
    const priceNum = Number(price);
    if (!name.trim()) return setError('Укажите название сета');
    if (!Number.isFinite(priceNum) || priceNum <= 0) return setError('Цена сета должна быть больше 0');
    if (components.length === 0) return setError('Добавьте блюда в состав сета');
    const body = {
      name: name.trim(),
      price: priceNum,
      components: components.map((c) => ({
        dishId: c.dishId,
        dishVariantId: c.dishVariantId,
        quantity: c.quantity,
        removable: c.removable,
        replaceable: c.replaceable,
      })),
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: set!.id, ...body });
        push({ message: 'Сет обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Сет создан', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Изменить сет' : 'Новый сет'}
      panelClassName="max-w-xl"
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={pending} onClick={onSubmit}>
          {pending ? <Spinner /> : isEdit ? 'Сохранить' : 'Создать сет'}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Название">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Сет-6" />
          </Field>
          <Field label="Цена (с)">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-text-secondary">Состав сета</p>
          {components.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-text-muted">
              Добавьте блюда из списка ниже
            </p>
          ) : (
            <div className="space-y-1.5">
              {components.map((c) => (
                <div key={c.uid} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">{c.name}</span>
                  <input
                    className="input h-9 w-16 px-2 text-center"
                    type="number"
                    min="1"
                    value={c.quantity}
                    onChange={(e) => patch(c.uid, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={c.removable}
                      onChange={(e) => patch(c.uid, { removable: e.target.checked })}
                    />
                    убирать
                  </label>
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={c.replaceable}
                      onChange={(e) => patch(c.uid, { replaceable: e.target.checked })}
                    />
                    заменять
                  </label>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-danger hover:bg-danger/5"
                    onClick={() => setComponents((cur) => cur.filter((x) => x.uid !== c.uid))}
                    title="Убрать из состава"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-text-secondary">Добавить блюдо</p>
          <input
            className="input mb-2"
            placeholder="Поиск блюда"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {candidates.map((c) => (
              <button
                key={`${c.dishId}-${c.dishVariantId ?? ''}`}
                type="button"
                onClick={() => addComp(c)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left transition-colors hover:border-primary/40"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">{c.name}</span>
                <IconPlus className="h-4 w-4 shrink-0 text-primary" />
              </button>
            ))}
            {candidates.length === 0 && (
              <p className="py-3 text-center text-sm text-text-muted">Блюда не найдены</p>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function CatTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
      }`}
    >
      {children}
    </button>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}
function Badge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'danger' | 'muted' }) {
  const bg = {
    success: 'bg-success/15 text-success-dark',
    danger: 'bg-danger/15 text-danger-dark',
    muted: 'bg-slate-100 text-slate-600',
  }[tone];
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${bg}`}>{children}</span>;
}
function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-lg p-2 transition-colors hover:bg-background ${
        danger ? 'text-danger hover:bg-danger/5' : 'text-text-light hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
