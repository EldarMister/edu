import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { EditorPage } from './EditorPage';
import { ItemCard } from './ItemCard';
import { DocumentProductPicker } from './DocumentProductPicker';
import { useEditorRoute } from './workspace-route';
import { useWarehousePolicy } from './settings-api';
import { useSavePreparationCard, type PreparationCard } from './preparation-card-api';
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
import { DocumentField, DocumentFooter, QueryState } from './WarehouseUi';
import { UNIT_OPTIONS, unitLabel, unitTypeOf, unitsForType, type UnitCode } from './units';

type PreparationAction = {
  kind: 'recipe' | 'produce';
  id: string;
  name: string;
};

export function PreparationModal({
  action,
  warehouse,
  onClose,
  onBatch,
}: {
  action: PreparationAction;
  onEditItem?: () => void;
  warehouse: WarehouseLocation;
  onClose: () => void;
  onBatch?: (id: string) => void;
}) {
  if (action.kind === 'recipe')
    return <PreparationCardPage id={action.id} warehouseId={warehouse.id} onClose={onClose} />;
  return (
    <ProductionPage
      id={action.id}
      name={action.name}
      warehouse={warehouse}
      onClose={onClose}
      onBatch={onBatch}
    />
  );
}

export function PreparationCardPage({
  id,
  warehouseId,
  onClose,
}: {
  id?: string;
  warehouseId?: string;
  onClose: () => void;
}) {
  if (id) return <ExistingPreparation id={id} warehouseId={warehouseId} onClose={onClose} />;
  const empty: PreparationCard = {
    id: '',
    name: '',
    displayUnit: 'kg',
    unitType: 'mass',
    mode: 'virtual',
    outputQuantity: 1,
    outputUnit: 'kg',
    items: [],
  };
  return (
    <EditorPage title="Добавление полуфабриката" onClose={onClose}>
      <RecipeForm recipe={empty} onClose={onClose} />
    </EditorPage>
  );
}

function ExistingPreparation({
  id,
  warehouseId,
  onClose,
}: {
  id: string;
  warehouseId?: string;
  onClose: () => void;
}) {
  const query = usePreparationRecipe(id, warehouseId);
  return (
    <EditorPage title="Редактирование полуфабриката" onClose={onClose}>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && <RecipeForm key={id} recipe={query.data} onClose={onClose} />}
      </QueryState>
    </EditorPage>
  );
}

function ProductionPage({
  id,
  name,
  warehouse,
  onClose,
  onBatch,
}: {
  id: string;
  name: string;
  warehouse: WarehouseLocation;
  onClose: () => void;
  onBatch?: (id: string) => void;
}) {
  const query = usePreparationRecipe(id, warehouse.id);
  return (
    <EditorPage title={`Производство · ${query.data?.name ?? name}`} onClose={onClose}>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <BatchForm recipe={query.data} warehouse={warehouse} onClose={onClose} onBatch={onBatch} />
        )}
      </QueryState>
    </EditorPage>
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
const blankRow = (): RecipeDraft => ({
  key: crypto.randomUUID(),
  ingredientId: '',
  quantity: '',
  unit: '',
  netAmount: '',
  lossPercent: '0',
  processingMethod: '',
});
const unitFactor = (unit: UnitCode) => (unit === 'kg' || unit === 'l' ? 1000 : 1);

