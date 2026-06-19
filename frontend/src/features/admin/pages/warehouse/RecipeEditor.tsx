import { useState } from 'react';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { IconPlus, IconTrash, IconCheck, IconEdit } from '../../components/icons';
import { useRecipe, useRecipeMutations, useIngredients, qty, type RecipeItem } from './api';
import { unitsForType, unitTypeOf, type UnitCode } from './units';

/** Вкладка «Техкарта» внутри модалки блюда: ингредиенты на 1 порцию, себестоимость, маржа. */
export function RecipeEditor({ dishId, price }: { dishId: string; price: number }) {
  const recipeQ = useRecipe(dishId);
  const ingredientsQ = useIngredients('');
  const { addItem, updateItem, removeItem } = useRecipeMutations(dishId);
  const push = useNotifications((s) => s.push);

  const [newIngredientId, setNewIngredientId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newUnit, setNewUnit] = useState<UnitCode | ''>('');
  const [error, setError] = useState('');

  const recipe = recipeQ.data;
  const ingredients = ingredientsQ.data ?? [];
  const usedIds = new Set(recipe?.items.map((i) => i.ingredientId) ?? []);
  const available = ingredients.filter((i) => !usedIds.has(i.id));
  const selectedIngredient = ingredients.find((i) => i.id === newIngredientId);
  // Единицы того же типа, что у выбранного ингредиента; по умолчанию — его единица.
  const newUnitOptions = selectedIngredient ? unitsForType(selectedIngredient.unitType) : [];
  const effectiveNewUnit = (newUnit || selectedIngredient?.displayUnit || '') as UnitCode | '';

  const foodCost = recipe?.foodCost ?? 0;
  const margin = recipe?.marginPercent ?? (price > 0 ? ((price - foodCost) / price) * 100 : 0);

  async function onAdd() {
    setError('');
    if (!newIngredientId) {
      setError('Выберите ингредиент');
      return;
    }
    const amount = Number(newAmount);
    if (!amount || amount <= 0) {
      setError('Укажите количество на порцию');
      return;
    }
    try {
      await addItem.mutateAsync({
        ingredientId: newIngredientId,
        amount,
        unit: effectiveNewUnit || undefined,
      });
      setNewIngredientId('');
      setNewAmount('');
      setNewUnit('');
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function onRemove(item: RecipeItem) {
    try {
      await removeItem.mutateAsync(item.id);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  if (recipeQ.isLoading) {
    return (
      <div className="flex justify-center py-10 text-primary">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Цена / себестоимость / маржа */}
      <div className="grid grid-cols-3 gap-2">
        <HeadCard label="Цена продажи" value={money(price)} tone="muted" />
        <HeadCard label="Себестоимость порции" value={money(foodCost)} tone="primary" />
        <HeadCard label="Маржа" value={`${margin.toFixed(1)}%`} tone={margin >= 0 ? 'success' : 'danger'} />
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 font-medium text-primary">
          <IconCheck className="h-3.5 w-3.5" /> Авторасчёт по ингредиентам
        </span>
      </div>

      {/* Таблица ингредиентов */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-background text-left text-xs text-text-muted">
                <th className="px-3 py-2 font-medium">Ингредиент</th>
                <th className="px-3 py-2 text-center font-medium">Ед.</th>
                <th className="px-3 py-2 text-center font-medium">Кол-во</th>
                <th className="px-3 py-2 text-right font-medium">Ср. себест. ед.</th>
                <th className="px-3 py-2 text-right font-medium">Себест. в порции</th>
                <th className="px-3 py-2 text-center font-medium">Остаток</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {recipe?.items.map((item) => (
                <RecipeRow
                  key={item.id}
                  item={item}
                  onSave={(amount, unit) => updateItem.mutateAsync({ id: item.id, amount, unit })}
                  onRemove={() => onRemove(item)}
                />
              ))}
              {recipe?.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                    Техкарта пуста — добавьте ингредиенты
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-background/60">
                <td colSpan={4} className="px-3 py-2.5 text-right font-medium text-text-secondary">
                  Итого себестоимость порции
                </td>
                <td className="px-3 py-2.5 text-right font-semibold text-text-primary">{money(foodCost)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Добавление ингредиента */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-background/40 p-3">
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Ингредиент</label>
          <Select
            className="h-9 w-full text-sm"
            value={newIngredientId}
            onChange={(v) => {
              setNewIngredientId(v);
              setNewUnit(''); // сбрасываем — подставится единица нового ингредиента
            }}
            placeholder="Выберите…"
            options={available.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))}
          />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Кол-во</label>
          <input
            className="input h-9 text-sm"
            type="number"
            step="0.001"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
          />
        </div>
        <div className="w-20">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Ед.</label>
          <Select
            className="h-9 w-full text-sm"
            value={effectiveNewUnit}
            onChange={(v) => setNewUnit(v as UnitCode)}
            placeholder="—"
            options={newUnitOptions}
          />
        </div>
        <button type="button" className="btn-primary btn-md" onClick={onAdd} disabled={addItem.isPending}>
          {addItem.isPending ? <Spinner /> : <><IconPlus className="h-4 w-4" /> Добавить ингредиент</>}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Как рассчитывается */}
      <div className="rounded-xl border border-border bg-background/40 p-3 text-sm text-text-secondary">
        <p className="mb-1 font-medium text-text-primary">Как рассчитывается</p>
        <p>Себестоимость ингредиента в порции = Кол-во на порцию × Ср. себестоимость ед.</p>
        <p>Себестоимость блюда = сумма себестоимостей всех ингредиентов.</p>
        <p>Маржа = (Цена продажи − Себестоимость) ÷ Цена продажи × 100%.</p>
      </div>
    </div>
  );
}

function RecipeRow({
  item,
  onSave,
  onRemove,
}: {
  item: RecipeItem;
  onSave: (amount: number, unit: string) => Promise<unknown>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(item.amount));
  const [unit, setUnit] = useState<UnitCode>(item.amountUnit);
  const [busy, setBusy] = useState(false);
  const unitOptions = unitsForType(unitTypeOf(item.amountUnit));

  async function save() {
    const value = Number(amount);
    if (!value || value <= 0) return;
    setBusy(true);
    try {
      await onSave(value, unit);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-medium text-text-primary">{item.name}</td>
      <td className="px-3 py-2 text-center text-text-secondary">
        {editing ? (
          <Select
            className="h-8 w-20 text-sm"
            value={unit}
            onChange={(v) => setUnit(v as UnitCode)}
            options={unitOptions}
          />
        ) : (
          item.unit
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {editing ? (
          <input
            className="input h-8 w-20 text-center text-sm"
            type="number"
            step="0.001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        ) : (
          <span className="text-text-primary">{qty(item.amount, item.unit)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-text-secondary">{money(item.avgCost)}</td>
      <td className="px-3 py-2 text-right font-medium text-text-primary">{money(item.lineCost)}</td>
      <td className="px-3 py-2 text-center text-text-secondary">{qty(item.stock, item.unit)}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-medium ${
            item.isLow ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
          }`}
        >
          {item.isLow ? 'Низкий' : 'Норма'}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <button
              onClick={save}
              disabled={busy}
              className="p-1.5 text-text-light transition-colors hover:text-success"
              title="Сохранить"
            >
              {busy ? <Spinner className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}
            </button>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 text-text-light transition-colors hover:text-primary"
              title="Изменить количество"
            >
              <IconEdit className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-1.5 text-text-light transition-colors hover:text-danger"
            title="Удалить из техкарты"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function HeadCard({ label, value, tone }: { label: string; value: string; tone: 'muted' | 'primary' | 'success' | 'danger' }) {
  const cls = {
    muted: 'text-text-primary',
    primary: 'text-primary',
    success: 'text-success',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-white p-2.5 text-center">
      <p className="text-[11px] leading-tight text-text-muted">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
