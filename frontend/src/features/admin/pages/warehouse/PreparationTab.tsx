import { IconPrinter } from '@/features/admin/components/icons';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { EditorPage, useEditorDirty } from './EditorPage';
import { ItemCard } from './ItemCard';
import { DocumentProductPicker } from './DocumentProductPicker';
import { useEditorRoute } from './workspace-route';
import { useWarehousePolicy } from './settings-api';
import { useSavePreparationCard, type PreparationCard } from './preparation-card-api';
import { Select } from '@/components/Select';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { costLabel } from './cost-format';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import {
  qty,
  type ProcessingBasis,
  type ProcessingMethod,
  type ProcessingStage,
  type RecipeProcessing,
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
import { inventoryTimeDisplay, inventoryTimeIso } from './inventory-time';
import { displayedProcessingStages, lossFromAmounts, pieceNetWeight, preparationYieldBase, processingQuantities,
  processingRetention, recipeQuantity, stockWriteoffQuantity, supportsProcessing, validRecipeRows } from './recipe-draft-values';
import { useRecipePreview } from './recipe-preview-api';
import { RecipeProcessingFields, recipeProcessingLabel } from './RecipeProcessingFields';
import { QuantityInput, VolumeNetFields } from './RecipeQuantityInput';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { PreparationPrintButton } from './PreparationPrintButton';
import { PreparationCost } from './PreparationCost';

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
  onProduced,
}: {
  action: PreparationAction;
  onEditItem?: () => void;
  warehouse: WarehouseLocation;
  onClose: () => void;
  onBatch?: (id: string) => void;
  onProduced?: (id: string) => void;
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
      onProduced={onProduced}
    />
  );
}

export function PreparationCardPage({
  id,
  copy = false,
  warehouseId,
  onClose,
}: {
  id?: string;
  copy?: boolean;
  warehouseId?: string;
  onClose: () => void;
}) {
  if (id) return <ExistingPreparation id={id} copy={copy} warehouseId={warehouseId} onClose={onClose} />;
  const empty: PreparationCard = {
    id: '',
    name: '',
    displayUnit: 'kg',
    unitType: 'mass',
    kind: 'preparation',
    mode: 'virtual',
    outputQuantity: 0,
    outputUnit: 'g',
    items: [],
  };
  return (
    <EditorPage title="Добавление полуфабриката" onClose={onClose}>
      <RecipeForm recipe={empty} warehouseId={warehouseId} onClose={onClose} />
    </EditorPage>
  );
}

function ExistingPreparation({
  id,
  copy,
  warehouseId,
  onClose,
}: {
  id: string;
  copy: boolean;
  warehouseId?: string;
  onClose: () => void;
}) {
  const query = usePreparationRecipe(id, warehouseId);
  const editable = usePermissions().can('actions.warehouseRecipes');
  const readyDish = query.data?.kind === 'prepared_dish';
  const title = editable
    ? readyDish ? 'Редактирование готового блюда' : 'Редактирование полуфабриката'
    : readyDish ? 'Готовое блюдо' : 'Полуфабрикат';
  return (
    <EditorPage title={copy ? 'Копирование полуфабриката' : title} onClose={onClose}>
      {query.data && !copy && <WorkspaceHeaderActions>
        <PreparationPrintButton recipe={query.data} />
      </WorkspaceHeaderActions>}
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && <RecipeForm key={id + String(copy)} recipe={query.data} copy={copy} warehouseId={warehouseId} onClose={onClose} />}
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
  onProduced,
}: {
  id: string;
  name: string;
  warehouse: WarehouseLocation;
  onClose: () => void;
  onBatch?: (id: string) => void;
  onProduced?: (id: string) => void;
}) {
  const query = usePreparationRecipe(id, warehouse.id);
  return (
    <EditorPage title={`Производство · ${query.data?.name ?? name}`} onClose={onClose}>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <BatchForm recipe={query.data} warehouse={warehouse} onClose={onClose} onBatch={onBatch} onProduced={onProduced} />
        )}
      </QueryState>
    </EditorPage>
  );
}

