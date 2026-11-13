import { useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { costLabel } from './cost-format';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import {
  qty,
  PROCESSING_METHODS,
  type ProcessingMethod,
  useIngredients,
  usePreparationMutations,
  usePreparationRecipe,
  useProductionBatches,
  useProductionBatch,
  type Ingredient,
  type PreparationRecipe,
  type WarehouseLocation,
} from './api';
import { DocumentFooter } from './WarehouseUi';
import { UNIT_OPTIONS, unitLabel, unitsForType, type UnitCode } from './units';

type PreparationAction = { kind: 'recipe' | 'produce'; id: string; name: string };

export function PreparationModal({
  action,
  onEditItem,
  warehouse,
  onClose,
}: {
  action: PreparationAction;
  onEditItem?: () => void;
  warehouse: WarehouseLocation;
  onClose: () => void;
}) {
  const recipe = usePreparationRecipe(action.id, warehouse.id);
  const title = action.kind === 'recipe' ? `Техкарта · ${action.name}` : `Приготовить · ${action.name}`;
  return (
    <Modal open title={title} onClose={onClose} panelClassName="max-w-5xl">
      {onEditItem && (
        <button className="btn-secondary btn-md mb-4" onClick={onEditItem}>
          Название и свойства полуфабриката
        </button>
      )}
      {recipe.isPending && (
        <div className="flex justify-center py-8 text-primary">
          <Spinner />
        </div>
      )}
      {recipe.isError && (
        <p role="alert" className="text-sm text-danger">
          {apiError(recipe.error)}
        </p>
      )}
      {recipe.data && action.kind === 'recipe' && <RecipeForm recipe={recipe.data} onClose={onClose} />}
      {recipe.data && action.kind === 'produce' && (
        <BatchForm recipe={recipe.data} warehouse={warehouse} onClose={onClose} />
      )}
    </Modal>
  );
}

interface RecipeDraft {
  key: string;
  ingredientId: string;
  quantity: string;
  unit: UnitCode | '';
  netAmount: string;
  lossPercent: string;
  processingMethod: ProcessingMethod | '';
}

function RecipeForm({ recipe, onClose }: { recipe: PreparationRecipe; onClose: () => void }) {
  const ingredients = useIngredients('');
  const { saveRecipe } = usePreparationMutations();
  const { can } = usePermissions();
  const [mode, setMode] = useState(recipe.mode ?? 'stocked');
  const [instructions, setInstructions] = useState(recipe.instructions ?? '');
  const push = useNotifications((state) => state.push);
  const [outputQuantity, setOutputQuantity] = useState(String(recipe.outputQuantity));
  const [outputUnit, setOutputUnit] = useState(recipe.outputUnit);
  const [rows, setRows] = useState<RecipeDraft[]>(() =>
    recipe.items.map((item) => ({
      key: item.ingredientId,
      ingredientId: item.ingredientId,
      quantity: String(item.quantity),
      unit: item.unit,
      netAmount: String(item.netAmount ?? item.quantity),
      lossPercent: String(item.lossPercent ?? 0),
      processingMethod: item.processingMethod ?? '',
    })),
  );
  const [error, setError] = useState('');
  const options = ingredients.data?.filter((item) => item.id !== recipe.id) ?? [];
  const byId = new Map(options.map((item) => [item.id, item]));
  const recipeNames = new Map(recipe.items.map((item) => [item.ingredientId, item.name]));
  const selected = new Set(rows.map((row) => row.ingredientId));
  const canSave =
    isPositive(outputQuantity) &&
    rows.length > 0 &&
    rows.every((row) => row.ingredientId && row.unit && isPositive(row.quantity));

  function update(key: string, patch: Partial<RecipeDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || saveRecipe.isPending) return;
    setError('');
    try {
      await saveRecipe.mutateAsync({
        id: recipe.id,
        outputQuantity: Number(outputQuantity),
        outputUnit,
        mode,
        instructions,
        items: rows.map(({ ingredientId, quantity, unit, netAmount, lossPercent, processingMethod }) => ({
          ingredientId,
          quantity: Number(quantity),
          unit: unit as UnitCode,
          netAmount: Number(netAmount),
          lossPercent: Number(lossPercent),
          processingMethod: processingMethod || null,
        })),
      });
      push({ message: 'Техкарта сохранена', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label="Процесс приготовления">
        <textarea
          className="input min-h-20 w-full"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={!can('actions.warehouseRecipes')}
        />
      </Field>
      <Field label="Режим заготовки">
        <Select
          ariaLabel="Режим заготовки"
          className="h-10 w-full"
          value={mode}
          disabled={!can('actions.warehouseRecipes')}
          onChange={(v) => setMode(v as typeof mode)}
          options={[
            { value: 'stocked', label: 'Производство с отдельным остатком' },
            { value: 'virtual', label: 'Раскрывать состав при продаже' },
          ]}
        />
      </Field>
      {can('actions.warehouseCosts') && (
        <p className="text-sm">
          Себестоимость по текущим ценам: {costLabel(recipe.totalCost)}
          {recipe.missingCosts?.length ? ` · нет цены: ${recipe.missingCosts.join(', ')}` : ''}
        </p>
      )}
      <fieldset disabled={!can('actions.warehouseRecipes')} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Quantity label="Выход по техкарте" value={outputQuantity} onChange={setOutputQuantity} />
          <Field label="Единица выхода">
            <Select
              ariaLabel="Единица выхода"
              className="h-10 w-full"
              options={unitsForType(recipe.unitType)}
              value={outputUnit}
              onChange={(value) => setOutputUnit(value as UnitCode)}
            />
          </Field>
        </div>
        {rows.map((row) => {
          const ingredient = byId.get(row.ingredientId);
          const choices = options
            .filter(({ id }) => id === row.ingredientId || !selected.has(id))
            .map(({ id, name }) => ({ value: id, label: name }));
          if (row.ingredientId && !ingredient)
            choices.unshift({ value: row.ingredientId, label: recipeNames.get(row.ingredientId) ?? 'Товар' });
          return (
            <div
              className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 lg:grid-cols-[1.7fr_1fr_0.7fr_0.8fr_0.7fr_0.7fr_auto] sm:items-end"
              key={row.key}
            >
              <Field label="Товар">
                <Select
                  ariaLabel="Товар"
                  className="h-10 w-full"
                  value={row.ingredientId}
                  options={choices}
                  onChange={(ingredientId) =>
                    update(row.key, { ingredientId, unit: byId.get(ingredientId)?.displayUnit ?? '' })
                  }
                />
              </Field>
              <Field label="Обработка">
                <Select
                  ariaLabel="Способ обработки"
                  className="h-10 w-full"
                  value={row.processingMethod}
                  options={[{ value: '', label: 'Без обработки' }, ...PROCESSING_METHODS]}
                  onChange={(v) => {
                    const loss = v ? (ingredient?.processingLosses?.[v as ProcessingMethod] ?? 0) : 0;
                    update(row.key, {
                      processingMethod: v as ProcessingMethod | '',
                      lossPercent: String(loss),
                      netAmount: String(Number(row.quantity) * (1 - loss / 100)),
                    });
                  }}
                />
              </Field>
              <Quantity
                label="Брутто"
                value={row.quantity}
                onChange={(quantity) =>
                  update(row.key, {
                    quantity,
                    netAmount: String(Number(quantity) * (1 - Number(row.lossPercent) / 100)),
                  })
                }
              />
              <Field label="Единица">
                <Select
                  ariaLabel="Единица"
                  className="h-10 w-full"
                  value={row.unit}
                  options={ingredientUnits(ingredient, row.unit)}
                  disabled={!row.ingredientId}
                  onChange={(unit) => update(row.key, { unit: unit as UnitCode })}
                />
              </Field>
              <Quantity
                label="Нетто"
                value={row.netAmount}
                onChange={(netAmount) =>
                  update(row.key, {
                    netAmount,
                    lossPercent: String(
                      Number(row.quantity) > 0 ? (1 - Number(netAmount) / Number(row.quantity)) * 100 : 0,
                    ),
                  })
                }
              />
              <Quantity
                label="Потери, %"
                value={row.lossPercent}
                onChange={(lossPercent) =>
                  update(row.key, {
                    lossPercent,
                    netAmount: String(Number(row.quantity) * (1 - Number(lossPercent) / 100)),
                  })
                }
              />
              <button
                type="button"
                className="btn-secondary btn-md self-end"
                onClick={() => setRows((current) => current.filter(({ key }) => key !== row.key))}
              >
                Убрать
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="btn-secondary btn-md"
          disabled={ingredients.isPending || rows.length >= options.length}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                ingredientId: '',
                quantity: '',
                unit: '',
                netAmount: '',
                lossPercent: '0',
                processingMethod: '',
              },
            ])
          }
        >
          Добавить товары
        </button>
        {(error || ingredients.isError) && (
          <p role="alert" className="text-sm text-danger">
            {error || apiError(ingredients.error)}
          </p>
        )}
        {can('actions.warehouseRecipes') && (
          <DocumentFooter total={`Выход: ${outputQuantity} ${unitLabel(outputUnit)}`}>
            <button type="button" className="btn-secondary btn-md" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary btn-md" disabled={!canSave || saveRecipe.isPending}>
              Сохранить техкарту
            </button>
          </DocumentFooter>
        )}
      </fieldset>
    </form>
  );
}

function BatchForm({
  recipe,
  warehouse,
  onClose,
}: {
  recipe: PreparationRecipe;
  warehouse: WarehouseLocation;
  onClose: () => void;
}) {
  const { produce } = usePreparationMutations();
  const push = useNotifications((state) => state.push);
  const { can } = usePermissions();
  const [quantity, setQuantity] = useState(String(recipe.outputQuantity));
  const [planned, setPlanned] = useState(String(recipe.outputQuantity));
  const [unit, setUnit] = useState(recipe.outputUnit);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [number, setNumber] = useState('');
  const [expires, setExpires] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [batchId, setBatchId] = useState<string>();
  const history = useProductionBatches(recipe.id);
  const factor =
    ((Number(planned) || 0) * (unit === 'kg' || unit === 'l' ? 1000 : 1)) /
    (recipe.outputQuantity * (recipe.outputUnit === 'kg' || recipe.outputUnit === 'l' ? 1000 : 1));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (produce.isPending || !can('actions.warehouseProduce')) return;
    setError('');
    try {
      const batch = await produce.mutateAsync({
        id: recipe.id,
        warehouseId: warehouse.id,
        quantity: Number(quantity),
        plannedQuantity: Number(planned),
        unit,
        requestKey,
        batchNumber: number.trim() || undefined,
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
        items: Object.keys(actual).length
          ? recipe.items.map((item) => ({
              ingredientId: item.ingredientId,
              quantity: Number(actual[item.ingredientId] ?? item.quantity * factor),
              unit: item.unit,
            }))
          : undefined,
      });
      push({
        message: can('actions.warehouseCosts')
          ? `Партия готова · себестоимость ${costLabel(batch.totalCost)}`
          : 'Партия готова',
        at: new Date().toISOString(),
      });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  if (!recipe.items.length)
    return (
      <p className="text-sm text-text-secondary">Сначала заполните рецептуру заготовки в её карточке.</p>
    );
  if (recipe.mode === 'virtual')
    return (
      <p className="text-sm text-text-secondary">
        Эта заготовка раскрывается по рецепту при продаже. Для отдельного производства выберите режим с
        остатком в карточке товара.
      </p>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-text-secondary">
        Сырьё спишется со склада «{warehouse.name}», готовая партия поступит туда же.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Quantity label="Плановый выход" value={planned} onChange={setPlanned} />
        <Quantity label="Фактический выход" value={quantity} onChange={setQuantity} />
      </div>
      <Field label="Единица выхода">
        <Select
          ariaLabel="Единица выхода партии"
          className="h-10 w-full"
          value={unit}
          onChange={(v) => setUnit(v as UnitCode)}
          options={unitsForType(recipe.unitType)}
        />
      </Field>
      <p className="text-sm text-text-secondary">
        Отклонение выхода: {qty(Number(quantity || 0) - Number(planned || 0), unitLabel(unit))}
      </p>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Фактический расход сырья и партия</summary>
        <div className="mt-3 space-y-3">
          {recipe.items.map((item) => (
            <Quantity
              key={item.ingredientId}
              label={`${item.name}, ${unitLabel(item.unit)} · по норме ${Number((item.quantity * factor).toFixed(3))}`}
              value={actual[item.ingredientId] ?? String(Number((item.quantity * factor).toFixed(3)))}
              onChange={(v) => setActual((current) => ({ ...current, [item.ingredientId]: v }))}
            />
          ))}
          <Field label="Номер партии">
            <input className="input w-full" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field label="Годен до">
            <input
              className="input w-full"
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="btn-primary btn-lg w-full"
        disabled={
          !can('actions.warehouseProduce') ||
          produce.isPending ||
          !isPositive(quantity) ||
          !isPositive(planned) ||
          Object.values(actual).some((v) => !isPositive(v))
        }
      >
        Провести производство
      </button>
      {!!history.data?.length && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm">История производства</summary>
          {history.data.map((batch) => (
            <button
              type="button"
              key={batch.id}
              className="flex w-full justify-between gap-2 border-t border-border py-2 text-left text-sm"
              onClick={() => setBatchId(batch.id)}
            >
              <span>
                {batch.batchNumber ?? 'Партия'} · {new Date(batch.producedAt).toLocaleString('ru-RU')}
              </span>
              <span>{qty(batch.actualQuantity, unitLabel(batch.unit))}</span>
            </button>
          ))}
        </details>
      )}
      {batchId && <ProductionBatchModal id={batchId} onClose={() => setBatchId(undefined)} />}
    </form>
  );
}

export function ProductionBatchModal({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useProductionBatch(id);
  const batch = query.data;
  const { can } = usePermissions();
  const { reverseBatch } = usePreparationMutations();
  const [error, setError] = useState('');
  async function reverse() {
    const reason = window.prompt('Причина сторнирования производства');
    if (!reason?.trim()) return;
    try {
      await reverseBatch.mutateAsync({ id, reason: reason.trim() });
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <Modal
      open
      title={batch ? `Производство · ${batch.ingredientName}` : 'Производственная партия'}
      onClose={onClose}
      panelClassName="max-w-xl"
    >
      {query.isPending && (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}
      {query.isError && (
        <p role="alert" className="text-danger">
          {apiError(query.error)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {batch && (
        <div className="space-y-3">
          {batch.reversedAt && (
            <p className="rounded-lg bg-warning/10 p-3 text-sm">Сторнировано: {batch.reverseReason}</p>
          )}
          {!batch.reversedAt && can('actions.warehouseApprove') && (
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={reverseBatch.isPending}
              onClick={() => void reverse()}
            >
              Сторнировать производство
            </button>
          )}
          <p className="text-sm text-text-secondary">
            {batch.batchNumber ?? batch.id} · {new Date(batch.producedAt).toLocaleString('ru-RU')}
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <p>План: {qty(batch.plannedQuantity, unitLabel(batch.unit))}</p>
            <p>Факт: {qty(batch.actualQuantity, unitLabel(batch.unit))}</p>
            <p>Отклонение: {qty(batch.yieldDifference, unitLabel(batch.unit))}</p>
            {can('actions.warehouseCosts') && <p>Себестоимость: {costLabel(batch.totalCost)}</p>}
          </div>
          {batch.expiresAt && (
            <p className="text-sm">Годен до {new Date(batch.expiresAt).toLocaleString('ru-RU')}</p>
          )}
          <h4 className="font-semibold">Фактически использовано</h4>
          {batch.items.actual.map((item) => (
            <div
              key={item.ingredientId}
              className="flex justify-between gap-2 border-t border-border py-2 text-sm"
            >
              <span>{item.name}</span>
              <span>
                {qty(item.quantity, unitLabel(item.unit))}
                {can('actions.warehouseCosts')
                  ? ` · ${costLabel(item.cost == null ? null : Number(item.cost))}`
                  : ''}
              </span>
            </div>
          ))}
          <button type="button" className="btn-secondary btn-md" onClick={() => window.print()}>
            Печать
          </button>
        </div>
      )}
    </Modal>
  );
}

function isPositive(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function ingredientUnits(ingredient: Ingredient | undefined, unit: UnitCode | '') {
  return ingredient
    ? unitsForType(ingredient.unitType)
    : UNIT_OPTIONS.filter((option) => option.value === unit);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-text-secondary">{label}</div>
      {children}
    </div>
  );
}

function Quantity({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-text-secondary">
      {label}
      <input
        className="input mt-1 h-10 w-full text-sm"
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </label>
  );
}