function RecipeForm({ recipe, onClose }: { recipe: PreparationCard; onClose: () => void }) {
  const formId = useId();
  const ingredients = useIngredients('');
  const save = useSavePreparationCard();
  const { can } = usePermissions();
  const editable = can('actions.warehouseRecipes');
  const costs = can('actions.warehouseCosts');
  const policy = useWarehousePolicy();
  const production =
    policy.data?.warehouseProductionEnabled || policy.data?.productionInUse || recipe.mode === 'stocked';
  const [expectedUpdatedAt] = useState(recipe.updatedAt);
  const [name, setName] = useState(recipe.name);
  const [category, setCategory] = useState(recipe.category ?? '');
  const [unit, setUnit] = useState(recipe.displayUnit);
  const [mode, setMode] = useState(recipe.mode ?? 'virtual');
  const [instructions, setInstructions] = useState(recipe.instructions ?? '');
  const push = useNotifications((state) => state.push);
  const [outputQuantity, setOutputQuantity] = useState(String(recipe.outputQuantity));
  const [outputUnit, setOutputUnit] = useState(recipe.outputUnit);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [quickIngredient, setQuickIngredient] = useState(false);
  const [rows, setRows] = useState<RecipeDraft[]>(() =>
    recipe.items.length
      ? recipe.items.map((item) => ({
          key: item.ingredientId,
          ingredientId: item.ingredientId,
          quantity: String(item.quantity),
          unit: item.unit,
          netAmount: String(item.netAmount ?? item.quantity),
          lossPercent: String(item.lossPercent ?? 0),
          processingMethod: item.processingMethod ?? '',
        }))
      : [],
  );
  const [error, setError] = useState('');
  const options = ingredients.data?.filter((item) => item.id !== recipe.id) ?? [];
  const byId = new Map(options.map((item) => [item.id, item]));
  const savedItems = new Map(recipe.items.map((item) => [item.ingredientId, item]));
  const selected = new Set(rows.map((row) => row.ingredientId));
  const canSave =
    name.trim() &&
    isPositive(outputQuantity) &&
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.ingredientId &&
        row.unit &&
        isPositive(row.quantity) &&
        Number.isFinite(Number(row.netAmount)) &&
        Number(row.netAmount) >= 0 &&
        Number(row.netAmount) <= Number(row.quantity),
    );
  function rowCost(row: RecipeDraft) {
    const ingredient = byId.get(row.ingredientId);
    if (!ingredient || !row.unit || !isPositive(row.quantity)) return null;
    if (ingredient.preparationMode === 'virtual' && ingredient.isPrepared) {
      if (ingredient.recipeUnitCost != null)
        return (
          (ingredient.recipeUnitCost * Number(row.quantity) * unitFactor(row.unit)) /
          unitFactor(ingredient.displayUnit)
        );
      const saved = savedItems.get(row.ingredientId) as
        | (PreparationRecipe['items'][number] & { lineCost?: number | null })
        | undefined;
      return saved?.lineCost == null
        ? null
        : (saved.lineCost * Number(row.quantity) * unitFactor(row.unit)) /
            (saved.quantity * unitFactor(saved.unit));
    }
    return ingredient.avgCostBase == null
      ? null
      : ingredient.avgCostBase * Number(row.quantity) * unitFactor(row.unit);
  }
  const rowCosts = rows.map(rowCost);
  const totalCost =
    rowCosts.length > 0 && rowCosts.every((cost) => cost != null)
      ? rowCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
      : null;
  function update(key: string, patch: Partial<RecipeDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || save.isPending || !editable) return;
    setError('');
    try {
      await save.mutateAsync({
        id: recipe.id || undefined,
        expectedUpdatedAt,
        name: name.trim(),
        category: category.trim() || null,
        unit,
        requestKey,
        outputQuantity: Number(outputQuantity),
        outputUnit,
        mode,
        instructions,
        items: rows.map(
          ({ ingredientId, quantity, unit: rowUnit, netAmount, lossPercent, processingMethod }) => ({
            ingredientId,
            quantity: Number(quantity),
            unit: rowUnit as UnitCode,
            netAmount: Number(netAmount),
            lossPercent: Number(lossPercent),
            processingMethod: processingMethod || null,
          }),
        ),
      });
      push({ message: 'Полуфабрикат сохранён', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <>
      <form id={formId} className="poster-form poster-form--preparation" onSubmit={submit}>
        <fieldset disabled={!editable} className="space-y-4">
          <DocumentField label="Название">
            <input
              aria-label="Название"
              className="input w-full"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </DocumentField>
          <DocumentField label="Процесс приготовления">
            <textarea
              aria-label="Процесс приготовления"
              className="input h-12 w-full resize-y"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </DocumentField>
        </fieldset>
        <fieldset disabled={!editable} className="poster-recipe-panel mt-6">
          <h3>Состав</h3>
          <div className="overflow-x-auto">
            <table className="poster-table poster-recipe-table w-full min-w-[840px]">
              <thead>
                <tr>
                  <th className="w-[28%]">Продукты</th>
                  <th className="w-[23%]">Метод приготовления</th>
                  <th>Брутто</th>
                  <th>Нетто</th>
                  {costs && <th className="text-right">Себестоимость</th>}
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const ingredient = byId.get(row.ingredientId);
                  const choices = options.filter(({ id }) => id === row.ingredientId || !selected.has(id));
                  return (
                    <tr key={row.key}>
                      <td>
                        <DocumentProductPicker
                          label={`Ингредиент ${index + 1}`}
                          value={row.ingredientId}
                          options={choices}
                          fallbackName={
                            savedItems.get(row.ingredientId)?.name ??
                            (row.ingredientId ? 'Недоступный ингредиент' : undefined)
                          }
                          disabled={!editable || ingredients.isPending}
                          onChange={(ingredientId) => {
                            if (ingredientId === row.ingredientId) return;
                            update(row.key, {
                              ingredientId,
                              unit: byId.get(ingredientId)?.displayUnit ?? '',
                              processingMethod: '',
                              lossPercent: '0',
                              netAmount: row.quantity,
                            });
                          }}
                        />
                      </td>
                      <td>
                        <Select
                          ariaLabel={`Обработка ${index + 1}`}
                          className="h-9 w-full"
                          value={row.processingMethod}
                          disabled={!row.ingredientId}
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
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <input
                            aria-label={`Брутто ${index + 1}`}
                            className="input h-9 w-[88px]"
                            type="number"
                            min="0.000001"
                            step="any"
                            value={row.quantity}
                            disabled={!row.ingredientId}
                            required
                            onChange={(e) =>
                              update(row.key, {
                                quantity: e.target.value,
                                netAmount: String(
                                  Number(e.target.value) * (1 - Number(row.lossPercent) / 100),
                                ),
                              })
                            }
                          />
                          <select
                            aria-label={`Единица ${index + 1}`}
                            className="poster-unit-select"
                            value={row.unit}
                            disabled={!row.ingredientId}
                            onChange={(e) => {
                              const next = e.target.value as UnitCode,
                                factor = row.unit ? unitFactor(row.unit) / unitFactor(next) : 1;
                              update(row.key, {
                                unit: next,
                                quantity: row.quantity ? String(Number(row.quantity) * factor) : '',
                                netAmount: row.netAmount ? String(Number(row.netAmount) * factor) : '',
                              });
                            }}
                          >
                            {ingredientUnits(ingredient, row.unit).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <input
                            aria-label={`Нетто ${index + 1}`}
                            className="input h-9 w-[88px]"
                            type="number"
                            min="0"
                            max={row.quantity || undefined}
                            step="any"
                            value={row.netAmount}
                            disabled={!row.ingredientId}
                            required
                            onChange={(e) =>
                              update(row.key, {
                                netAmount: e.target.value,
                                lossPercent: String(
                                  Number(row.quantity) > 0
                                    ? (1 - Number(e.target.value) / Number(row.quantity)) * 100
                                    : 0,
                                ),
                              })
                            }
                          />
                          <span className="text-xs">{row.unit ? unitLabel(row.unit) : ''}</span>
                        </div>
                      </td>
                      {costs && (
                        <td className="text-right whitespace-nowrap">{costLabel(rowCosts[index])}</td>
                      )}
                      <td>
                        <button
                          type="button"
                          aria-label={`Удалить ингредиент ${index + 1}`}
                          className="poster-remove"
                          onClick={() => setRows((current) => current.filter(({ key }) => key !== row.key))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    {editable && (
                      <div className="poster-row-actions flex-wrap">
                        <button
                          type="button"
                          disabled={ingredients.isPending}
                          onClick={() => setRows((current) => [...current, blankRow()])}
                        >
                          Добавить ингредиент
                        </button>
                        {can('actions.warehouseReceive') && (
                          <button type="button" onClick={() => setQuickIngredient(true)}>
                            Создать ингредиент
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td colSpan={2}>
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <span>Выход:</span>
                      <input
                        aria-label="Выход полуфабриката"
                        className="input h-9 w-[88px]"
                        type="number"
                        min="0.000001"
                        step="any"
                        value={outputQuantity}
                        onChange={(e) => setOutputQuantity(e.target.value)}
                        required
                      />
                      <select
                        aria-label="Единица выхода"
                        className="poster-unit-select"
                        value={outputUnit}
                        onChange={(e) => {
                          const next = e.target.value as UnitCode;
                          if (unitTypeOf(next) === unitTypeOf(outputUnit))
                            setOutputQuantity(
                              String((Number(outputQuantity) * unitFactor(outputUnit)) / unitFactor(next)),
                            );
                          setOutputUnit(next);
                          if (!recipe.id) setUnit(next);
                        }}
                      >
                        {(recipe.id ? unitsForType(recipe.unitType) : UNIT_OPTIONS).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  {costs && (
                    <td className="text-right font-medium whitespace-nowrap">{costLabel(totalCost)}</td>
                  )}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </fieldset>
        <fieldset disabled={!editable}>
          <details className="poster-advanced mt-5">
            <summary>Дополнительно</summary>
            <div className="space-y-4 pt-5">
              <DocumentField label="Категория">
                <input
                  aria-label="Категория"
                  className="input w-full"
                  value={category}
                  maxLength={120}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </DocumentField>
              {production && (
                <DocumentField label="Использование">
                  <Select
                    ariaLabel="Использование полуфабриката"
                    className="h-10 w-full"
                    value={mode}
                    onChange={(value) => setMode(value as typeof mode)}
                    options={[
                      { value: 'virtual', label: 'Списывать состав при продаже' },
                      { value: 'stocked', label: 'Производить и хранить на складе' },
                    ]}
                  />
                </DocumentField>
              )}
            </div>
          </details>
        </fieldset>
        {(error || ingredients.isError) && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error || apiError(ingredients.error)}
          </p>
        )}
        {editable && (
          <DocumentFooter>
            <button
              type="submit"
              form={formId}
              className="btn-primary btn-md"
              disabled={!canSave || save.isPending}
            >
              {save.isPending ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button type="button" className="btn-ghost btn-md" onClick={onClose}>
              Отмена
            </button>
          </DocumentFooter>
        )}
      </form>
      {quickIngredient && (
        <ItemCard
          compact
          defaultKind="raw"
          onClose={() => setQuickIngredient(false)}
          onSaved={(item) =>
            setRows((current) => {
              const next = { ...blankRow(), ingredientId: item.id, unit: item.displayUnit };
              const empty = current.findIndex((row) => !row.ingredientId);
              return empty < 0
                ? [...current, next]
                : current.map((row, index) => (index === empty ? next : row));
            })
          }
        />
      )}
    </>
  );
}

function BatchForm({
  recipe,
  warehouse,
  onClose,
  onBatch,
}: {
  recipe: PreparationRecipe;
  warehouse: WarehouseLocation;
  onClose: () => void;
  onBatch?: (id: string) => void;
}) {
  const formId = useId();
  const { produce } = usePreparationMutations();
  const push = useNotifications((state) => state.push);
  const { can } = usePermissions();
  const [quantity, setQuantity] = useState(String(recipe.outputQuantity));
  const [planned, setPlanned] = useState('');
  const effectivePlanned = planned || quantity;
  const [unit, setUnit] = useState(recipe.outputUnit);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [number, setNumber] = useState('');
  const [expires, setExpires] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const { openEditor } = useEditorRoute();
  const history = useProductionBatches(recipe.id);
  const factor =
    ((Number(effectivePlanned) || 0) * (unit === 'kg' || unit === 'l' ? 1000 : 1)) /
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
        plannedQuantity: Number(effectivePlanned),
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
    <form id={formId} onSubmit={submit} className="space-y-4">
      <p className="text-sm text-text-secondary">
        Сырьё спишется со склада «{warehouse.name}», готовая партия поступит туда же.
      </p>
      <DocumentField label="Количество">
        <div className="flex gap-2">
          <input
            aria-label="Количество выпуска"
            className="input h-10 min-w-0 flex-1"
            type="number"
            min="0.000001"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Select
            ariaLabel="Единица выхода партии"
            className="h-10 w-28"
            value={unit}
            onChange={(v) => {
              const next = v as UnitCode,
                factor = unitFactor(unit) / unitFactor(next);
              setQuantity(quantity ? String(Number(quantity) * factor) : '');
              setPlanned(planned ? String(Number(planned) * factor) : '');
              setUnit(next);
            }}
            options={unitsForType(recipe.unitType)}
          />
        </div>
      </DocumentField>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Дополнительно</summary>
        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            Плановый выход (если отличается от фактического)
            <input
              aria-label="Плановый выход"
              className="input mt-1 block w-full"
              type="number"
              min="0.000001"
              step="any"
              placeholder={quantity}
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
            />
          </label>
          <p className="text-sm text-text-secondary">
            Отклонение: {qty(Number(quantity || 0) - Number(effectivePlanned || 0), unitLabel(unit))}
          </p>
          <h3 className="font-medium">Фактический расход сырья</h3>
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
      {!!history.data?.length && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm">История производства</summary>
          {history.data.map((batch) => (
            <button
              type="button"
              key={batch.id}
              className="flex w-full justify-between gap-2 border-t border-border py-2 text-left text-sm"
              onClick={() =>
                onBatch ? onBatch(batch.id) : openEditor({ type: 'productionBatch', id: batch.id })
              }
            >
              <span>
                {batch.batchNumber ?? 'Партия'} · {new Date(batch.producedAt).toLocaleString('ru-RU')}
              </span>
              <span>{qty(batch.actualQuantity, unitLabel(batch.unit))}</span>
            </button>
          ))}
        </details>
      )}
      <DocumentFooter total={`Выход: ${quantity} ${unitLabel(unit)}`}>
        <button
          type="submit"
          form={formId}
          className="btn-primary btn-md"
          disabled={
            !can('actions.warehouseProduce') ||
            produce.isPending ||
            !isPositive(quantity) ||
            !isPositive(effectivePlanned) ||
            Object.values(actual).some((v) => !isPositive(v))
          }
        >
          Провести производство
        </button>
        <button type="button" className="btn-ghost btn-md" onClick={onClose}>
          Отмена
        </button>
      </DocumentFooter>
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
    const reason = window.prompt('Причина отмены проведения производства');
    if (!reason?.trim()) return;
    try {
      await reverseBatch.mutateAsync({ id, reason: reason.trim() });
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <EditorPage
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
            <p className="rounded-lg bg-warning/10 p-3 text-sm">Проведение отменено: {batch.reverseReason}</p>
          )}
          {!batch.reversedAt && can('actions.warehouseApprove') && (
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={reverseBatch.isPending}
              onClick={() => void reverse()}
            >
              Отменить проведение
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
    </EditorPage>
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
