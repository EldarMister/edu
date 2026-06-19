import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { StatCard, StatCardsRow } from '../../components/StatCard';
import { IconCategory, IconEdit, IconPlus, IconTrash, IconMoney } from '../../components/icons';
import {
  useIngredients,
  useIngredientsOverview,
  useIngredientMutations,
  qty,
  type Ingredient,
  type IngredientInput,
} from './api';
import { UNIT_OPTIONS, costUnitLabel, unitsForType, unitTypeOf, type UnitCode } from './units';

export function IngredientsTab() {
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Ingredient | null | 'new'>(null);

  const overview = useIngredientsOverview();
  const itemsQ = useIngredients(search);
  const { remove } = useIngredientMutations();
  const push = useNotifications((s) => s.push);
  const o = overview.data;

  async function onDelete(item: Ingredient) {
    if (!confirm(`Удалить «${item.name}»? Если сырьё используется в техкартах — оно будет деактивировано.`)) return;
    try {
      const res: any = await remove.mutateAsync(item.id);
      push({
        message: res?.deactivated ? 'Сырьё деактивировано (используется в техкартах)' : 'Сырьё удалено',
        at: new Date().toISOString(),
      });
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard label="Всего ингредиентов" value={o?.totalIngredients ?? '—'} icon={<IconCategory />} tone="primary" />
        <StatCard label="Низкий остаток" value={o?.lowStockCount ?? '—'} icon={<IconTrash />} tone="warning" />
        <StatCard
          label="Средняя себестоимость"
          value={o ? money(o.avgCost) : '—'}
          icon={<IconMoney />}
          tone="success"
        />
      </StatCardsRow>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <input
            className="input h-10 sm:max-w-xs"
            placeholder="Поиск по сырью"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-primary btn-md font-medium" onClick={() => setModal('new')}>
            <IconPlus className="h-4 w-4" /> Добавить сырьё
          </button>
        </div>

        {itemsQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-background/50 text-left text-xs text-text-muted">
                  <th className="px-4 py-3 font-medium">Ингредиент</th>
                  <th className="px-4 py-3 text-center font-medium">Ед. изм.</th>
                  <th className="px-4 py-3 text-center font-medium">Текущий остаток</th>
                  <th className="px-4 py-3 text-center font-medium">Ср. себестоимость</th>
                  <th className="px-4 py-3 text-center font-medium">Порог низкого остатка</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {itemsQ.data?.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-background/60">
                    <td className="px-4 py-3 font-medium text-text-primary">{item.name}</td>
                    <td className="px-4 py-3 text-center text-text-secondary">{item.unit}</td>
                    <td className="px-4 py-3 text-center font-medium text-text-primary">
                      {qty(item.stock, item.unit)}
                    </td>
                    <td className="px-4 py-3 text-center text-text-secondary">
                      {money(item.avgCost)}/{item.unit}
                    </td>
                    <td className="px-4 py-3 text-center text-text-secondary">
                      {qty(item.lowStockThreshold, item.unit)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={item.isLow ? 'warning' : 'success'}>{item.isLow ? 'Низкий' : 'Норма'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setModal(item)}
                          className="p-2 text-text-light transition-colors hover:text-primary"
                          title="Редактировать"
                        >
                          <IconEdit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => onDelete(item)}
                          className="p-2 text-text-light transition-colors hover:text-danger"
                          title="Удалить / деактивировать"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {itemsQ.data?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-text-muted">
                      Сырьё не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card flex items-start gap-3 p-4 text-sm text-text-secondary">
        <span className="mt-0.5 text-primary">
          <IconCategory className="h-5 w-5" />
        </span>
        <p>
          <span className="font-medium text-text-primary">Правило низкого остатка:</span>{' '}
          сырьё помечается как «Низкий», когда текущий остаток меньше или равен заданному порогу низкого остатка.
        </p>
      </div>

      {modal !== null && (
        <IngredientModal item={modal === 'new' ? null : modal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function IngredientModal({ item, onClose }: { item: Ingredient | null; onClose: () => void }) {
  const isEdit = !!item;
  const { create, update } = useIngredientMutations();
  const push = useNotifications((s) => s.push);

  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<UnitCode>(item?.displayUnit ?? 'g');
  const [stock, setStock] = useState(String(item?.stock ?? 0));
  const [avgCost, setAvgCost] = useState(String(item?.avgCost ?? 0));
  const [threshold, setThreshold] = useState(String(item?.lowStockThreshold ?? 0));
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  async function onSubmit() {
    setError('');
    if (!name.trim()) {
      setError('Укажите название сырья');
      return;
    }
    const body: IngredientInput = {
      name: name.trim(),
      unit,
      stock: Number(stock) || 0,
      avgCost: Number(avgCost) || 0,
      lowStockThreshold: Number(threshold) || 0,
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: item!.id, ...body });
        push({ message: 'Сырьё обновлено', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Сырьё добавлено', at: new Date().toISOString() });
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
      title={isEdit ? 'Редактировать сырьё' : 'Добавить сырьё'}
      panelClassName="max-w-lg"
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={pending} onClick={onSubmit}>
          {pending ? <Spinner /> : isEdit ? 'Сохранить изменения' : 'Создать'}
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="Название сырья">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Куриное филе" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Единица измерения">
            <Select
              className="h-11 w-full"
              value={unit}
              onChange={(v) => setUnit(v as UnitCode)}
              options={UNIT_OPTIONS}
            />
          </Field>
          <Field label="Текущий остаток">
            <input className="input" type="number" step="0.001" value={stock} onChange={(e) => setStock(e.target.value)} />
          </Field>
          <Field label={`Ср. себестоимость (${costUnitLabel(unit)})`}>
            <input className="input" type="number" step="0.01" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} />
          </Field>
          <Field label="Порог низкого остатка">
            <input
              className="input"
              type="number"
              step="0.001"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {isEdit && item && <AdjustBlock ingredient={item} />}
      </div>
    </Modal>
  );
}

/** Блок ручной корректировки остатка: добавить / списать / установить (ТЗ §8). */
function AdjustBlock({ ingredient }: { ingredient: Ingredient }) {
  const { adjust } = useIngredientMutations();
  const push = useNotifications((s) => s.push);
  const [mode, setMode] = useState<'add' | 'writeoff' | 'set'>('add');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<UnitCode>(ingredient.displayUnit);
  const [error, setError] = useState('');

  const unitOptions = unitsForType(unitTypeOf(ingredient.displayUnit));
  const MODE_LABEL = { add: 'Добавить', writeoff: 'Списать', set: 'Установить остаток' } as const;

  async function onApply() {
    setError('');
    const q = Number(quantity);
    if (!Number.isFinite(q) || q < 0) {
      setError('Укажите количество');
      return;
    }
    try {
      await adjust.mutateAsync({ id: ingredient.id, mode, quantity: q, unit });
      setQuantity('');
      push({ message: `${MODE_LABEL[mode]}: ${q} ${unitOptions.find((u) => u.value === unit)?.label ?? ''}`, at: new Date().toISOString() });
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <p className="mb-2 text-xs font-medium text-text-secondary">Корректировка остатка</p>
      <div className="grid grid-cols-[1.1fr_0.9fr_0.7fr_auto] items-end gap-2">
        <Field label="Операция">
          <Select
            className="h-9 w-full text-sm"
            value={mode}
            onChange={(v) => setMode(v as 'add' | 'writeoff' | 'set')}
            options={[
              { value: 'add', label: 'Добавить' },
              { value: 'writeoff', label: 'Списать' },
              { value: 'set', label: 'Установить' },
            ]}
          />
        </Field>
        <Field label="Кол-во">
          <input
            className="input h-9 text-sm"
            type="number"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Ед.">
          <Select
            className="h-9 w-full text-sm"
            value={unit}
            onChange={(v) => setUnit(v as UnitCode)}
            options={unitOptions}
          />
        </Field>
        <button type="button" className="btn-secondary btn-md h-9" onClick={onApply} disabled={adjust.isPending}>
          {adjust.isPending ? <Spinner className="h-4 w-4" /> : 'Применить'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
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
