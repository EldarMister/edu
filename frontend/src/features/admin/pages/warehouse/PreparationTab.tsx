import { useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import {
  qty, useIngredients, usePreparationMutations, usePreparationRecipe, usePreparedIngredients,
  type Ingredient, type PreparationRecipe, type WarehouseLocation,
} from './api';
import { UNIT_OPTIONS, unitsForType, type UnitCode } from './units';

type PreparationAction = { kind: 'create' } | { kind: 'recipe' | 'produce'; id: string; name: string };

export function PreparationTab({ warehouse }: { warehouse: WarehouseLocation }) {
  const prepared = usePreparedIngredients(warehouse.id);
  const [action, setAction] = useState<PreparationAction | null>(null);
  const close = () => setAction(null);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h3 className="text-[15px] font-semibold text-text-primary">Полуфабрикаты</h3>
        <button type="button" className="btn-primary btn-md" onClick={() => setAction({ kind: 'create' })}>Добавить полуфабрикат</button>
      </div>
      {prepared.isLoading && <div className="flex justify-center py-8 text-primary"><Spinner /></div>}
      {prepared.isError && <p role="alert" className="p-4 text-sm text-danger">{apiError(prepared.error)}</p>}
      {prepared.data?.length === 0 && <p className="p-4 text-sm text-text-muted">Полуфабрикатов пока нет</p>}
      {prepared.data && prepared.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Название</th>
                <th scope="col" className="px-4 py-3 font-medium">Остаток</th>
                <th scope="col" className="px-4 py-3 font-medium">Себестоимость</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {prepared.data.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-medium text-text-primary">{item.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{qty(item.stock, item.unit)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{money(item.avgCost)} / {item.unit}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn-secondary btn-md" onClick={() => setAction({ kind: 'recipe', id: item.id, name: item.name })}>Техкарта</button>
                      <button type="button" className="btn-primary btn-md" onClick={() => setAction({ kind: 'produce', id: item.id, name: item.name })}>Приготовить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {action?.kind === 'create' && <NewPreparationModal onClose={close} onCreated={(item) => setAction({ kind: 'recipe', id: item.id, name: item.name })} />}
      {action && action.kind !== 'create' && <PreparationModal key={action.id} action={action} warehouse={warehouse} onClose={close} />}
    </div>
  );
}

function NewPreparationModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (item: { id: string; name: string }) => void;
}) {
  const { create } = usePreparationMutations();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<UnitCode>('g');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending || !name.trim()) return;
    setError('');
    try {
      onCreated(await create.mutateAsync({ name: name.trim(), unit }));
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal open title="Новый полуфабрикат" onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm text-text-secondary">
          Название
          <input className="input mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
        </label>
        <Field label="Единица измерения">
          <Select ariaLabel="Единица измерения" value={unit} onChange={(value) => setUnit(value as UnitCode)} options={UNIT_OPTIONS} className="h-10 w-full" />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" className="btn-primary btn-md w-full" disabled={!name.trim() || create.isPending}>Добавить</button>
      </form>
    </Modal>
  );
}

function PreparationModal({ action, warehouse, onClose }: {
  action: Exclude<PreparationAction, { kind: 'create' }>;
  warehouse: WarehouseLocation;
  onClose: () => void;
}) {
  const recipe = usePreparationRecipe(action.id);
  const title = action.kind === 'recipe' ? `Техкарта · ${action.name}` : `Приготовить · ${action.name}`;
  return (
    <Modal open title={title} onClose={onClose} panelClassName="max-w-xl">
      {recipe.isPending && <div className="flex justify-center py-8 text-primary"><Spinner /></div>}
      {recipe.isError && <p role="alert" className="text-sm text-danger">{apiError(recipe.error)}</p>}
      {recipe.data && action.kind === 'recipe' && <RecipeForm recipe={recipe.data} onClose={onClose} />}
      {recipe.data && action.kind === 'produce' && <BatchForm recipe={recipe.data} warehouse={warehouse} onClose={onClose} />}
    </Modal>
  );
}

interface RecipeDraft {
  key: string;
  ingredientId: string;
  quantity: string;
  unit: UnitCode | '';
}