interface RecipeDraft extends RecipeProcessing {
  key: string;
  ingredientId: string;
  quantity: string;
  unit: UnitCode | '';
  netAmount: string;
  measuredNetWeightGrams?: number | null;
  volumeNetEdited?: boolean;
  linkVolumeGrams?: boolean;
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
const recipeWeight = (amount: number) => String(Number(amount.toFixed(6)));

function RecipeForm({ recipe, copy = false, warehouseId, onClose }: { recipe: PreparationCard; copy?: boolean; warehouseId?: string; onClose: () => void }) {
  const formId = useId();
  const focusNewRow = useRef<string | null>(null);
  const submitting = useRef(false);
  const ingredients = useIngredients('', warehouseId);
  const save = useSavePreparationCard();
  const { can } = usePermissions();
  const editable = can('actions.warehouseRecipes');
  const costs = can('actions.warehouseCosts');
  const policy = useWarehousePolicy();
  const production =
    policy.data?.warehouseProductionEnabled || policy.data?.productionInUse || recipe.mode === 'stocked';
  const [expectedUpdatedAt] = useState(recipe.updatedAt);
  const [name, setName] = useState(copy ? `${recipe.name} (копия)` : recipe.name);
  const [kind, setKind] = useState(recipe.kind ?? 'preparation');
  const [category, setCategory] = useState(recipe.category ?? '');
  const [mode, setMode] = useState(recipe.mode ?? 'virtual');
  const [instructions, setInstructions] = useState(recipe.instructions ?? '');
  const push = useNotifications((state) => state.push);
  const [enteredOutput, setEnteredOutput] = useState<string | null | undefined>();
  const [outputUnit, setOutputUnit] = useState(recipe.outputUnit);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [quickIngredient, setQuickIngredient] = useState<{ key: string; name: string } | null>(null);
  const [replacingIngredient, setReplacingIngredient] = useState<string | null>(null);
  const [processingRow, setProcessingRow] = useState<string | null>(null);
  const [rows, setRows] = useState<RecipeDraft[]>(() =>
    recipe.items.length
      ? recipe.items.map((item) => ({
          key: item.ingredientId,
          ingredientId: item.ingredientId,
          quantity: String(item.quantity),
          unit: item.unit,
          netAmount: recipeWeight(item.netAmount ?? item.quantity * (1 - (item.lossPercent ?? 0) / 100)),
          measuredNetWeightGrams: item.measuredNetWeightGrams,
          linkVolumeGrams: unitTypeOf(item.unit) === 'volume' && item.measuredNetWeightGrams === Number((item.quantity * unitFactor(item.unit)).toFixed(3)),
          lossPercent: String(item.lossPercent ?? 0),
          processingMethod: item.processingMethod ?? '',
          processingBasis: item.processingBasis,
          processingStages: item.processingStages?.length ? item.processingStages : undefined,
        }))
      : [],
  );
  const [error, setError] = useState('');
  const snapshot = JSON.stringify([name, kind, category, mode, instructions, enteredOutput, outputUnit, rows]);
  const [initialSnapshot] = useState(snapshot);
  const { markSaved } = useEditorDirty(editable && (snapshot !== initialSnapshot || save.isPending));
  const options = ingredients.data?.filter((item) => item.id !== recipe.id) ?? [];
  const byId = new Map(options.map((item) => [item.id, item]));
  const savedItems = new Map(recipe.items.map((item) => [item.ingredientId, item]));
  // A saved measured yield can differ from the sum of its ingredients.
  const originalNet = preparationYieldBase(recipe.unitType, recipe.items
    .filter((item) => byId.get(item.ingredientId)?.kind !== 'consumable')
    .map((item) => ({ unitType: unitTypeOf(item.unit), unitFactor: unitFactor(item.unit),
      netAmount: item.netAmount ?? item.quantity * (1 - (item.lossPercent ?? 0) / 100),
      measuredNetWeightGrams: item.netWeightGrams })));
  const savedManualOutput = recipe.id && (originalNet === null || Math.abs(originalNet - recipe.outputQuantity * unitFactor(recipe.outputUnit)) > 0.0005)
    ? recipeWeight(recipe.outputQuantity * unitFactor(recipe.outputUnit) / unitFactor(outputUnit)) : null;
  const selected = new Set(rows.map((row) => row.ingredientId));
  const yieldRows = rows.filter((row) => byId.get(row.ingredientId)?.kind !== 'consumable');
  const netBase = preparationYieldBase(unitTypeOf(outputUnit), yieldRows.map((row) => ({
    unitType: row.unit ? unitTypeOf(row.unit) : null,
    unitFactor: row.unit ? unitFactor(row.unit) : 1,
    netAmount: row.netAmount === '' ? null : Number(row.netAmount),
    pieceWeightGrams: byId.get(row.ingredientId)?.pieceWeightGrams,
    measuredNetWeightGrams: row.measuredNetWeightGrams,
  })));
  const requiresMeasuredYield = netBase === null && yieldRows.every(({ unit, netAmount }) => !!unit && netAmount !== '');
  const fixedOutput = enteredOutput === undefined ? savedManualOutput : enteredOutput;
  const outputQuantity = fixedOutput ?? (netBase != null && netBase > 0 ? recipeWeight(netBase / unitFactor(outputUnit)) : '');
  const canSave =
    name.trim() &&
    isPositive(outputQuantity) &&
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.ingredientId &&
        row.unit &&
        isPositive(row.quantity) &&
        row.netAmount !== '' && validRecipeRows([{
          ingredientId: row.ingredientId, unit: row.unit, unitType: unitTypeOf(row.unit), name: '',
          amount: Number(row.quantity), netAmount: Number(row.netAmount), lossPercent: Number(row.lossPercent),
          measuredNetWeightGrams: row.measuredNetWeightGrams,
          processingStages: row.processingStages, processingBasis: row.processingBasis,
        }]),
    );
  const virtualRows = rows.flatMap((row) => {
    const item = byId.get(row.ingredientId);
    return item?.isActive && item.isPrepared && item.preparationMode === 'virtual' && row.unit && isPositive(row.quantity)
      ? [{ ingredientId: item.id, unit: row.unit, amount: Number(row.quantity), warehouseId }] : [];
  });
  const virtualPreview = useRecipePreview(costs && virtualRows.length ? { categoryId: '__main_screen__', items: virtualRows } : null);
  const virtualById = new Map(virtualPreview.data?.items.map((item) => [item.ingredientId, item]));
  function savedCost(row: RecipeDraft) {
    const saved = savedItems.get(row.ingredientId);
    return saved && row.unit && saved.quantity * unitFactor(saved.unit) === Number(row.quantity) * unitFactor(row.unit)
      ? saved : undefined;
  }
  function rowCost(row: RecipeDraft) {
    const ingredient = byId.get(row.ingredientId);
    if (!ingredient || !row.unit || !isPositive(row.quantity)) return null;
    if (ingredient.preparationMode === 'virtual' && ingredient.isPrepared) {
      const calculated = virtualById.get(ingredient.id);
      return calculated ? calculated.lineCostForScaling ?? calculated.lineCost : savedCost(row)?.lineCost ?? null;
    }
    return ingredient.avgCostBase == null
      ? null
      : ingredient.avgCostBase * stockWriteoffQuantity(Number(row.quantity), row.unit, ingredient.roundPieceWriteoff) * unitFactor(row.unit);
  }
  const rowCosts = rows.map(rowCost);
  const knownCosts = rows.map((row, index) => {
    if (rowCosts[index] != null) return rowCosts[index]!;
    return virtualById.get(row.ingredientId)?.knownLineCost ?? savedCost(row)?.knownLineCost ?? 0;
  });
  const totalCost =
    rowCosts.length > 0 && rowCosts.every((cost) => cost != null)
      ? rowCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
      : null;
  function update(key: string, patch: Partial<RecipeDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || save.isPending || submitting.current || !editable) return;
    submitting.current = true;
    setError('');
    try {
      await save.mutateAsync({
        id: copy ? undefined : recipe.id || undefined,
        expectedUpdatedAt: copy ? undefined : expectedUpdatedAt,
        name: name.trim(),
        category: category.trim() || null,
        unit: recipe.displayUnit,
        ...(!recipe.id || copy ? { kind } : {}),
        requestKey,
        outputQuantity: Number(outputQuantity),
        outputUnit,
        mode,
        instructions,
        items: rows.map(({ ingredientId, quantity, unit: rowUnit, netAmount, measuredNetWeightGrams, volumeNetEdited,
          lossPercent, processingMethod, processingStages, processingBasis }) => {
          const unit = rowUnit as UnitCode;
          const prior = savedItems.get(ingredientId);
          const unitType = unitTypeOf(unit);
          const pieces = unitType === 'count';
          const preserveSavedNet = pieces && (!prior || prior.netAmount == null || Number(quantity) !== prior.quantity);
          const implicitVolume = unitType === 'volume' && prior?.netAmount == null && !volumeNetEdited;
          return { ingredientId, quantity: Number(quantity), unit, processingStages, processingBasis,
            netAmount: preserveSavedNet || implicitVolume || processingBasis === 'gross' ? undefined : Number(netAmount),
            ...(unitType !== 'mass' && { measuredNetWeightGrams }),
            lossPercent: processingStages?.length ? undefined : Number(lossPercent),
            processingMethod: processingStages?.length ? undefined : processingMethod || null };
        }),
      });
      push({ message: kind === 'prepared_dish' ? 'Готовое блюдо сохранено' : 'Полуфабрикат сохранён', at: new Date().toISOString() });
      markSaved();
      onClose();
    } catch (err) {
      setError(apiError(err));
    } finally {
      submitting.current = false;
    }
  }
  return (
    <>
      <form id={formId} className="poster-form poster-form--preparation" onSubmit={submit}>
        <fieldset disabled={!editable || save.isPending} className="space-y-4">
          {!recipe.id && production && <DocumentField label="Тип">
            <Select ariaLabel="Тип продукции" value={kind} onChange={(value) => {
              setKind(value as typeof kind);
              if (value === 'prepared_dish') setMode('stocked');
            }} options={[{ value: 'preparation', label: 'Полуфабрикат' }, { value: 'prepared_dish', label: 'Готовое блюдо' }]} />
          </DocumentField>}
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
        <fieldset disabled={!editable || save.isPending} className="poster-recipe-panel mt-6">
          <h3>Состав</h3>
          <div className="overflow-x-auto">
            <table className="poster-table poster-recipe-table preparation-composition w-full min-w-[840px]">
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
                  const unitType = ingredient?.unitType ?? (row.unit ? unitTypeOf(row.unit) : null);
                  const processing = unitType != null && supportsProcessing(unitType);
                  const pieces = unitType === 'count';
                  const volume = unitType === 'volume';
                  const pieceNet = pieces && row.netAmount !== '' ? Number(row.netAmount) : null;
                  const netGrams = row.measuredNetWeightGrams ?? pieceNetWeight(pieceNet, ingredient?.pieceWeightGrams);
                  const saved = savedItems.get(row.ingredientId);
                  const stockWriteoff = row.unit && stockWriteoffQuantity(Number(row.quantity), row.unit,
                    ingredient?.roundPieceWriteoff ?? saved?.roundPieceWriteoff);
                  const processingConfig = { processingStages: row.processingStages, lossPercent: Number(row.lossPercent),
                    processingMethod: row.processingMethod || null };
                  const stages = displayedProcessingStages(processingConfig);
                  const basis = row.processingBasis ?? (saved?.netAmount != null ? 'manual' : 'gross');
                  const retention = processingRetention(stages, Number(row.lossPercent));
                  function updateProcessing(nextBasis: ProcessingBasis, nextStages?: ProcessingStage[]) {
                    const nextRetention = nextStages === undefined ? retention : processingRetention(nextStages);
                    const quantities = processingQuantities(Number(row.quantity), Number(row.netAmount), nextBasis, nextRetention);
                    update(row.key, { processingBasis: nextBasis,
                      quantity: nextBasis === 'net' && row.netAmount !== '' ? recipeWeight(quantities.amount) : row.quantity,
                      netAmount: nextBasis === 'gross' && row.quantity !== '' ? recipeWeight(quantities.netAmount) : row.netAmount,
                      ...(nextStages !== undefined && { processingStages: nextStages, processingMethod: '', lossPercent: '0' }) });
                  }
                  const choices = options.filter(({ id }) => id === row.ingredientId || !selected.has(id));
                  return (
                    <tr key={row.key} ref={(element) => {
                      if (element && focusNewRow.current === row.key) {
                        element.querySelector<HTMLInputElement>('input')?.focus();
                        focusNewRow.current = null;
                      }
                    }}>
                      <td data-label="Продукт">
                        {row.ingredientId && replacingIngredient !== row.key ? (
                          <button type="button" className="poster-recipe-product text-left"
                            title="Заменить ингредиент" disabled={!editable}
                            onClick={() => setReplacingIngredient(row.key)}>
                            {ingredient?.name ?? savedItems.get(row.ingredientId)?.name ?? 'Недоступный ингредиент'}
                            {row.unit && <span className="text-text-muted">, {unitLabel(row.unit)}</span>}
                          </button>
                        ) : <DocumentProductPicker
                          label={`Ингредиент ${index + 1}`}
                          value={row.ingredientId}
                          options={choices.map((item) => ({ ...item, unit: unitLabel(item.baseUnit ?? item.displayUnit) }))}
                          onCreate={can('actions.warehouseReceive') ? (name) => setQuickIngredient({ key: row.key, name }) : undefined}
                          createLabel={(name) => !name ? '+ Создать ингредиент' : options.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ? undefined : `Создать ингредиент «${name}»`}
                          fallbackName={
                            savedItems.get(row.ingredientId)?.name ??
                            (row.ingredientId ? 'Недоступный ингредиент' : undefined)
                          }
                          disabled={!editable || ingredients.isPending}
                          onChange={(ingredientId) => {
                            setReplacingIngredient(null);
                            if (ingredientId === row.ingredientId) return;
                            const selectedItem = byId.get(ingredientId);
                            update(row.key, {
                              ingredientId,
                              unit: selectedItem?.baseUnit ?? selectedItem?.displayUnit ?? '',
                              processingMethod: '',
                              processingStages: undefined,
                              processingBasis: undefined,
                              measuredNetWeightGrams: selectedItem?.unitType === 'volume' && row.quantity ? Number(row.quantity) : undefined,
                              linkVolumeGrams: selectedItem?.unitType === 'volume',
                              volumeNetEdited: undefined,
                              lossPercent: '0',
                              netAmount: row.quantity,
                            });
                          }}
                        />}
                      </td>
                      <td data-label="Метод приготовления">
                        {processing ? <><button type="button" className="text-primary" aria-label={`Метод приготовления ${index + 1}`}
                          onClick={() => setProcessingRow(row.key)}>{recipeProcessingLabel(processingConfig) || '—'}</button>
                        {processingRow === row.key && <Modal open manageFocus title={`Обработка · ${ingredient?.name ?? saved?.name ?? ''}`}
                          onClose={() => setProcessingRow(null)} footer={<button type="button" className="btn-primary btn-md" onClick={() => setProcessingRow(null)}>Готово</button>}>
                          <RecipeProcessingFields label={`Обработка ${index + 1}`} basis={basis} stages={stages}
                          gross={Number(row.quantity)} unit={row.unit ? unitLabel(row.unit) : ''} defaults={ingredient?.processingLosses}
                          disabled={!row.ingredientId || !editable || save.isPending} onBasis={(nextBasis) => updateProcessing(nextBasis)}
                          onStages={(nextStages) => updateProcessing(basis, nextStages)} /></Modal>}</>
                        : <span className="text-text-muted">{recipeProcessingLabel(processingConfig) || '—'}</span>}
                      </td>
                      <td data-label="Брутто">
                        <div className="flex items-center gap-1.5">
                          <input
                            aria-label={`Брутто ${index + 1}`}
                            className="input h-9 w-[88px]"
                            type="number"
                            min="0.000001"
                            step="any"
                            value={row.quantity}
                            disabled={!row.ingredientId}
                            readOnly={processing && basis === 'net'}
                            required
                            onChange={(e) => {
                              const quantity = e.target.value;
                              let netAmount = quantity;
                              if (processing) {
                                if (basis === 'manual') netAmount = row.netAmount;
                                else if (quantity !== '') netAmount = recipeWeight(processingQuantities(Number(quantity), 0, 'gross', retention).netAmount);
                              }
                              if (quantity && pieces && saved?.netAmount != null && saved.quantity > 0) {
                                netAmount = recipeWeight(Number(quantity) * saved.netAmount / saved.quantity);
                              }
                              if (unitType === 'volume' && row.netAmount !== row.quantity && row.netAmount !== '') netAmount = row.netAmount;
                              update(row.key, { quantity, netAmount, ...(processing && { processingBasis: basis }),
                                ...(volume && row.linkVolumeGrams && { measuredNetWeightGrams: quantity && row.unit ? Number(quantity) * unitFactor(row.unit) : null }) });
                            }}
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
                        {row.unit && stockWriteoff !== '' && stockWriteoff !== Number(row.quantity) &&
                          <p className="mt-1 text-xs text-text-muted">Спишется {recipeQuantity(stockWriteoff, unitLabel(row.unit))}</p>}
                      </td>
                      <td data-label="Нетто">
                        <div className="flex items-center gap-1.5">
                          {processing && <button type="button" aria-label={`Указать нетто вручную ${index + 1}`}
                            aria-pressed={basis === 'manual'} title="Связать брутто и нетто или указать их вручную"
                            className="prep-quantity-link" onClick={() => updateProcessing(basis === 'manual' ? 'gross' : 'manual')}>📎</button>}
                          {pieces ? <div className="flex w-32 items-center gap-1">
                            <QuantityInput label={`Нетто ${index + 1}, г`} precision={3} value={netGrams} placeholder="—"
                              disabled={!editable} onChange={(value) => update(row.key, { measuredNetWeightGrams: value })} />
                            <span className="text-xs">г</span>
                          </div> : volume ? <VolumeNetFields label={`Нетто ${index + 1}`}
                            unit={row.unit ? unitLabel(row.unit) : ''} grams={row.measuredNetWeightGrams ?? null}
                            volume={row.netAmount === '' ? null : Number(row.netAmount)}
                            invalidVolume={Number(row.netAmount) > Number(row.quantity)} disabled={!row.ingredientId || !editable}
                            onGrams={(measuredNetWeightGrams) => update(row.key, { measuredNetWeightGrams, linkVolumeGrams: false })}
                            onVolume={(value) => {
                              const netAmount = value ?? Number(row.quantity);
                              update(row.key, { netAmount: String(netAmount), volumeNetEdited: true,
                                lossPercent: String(lossFromAmounts(Number(row.quantity), netAmount)) });
                            }} /> : <input
                            aria-label={`Нетто ${index + 1}`}
                            className="input h-9 w-[88px]"
                            type="number"
                            min="0"
                            max={processing ? undefined : row.quantity || undefined}
                            step="any"
                            value={row.netAmount}
                            disabled={!row.ingredientId}
                            readOnly={processing && basis === 'gross'}
                            aria-invalid={processing && basis === 'net' && retention <= 0 || undefined}
                            required
                            onChange={(e) => {
                              const netAmount = e.target.value;
                              if (processing) {
                                const quantity = basis === 'net' ? (netAmount ? recipeWeight(processingQuantities(
                                  Number(row.quantity), Number(netAmount), basis, retention).amount) : '') : row.quantity;
                                update(row.key, { netAmount, quantity, processingBasis: basis });
                              } else {
                                update(row.key, { netAmount, lossPercent: String(lossFromAmounts(Number(row.quantity), Number(netAmount))) });
                              }
                            }}
                          />}
                          {!pieces && !volume && <span className="text-xs">{row.unit ? unitLabel(row.unit) : ''}</span>}
                        </div>
                      </td>
                      {costs && (
                        <td data-label="Себестоимость" className="text-right whitespace-nowrap">
                          {virtualPreview.pending && ingredient?.preparationMode === 'virtual' && rowCosts[index] == null ? 'Расчёт…'
                            : <PreparationCost value={rowCosts[index]} known={knownCosts[index]} />}</td>
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
                          onClick={() => {
                            const row = blankRow();
                            focusNewRow.current = row.key;
                            setRows((current) => [...current, row]);
                          }}
                        >
                          Добавить ингредиент
                        </button>
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
                        placeholder={requiresMeasuredYield ? 'Факт' : undefined}
                        title={requiresMeasuredYield ? 'Укажите измеренный выход при разных единицах состава' : undefined}
                        onChange={(e) => setEnteredOutput(e.target.value || null)}
                        required
                      />
                      <select
                        aria-label="Единица выхода"
                        className="poster-unit-select"
                        value={outputUnit}
                        onChange={(e) => {
                          const next = e.target.value as UnitCode;
                          if (fixedOutput !== null)
                            setEnteredOutput(
                              recipeWeight((Number(fixedOutput) * unitFactor(outputUnit)) / unitFactor(next)),
                            );
                          setOutputUnit(next);
                        }}
                      >
                        {unitsForType(recipe.unitType).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  {costs && (
                    <td className="text-right font-medium whitespace-nowrap">{virtualPreview.pending && totalCost == null ? 'Расчёт…'
                      : <PreparationCost value={totalCost} known={knownCosts.reduce((sum, cost) => sum + cost, 0)} />}</td>
                  )}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {virtualPreview.error && <p role="alert" className="text-sm text-danger">{apiError(virtualPreview.error)}{' '}
            <button type="button" className="underline" onClick={() => void virtualPreview.retry()}>Повторить расчёт</button></p>}
        </fieldset>
        <fieldset disabled={!editable || save.isPending}>
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
              {production && kind !== 'prepared_dish' && (
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
          </DocumentFooter>
        )}
      </form>
      {quickIngredient && (
        <ItemCard
          compact
          defaultKind="raw"
          initialName={quickIngredient.name}
          onClose={() => setQuickIngredient(null)}
          onSaved={(item) =>
            setRows((current) => {
              return current.map((row) => row.key === quickIngredient.key
                ? { ...blankRow(), key: row.key, ingredientId: item.id, unit: item.baseUnit ?? item.displayUnit, linkVolumeGrams: item.unitType === 'volume' }
                : row);
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
  onProduced,
}: {
  recipe: PreparationRecipe;
  warehouse: WarehouseLocation;
  onClose: () => void;
  onBatch?: (id: string) => void;
  onProduced?: (id: string) => void;
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
  const [comment, setComment] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const { openEditor } = useEditorRoute();
  const { markSaved } = useEditorDirty(quantity !== String(recipe.outputQuantity) || unit !== recipe.outputUnit || !!planned ||
    !!number || !!expires || !!comment || Object.keys(actual).length > 0 || produce.isPending);
  const history = useProductionBatches(recipe.id);
  const factor =
    ((Number(effectivePlanned) || 0) * (unit === 'kg' || unit === 'l' ? 1000 : 1)) /
    (recipe.outputQuantity * (recipe.outputUnit === 'kg' || recipe.outputUnit === 'l' ? 1000 : 1));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (produce.isPending || !can('actions.warehouseProduce')) return;
    setError('');
    const expiresAt = inventoryTimeIso(expires);
    if (expires && !expiresAt) {
      setError('Укажите дату и время окончания срока годности.');
      return;
    }
    try {
      const batch = await produce.mutateAsync({
        id: recipe.id,
        warehouseId: warehouse.id,
        quantity: Number(quantity),
        plannedQuantity: Number(effectivePlanned),
        unit,
        requestKey,
        batchNumber: number.trim() || undefined,
        expiresAt,
        comment: comment.trim() || undefined,
        items: Object.keys(actual).length
          ? recipe.items.map((item) => ({
              ingredientId: item.ingredientId,
              quantity: Number(actual[item.ingredientId] ?? stockWriteoffQuantity(item.quantity * factor, item.unit, item.roundPieceWriteoff)),
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
      markSaved();
      if (onProduced) onProduced(batch.batchId);
      else onClose();
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
      <label className="block text-sm">Комментарий
        <textarea className="input mt-1 min-h-16 w-full" maxLength={1000} value={comment}
          onChange={(event) => setComment(event.target.value)} />
      </label>
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
          {recipe.items.map((item) => {
            const norm = item.quantity * factor;
            const writeoff = stockWriteoffQuantity(norm, item.unit, item.roundPieceWriteoff);
            return <div key={item.ingredientId}>
              <Quantity
                label={`${item.name}, ${unitLabel(item.unit)} · по норме ${Number(norm.toFixed(3))}`}
                value={actual[item.ingredientId] ?? String(Number(writeoff.toFixed(3)))}
                onChange={(v) => setActual((current) => ({ ...current, [item.ingredientId]: v }))}
              />
              {actual[item.ingredientId] == null && item.unit === 'pcs' && item.roundPieceWriteoff && writeoff !== Number(norm.toPrecision(15)) &&
                <p className="mt-1 text-xs text-text-muted">Спишется {recipeQuantity(writeoff, unitLabel(item.unit))}</p>}
            </div>;
          })}
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
                {batch.batchNumber ?? 'Партия'} · {inventoryTimeDisplay(batch.producedAt)}
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
          <WorkspaceHeaderActions>
          <button type="button" className="workspace-tool" onClick={() => window.print()}>
            <IconPrinter />Печать
          </button>
          </WorkspaceHeaderActions>
          {batch.reversedAt && (
            <p className="rounded-lg bg-warning/10 p-3 text-sm">Проведение отменено: {batch.reverseReason}</p>
          )}
          {batch.reversalBlockedReason && <p role="status" className="rounded-lg bg-background p-3 text-sm text-text-secondary">{batch.reversalBlockedReason}</p>}
          {!batch.reversedAt && can('actions.warehouseApprove') && (
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={reverseBatch.isPending || !!batch.reversalBlockedReason}
              onClick={() => void reverse()}
            >
              Отменить проведение
            </button>
          )}
          <p className="text-sm text-text-secondary">
            {batch.batchNumber ? `Партия № ${batch.batchNumber} · ` : ''}{inventoryTimeDisplay(batch.producedAt)}
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <p>Склад: {batch.warehouseName ?? '—'}</p>
            <p>Сотрудник: {batch.actorName ?? '—'}</p>
            <p>План: {qty(batch.plannedQuantity, unitLabel(batch.unit))}</p>
            <p>Факт: {qty(batch.actualQuantity, unitLabel(batch.unit))}</p>
            <p>Отклонение: {qty(batch.yieldDifference, unitLabel(batch.unit))}</p>
            {can('actions.warehouseCosts') && <p>Себестоимость: {costLabel(batch.totalCost)}</p>}
          </div>
          {batch.comment && <p className="whitespace-pre-wrap break-words text-sm">Комментарий: {batch.comment}</p>}
          {batch.expiresAt && (
            <p className="text-sm">Годен до {inventoryTimeDisplay(batch.expiresAt)}</p>
          )}
          <h4 className="font-semibold">Фактически использовано</h4>
          {(batch.items?.actual ?? []).map((item) => (
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
