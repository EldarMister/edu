import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { minDishUnitPrice, money, variantNamesLine } from '@/lib/format';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { StatCard, StatCardsRow } from '../components/StatCard';
import { IconMenu, IconCategory, IconCheck, IconMoney, IconEdit, IconTrash, IconPlus } from '../components/icons';
import {
  useMenuOverview,
  useAdminCategories,
  useAdminDishes,
  useCategoryMutations,
  useDishMutations,
  type AdminDish,
  type AdminCategory,
  type AdminDishVariant,
} from '../api';

export function MenuPage() {
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [dishModal, setDishModal] = useState<AdminDish | null | 'new'>(null);
  const [catModal, setCatModal] = useState(false);

  const overview = useMenuOverview();
  const categoriesQ = useAdminCategories();
  const dishesQ = useAdminDishes(categoryId, search);
  const { remove } = useDishMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();
  const o = overview.data;

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
        <StatCard
          label={tr('Средняя цена')}
          value={o ? money(o.avgPrice) : '—'}
          icon={<IconMoney />}
          tone="muted"
        />
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
                  <th className="px-4 py-3 font-medium">{tr('Статус')}</th>
                  <th className="px-4 py-3 text-right font-medium">{tr('Действия')}</th>
                </tr>
              </thead>
              <tbody>
                {dishesQ.data?.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-background/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">{d.name}</p>
                      {d.variants.length > 0 && (
                        <p className="text-xs font-medium text-primary">{variantNamesLine(d.variants)}</p>
                      )}
                      {d.description && <p className="text-xs text-text-muted">{d.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{d.category.name}</td>
                    <td className="px-4 py-3 text-right font-medium text-text-primary">
                      {d.variants.length > 0 ? `от ${money(minDishUnitPrice(d))}` : money(d.price)}
                    </td>
                    <td className="px-4 py-3">
                      {d.isActive && d.isAvailable ? (
                        <Badge tone="success">{tr('Активно')}</Badge>
                      ) : (
                        <Badge tone="muted">{tr('Скрыто')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn onClick={() => setDishModal(d)} title="Изменить">
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
                    <td colSpan={5} className="px-4 py-10 text-center text-text-muted">
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
}

function variantDraft(variant?: AdminDishVariant): DishVariantDraft {
  return {
    uid: variant?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: variant?.id,
    name: variant?.name ?? '',
    price: variant ? String(Number(variant.price)) : '',
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
  const [description, setDescription] = useState(dish?.description ?? '');
  const [isAvailable, setIsAvailable] = useState(dish?.isAvailable ?? true);
  const [variants, setVariants] = useState<DishVariantDraft[]>(() => dish?.variants.map(variantDraft) ?? []);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  function updateVariant(uid: string, patch: Partial<Pick<DishVariantDraft, 'name' | 'price'>>) {
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
        variants: filledVariants.map((variant) => ({
          id: variant.id,
          name: variant.name,
          price: Number(variant.price),
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
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[28px_minmax(0,1fr)_112px_36px] gap-2 border-b border-border bg-background px-3 py-2 text-xs font-medium text-text-muted">
              <span />
              <span>Название варианта</span>
              <span>Цена (с)</span>
              <span />
            </div>
            {variants.length === 0 ? (
              <div className="px-3 py-4 text-sm text-text-muted">Варианты не добавлены</div>
            ) : (
              variants.map((variant, index) => (
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
                  className={`grid grid-cols-[28px_minmax(0,1fr)_112px_36px] items-center gap-2 border-b border-border px-3 py-2 last:border-0 ${
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
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/5"
                    title="Удалить вариант"
                    onClick={() => removeVariant(variant.uid)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              ))
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
  const { create, remove } = useCategoryMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function add() {
    setError('');
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim() });
      setName('');
      push({ message: 'Категория добавлена', at: new Date().toISOString() });
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function onDelete(id: string, label: string) {
    if (!confirm(`Удалить категорию «${label}»?`)) return;
    try {
      await remove.mutateAsync(id);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <Modal open onClose={onClose} title="Категории">
      <div className="mb-4 flex gap-2">
        <input
          className="input"
          placeholder="Название категории"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn-primary btn-md shrink-0" disabled={create.isPending} onClick={add}>
          {create.isPending ? <Spinner /> : 'Добавить'}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <ul className="space-y-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-xl border border-border px-3.5 py-2.5">
            <span className="text-[15px] text-text-primary">{c.name}</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted">{c._count.dishes} блюд</span>
              <button
                onClick={() => onDelete(c.id, c.name)}
                className="text-danger hover:opacity-80"
                title="Удалить"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
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
function Badge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'muted' }) {
  const cls = tone === 'success' ? 'bg-success/10 text-success' : 'bg-slate-100 text-text-muted';
  return <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</span>;
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