function RecipeForm({ recipe, onClose }: { recipe: PreparationRecipe; onClose: () => void }) {
  const ingredients = useIngredients('');
  const { saveRecipe } = usePreparationMutations();
  const push = useNotifications((state) => state.push);
  const [outputQuantity, setOutputQuantity] = useState(String(recipe.outputQuantity));
  const [outputUnit, setOutputUnit] = useState(recipe.outputUnit);
  const [rows, setRows] = useState<RecipeDraft[]>(() => recipe.items.map((item) => ({
    key: item.ingredientId,
    ingredientId: item.ingredientId,
    quantity: String(item.quantity),
    unit: item.unit,
  })));
  const [error, setError] = useState('');
  const options = ingredients.data?.filter((item) => item.id !== recipe.id) ?? [];
  const byId = new Map(options.map((item) => [item.id, item]));
  const recipeNames = new Map(recipe.items.map((item) => [item.ingredientId, item.name]));
  const selected = new Set(rows.map((row) => row.ingredientId));
  const canSave = isPositive(outputQuantity) && rows.length > 0 &&
    rows.every((row) => row.ingredientId && row.unit && isPositive(row.quantity));

  function update(key: string, patch: Partial<RecipeDraft>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || saveRecipe.isPending) return;
    setError('');
    try {
      await saveRecipe.mutateAsync({
        id: recipe.id, outputQuantity: Number(outputQuantity), outputUnit,
        items: rows.map(({ ingredientId, quantity, unit }) => ({ ingredientId, quantity: Number(quantity), unit: unit as UnitCode })),
      });
      push({ message: 'Техкарта сохранена', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-2">
        <Quantity label="Выход по техкарте" value={outputQuantity} onChange={setOutputQuantity} />
        <Field label="Единица выхода">
          <Select ariaLabel="Единица выхода" className="h-10 w-full" options={unitsForType(recipe.unitType)} value={outputUnit}
            onChange={(value) => setOutputUnit(value as UnitCode)} />
        </Field>
      </div>
      {rows.map((row) => {
        const ingredient = byId.get(row.ingredientId);
        const choices = options.filter(({ id }) => id === row.ingredientId || !selected.has(id)).map(({ id, name }) => ({ value: id, label: name }));
        if (row.ingredientId && !ingredient) choices.unshift({ value: row.ingredientId, label: recipeNames.get(row.ingredientId) ?? 'Сырьё' });
        return (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1.4fr_0.7fr_0.8fr_auto] sm:items-end" key={row.key}>
            <Field label="Сырьё">
              <Select ariaLabel="Сырьё" className="h-10 w-full" value={row.ingredientId} options={choices} onChange={(ingredientId) =>
                update(row.key, { ingredientId, unit: byId.get(ingredientId)?.displayUnit ?? '' })} />
            </Field>
            <Quantity label="Количество" value={row.quantity} onChange={(quantity) => update(row.key, { quantity })} />
            <Field label="Единица">
              <Select ariaLabel="Единица" className="h-10 w-full" value={row.unit} options={ingredientUnits(ingredient, row.unit)}
                disabled={!row.ingredientId} onChange={(unit) => update(row.key, { unit: unit as UnitCode })} />
            </Field>
            <button type="button" className="btn-secondary btn-md self-end" onClick={() => setRows((current) => current.filter(({ key }) => key !== row.key))}>Убрать</button>
          </div>
        );
      })}
      <button type="button" className="btn-secondary btn-md" disabled={ingredients.isPending || rows.length >= options.length}
        onClick={() => setRows((current) => [...current, { key: crypto.randomUUID(), ingredientId: '', quantity: '', unit: '' }])}>Добавить сырьё</button>
      {(error || ingredients.isError) && <p role="alert" className="text-sm text-danger">{error || apiError(ingredients.error)}</p>}
      <button type="submit" className="btn-primary btn-md w-full" disabled={!canSave || saveRecipe.isPending}>Сохранить техкарту</button>
    </form>
  );
}

function BatchForm({ recipe, warehouse, onClose }: { recipe: PreparationRecipe; warehouse: WarehouseLocation; onClose: () => void }) {
  const { produce } = usePreparationMutations();
  const push = useNotifications((state) => state.push);
  const [quantity, setQuantity] = useState(String(recipe.outputQuantity));
  const [unit, setUnit] = useState(recipe.outputUnit);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!recipe.items.length || !isPositive(quantity) || produce.isPending) return;
    setError('');
    try {
      const batch = await produce.mutateAsync({ id: recipe.id, warehouseId: warehouse.id, quantity: Number(quantity), unit });
      push({ message: `Партия готова · себестоимость ${money(batch.totalCost)}`, at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  if (!recipe.items.length) return <p className="py-3 text-sm text-text-secondary">Сначала заполните техкарту полуфабриката.</p>;

  return (
    <form className="space-y-3" onSubmit={submit}>
      <p className="text-sm text-text-secondary">Сырьё спишется со склада «{warehouse.name}». Готовый полуфабрикат поступит туда же.</p>
      <div className="grid grid-cols-2 gap-2">
        <Quantity label="Количество готового продукта" value={quantity} onChange={setQuantity} />
        <Field label="Единица измерения">
          <Select ariaLabel="Единица измерения" className="h-10 w-full" value={unit} options={unitsForType(recipe.unitType)}
            onChange={(value) => setUnit(value as UnitCode)} />
        </Field>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary btn-md w-full" disabled={!isPositive(quantity) || produce.isPending}>Приготовить партию</button>
    </form>
  );
}

function isPositive(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function ingredientUnits(ingredient: Ingredient | undefined, unit: UnitCode | '') {
  return ingredient ? unitsForType(ingredient.unitType) : UNIT_OPTIONS.filter((option) => option.value === unit);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-text-secondary">{label}</div>
      {children}
    </div>
  );
}

function Quantity({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-medium text-text-secondary">
      {label}
      <input className="input mt-1 h-10 w-full text-sm" type="number" min="0" step="any" value={value}
        onChange={(event) => onChange(event.target.value)} required />
    </label>
  );
}
