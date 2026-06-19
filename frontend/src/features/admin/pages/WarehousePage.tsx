import { useState, Fragment } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { StatCard, StatCardsRow } from '../components/StatCard';
import { IconCategory, IconEdit, IconPlus, IconMenu, IconTrash } from '../components/icons';
import { useWarehouseOverview, useWarehouseItems } from '../warehouse-api';
import { normalizeUnitLabel, unitLabelOptions } from './warehouse/units';
import {
  useAdminCategories,
  useDishMutations,
  type AdminDish,
  type AdminCategory,
  type AdminDishVariant,
} from '../api';

export function WarehousePage() {
  const categoryId = '';
  const [search, setSearch] = useState('');
  const [modalItem, setModalItem] = useState<AdminDish | null | 'new'>(null);

  const overview = useWarehouseOverview();
  const categoriesQ = useAdminCategories();
  const itemsQ = useWarehouseItems(search, categoryId);
  const o = overview.data;

  // Раскрытие рядов для отображения вариантов
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  function toggleRow(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard label="Напитков" value={o?.totalDrinks ?? '—'} icon={<IconCategory />} tone="primary" />
        <StatCard label="Всего единиц" value={o?.totalUnits ?? '—'} icon={<IconMenu />} tone="success" />
      </StatCardsRow>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              className="input h-10 sm:max-w-xs"
              placeholder="Поиск по складу"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn-primary btn-md font-medium" onClick={() => setModalItem('new')}>
              <IconPlus className="h-4 w-4" /> Добавить товар
            </button>
          </div>
        </div>

        {itemsQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted bg-background/50">
                  <th className="px-4 py-3 font-medium w-1/4">Товар</th>
                  <th className="px-4 py-3 font-medium text-center">Остаток</th>
                  <th className="px-4 py-3 font-medium text-center">Ед. изм.</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {itemsQ.data?.map((item) => {
                  const hasVariants = item.variants.length > 0;
                  const isExp = expanded[item.id];
                  const aggregate = aggregateInventory(item);
                  
                  let statusTone: 'success' | 'warning' | 'danger' | 'muted' = 'success';
                  let statusLabel = 'В наличии';
                  if (aggregate.stock === 0) {
                    statusTone = 'danger';
                    statusLabel = 'Нет в наличии';
                  } else if (aggregate.low) {
                    statusTone = 'warning';
                    statusLabel = 'Мало осталось';
                  }

                  return (
                    <Fragment key={item.id}>
                      <tr
                        className={`border-b border-border last:border-0 hover:bg-background/60 ${
                          hasVariants ? 'cursor-pointer' : ''
                        } ${isExp ? 'bg-background/40' : ''}`}
                        onClick={hasVariants ? () => toggleRow(item.id) : undefined}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {hasVariants && <Chevron open={!!isExp} />}
                            <p className="font-medium text-text-primary">{item.name}</p>
                          </div>
                          {hasVariants && (
                            <p className="text-xs text-text-muted ml-6">
                              {item.variants.length} вариант(ов)
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-text-primary font-medium">
                          {aggregate.stock}
                        </td>
                        <td className="px-4 py-3 text-center text-text-secondary">
                          {aggregate.unit}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone}>{statusLabel}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setModalItem(item);
                            }}
                            className="text-text-light hover:text-primary p-2 transition-colors"
                            title="Изменить"
                          >
                            <IconEdit className="h-4 w-4 inline-block" /> Изменить
                          </button>
                        </td>
                      </tr>

                      {/* Строки вариантов */}
                      {hasVariants && isExp && item.variants.map((v) => {
                        let vStatusTone: 'success' | 'warning' | 'danger' | 'muted' = 'success';
                        let vStatusLabel = 'В наличии';
                        const vStock = v.stock ?? 0;
                        const vInitial = v.initialStock ?? vStock;
                        if (vStock === 0) {
                          vStatusTone = 'danger';
                          vStatusLabel = 'Нет в наличии';
                        } else if (vStock <= 0.2 * vInitial) {
                          vStatusTone = 'warning';
                          vStatusLabel = 'Мало осталось';
                        }

                        return (
                          <tr key={v.id} className="border-b border-border bg-slate-50/50 hover:bg-slate-50">
                            <td className="px-4 py-3 pl-12 text-text-secondary">↳ {v.name}</td>
                            <td className="px-4 py-3 text-center text-text-primary font-medium">{vStock}</td>
                            <td className="px-4 py-3 text-center text-text-secondary">{normalizeUnitLabel(v.unit)}</td>
                            <td className="px-4 py-3"><Badge tone={vStatusTone}>{vStatusLabel}</Badge></td>
                            <td className="px-4 py-3"></td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {itemsQ.data?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-text-muted">
                      Складские товары не найдены
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalItem !== null && (
        <WarehouseItemModal
          item={modalItem === 'new' ? null : modalItem}
          categories={categoriesQ.data ?? []}
          defaultCategoryId={categoryId}
          onClose={() => setModalItem(null)}
        />
      )}
    </div>
  );
}

interface VariantDraft {
  uid: string;
  id?: string;
  name: string;
  price: string;
  stock: string;
  unit: string;
}

function variantDraft(v?: AdminDishVariant): VariantDraft {
  return {
    uid: v?.id ?? `tmp-${Date.now()}-${Math.random()}`,
    id: v?.id,
    name: v?.name ?? '',
    price: v ? String(Number(v.price)) : '0',
    stock: String(v?.stock ?? 0),
    unit: normalizeUnitLabel(v?.unit),
  };
}

function WarehouseItemModal({
  item,
  categories,
  defaultCategoryId,
  onClose,
}: {
  item: AdminDish | null;
  categories: AdminCategory[];
  defaultCategoryId: string;
  onClose: () => void;
}) {
  const isEdit = !!item;
  const { create, update } = useDishMutations();
  const push = useNotifications((s) => s.push);

  const defaultCat = categories.find(c => c.name.toLowerCase() === 'напитки' || c.name.toLowerCase() === 'drinks')?.id || categories[0]?.id || '';
  const [name, setName] = useState(item?.name ?? '');
  const [categoryId] = useState(
    item?.categoryId ?? (defaultCategoryId || defaultCat),
  );
  const [description, setDescription] = useState(item?.description ?? '');
  const [isAvailable, setIsAvailable] = useState(item?.isAvailable ?? true);
  
  // Поля для товара без вариантов
  const [price, setPrice] = useState(item && item.variants.length === 0 ? String(Number(item.price)) : '0');
  const [stock, setStock] = useState(String(item?.stock ?? 0));
  const [unit, setUnit] = useState(normalizeUnitLabel(item?.unit));

  const [variants, setVariants] = useState<VariantDraft[]>(() => item?.variants.map(variantDraft) ?? []);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  function updateVariant(uid: string, patch: Partial<VariantDraft>) {
    setVariants((current) => current.map((v) => (v.uid === uid ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    setVariants((current) => [...current, variantDraft()]);
  }

  function removeVariant(uid: string) {
    setVariants((current) => current.filter((v) => v.uid !== uid));
  }

  async function onSubmit() {
    setError('');
    if (!name.trim() || !categoryId) {
      setError('Заполните название и категорию');
      return;
    }

    const hasVariants = variants.length > 0;
    
    // Проверки вариантов
    for (const v of variants) {
      if (!v.name.trim()) {
        setError('Укажите название для каждого варианта');
        return;
      }
    }

    try {
      const body = {
        name: name.trim(),
        categoryId,
        description: description.trim() || undefined,
        isAvailable,
        isActive: true, // Складские товары всегда активны при создании
        trackInventory: true, // ВАЖНО: отмечаем как складской товар
        // Если есть варианты, поля товара игнорируются при списании, но мы передаем базовые
        price: hasVariants ? undefined : Number(price),
        stock: hasVariants ? undefined : Number(stock),
        initialStock: hasVariants || isEdit ? undefined : Number(stock),
        unit: hasVariants ? undefined : unit,
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name.trim(),
          price: Number(v.price),
          stock: Number(v.stock),
          initialStock: isEdit && v.id ? undefined : Number(v.stock),
          unit: v.unit,
        })),
      };

      if (isEdit) {
        await update.mutateAsync({ id: item!.id, ...body });
        push({ message: 'Товар обновлен', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Товар добавлен', at: new Date().toISOString() });
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
      title={isEdit ? 'Редактировать товар' : 'Добавить товар'}
      panelClassName="max-w-2xl"
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={pending} onClick={onSubmit}>
          {pending ? <Spinner /> : isEdit ? 'Сохранить изменения' : 'Создать'}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          <Field label="Название товара">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
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

        <label className="flex items-center gap-2.5 text-sm text-text-secondary">
          <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
          Доступно для заказа (Активно)
        </label>

        {variants.length === 0 && (
          <div className="grid grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-border">
            <Field label="Цена (с)">
              <input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Остаток">
              <input className="input" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
            </Field>
            <Field label="Ед. изм.">
              <Select value={unit} onChange={setUnit} options={unitLabelOptions(unit)} className="h-10 w-full" />
            </Field>
          </div>
        )}

        <div className="pt-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-text-primary">Варианты товара</h4>
            <button type="button" className="btn-secondary btn-md" onClick={addVariant}>
              <IconPlus className="h-4 w-4" /> Добавить вариант
            </button>
          </div>
          
          {variants.length > 0 && (
            <div className="space-y-2">
              {variants.map((v) => (
                <div key={v.uid} className="flex gap-2 items-start bg-slate-50 p-3 rounded-xl border border-border">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <Field label="Название">
                      <input className="input h-9 text-sm" value={v.name} onChange={(e) => updateVariant(v.uid, { name: e.target.value })} />
                    </Field>
                    <Field label="Цена">
                      <input className="input h-9 text-sm" type="number" value={v.price} onChange={(e) => updateVariant(v.uid, { price: e.target.value })} />
                    </Field>
                    <Field label="Остаток">
                      <input className="input h-9 text-sm" type="number" value={v.stock} onChange={(e) => updateVariant(v.uid, { stock: e.target.value })} />
                    </Field>
                    <Field label="Ед. изм.">
                      <Select
                        value={v.unit}
                        onChange={(value) => updateVariant(v.uid, { unit: value })}
                        options={unitLabelOptions(v.unit)}
                        className="h-9 w-full text-sm"
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    className="mt-6 flex h-9 w-9 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
                    title="Удалить вариант"
                    onClick={() => removeVariant(v.uid)}
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function aggregateInventory(item: AdminDish): { stock: number; unit: string; low: boolean } {
  if (item.variants.length === 0) {
    const stock = item.stock ?? 0;
    const initial = item.initialStock ?? stock;
    return {
      stock,
      unit: normalizeUnitLabel(item.unit),
      low: initial > 0 && stock <= 0.2 * initial,
    };
  }

  const units = new Set(item.variants.map((variant) => normalizeUnitLabel(variant.unit)));
  const stock = item.variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0);
  const low = item.variants.some((variant) => {
    const stockValue = variant.stock ?? 0;
    const initial = variant.initialStock ?? stockValue;
    return initial > 0 && stockValue <= 0.2 * initial;
  });

  return {
    stock,
    unit: units.size === 1 ? [...units][0] : 'по вариантам',
    low,
  };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-text-light transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  const cls = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    muted: 'bg-slate-100 text-text-muted',
  }[tone];
  return <span className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
