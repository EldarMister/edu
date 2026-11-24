import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { IconSettings, IconX } from '../../components/icons';
import { apiError } from '@/lib/api';
import { money, taxRateLabel } from '@/lib/format';
import { ItemCard } from './ItemCard';
import { PROCESSING_METHODS, useIngredients, useWarehouseLocations, type Ingredient, type ProcessingBasis, type ProcessingStage } from './api';
import type { RecipePreview, useRecipePreview } from './recipe-preview-api';
import { displayedProcessingStages, lossFromAmounts, netFromLoss, pieceNetWeight, processingQuantities, processingRetention,
  recipeQuantity, supportsProcessing, type RecipeDraftRow } from './recipe-draft-values';
import { RecipeProcessingFields } from './RecipeProcessingFields';
import { QuantityInput, VolumeNetFields } from './RecipeQuantityInput';
import { RecipeBatchPreview } from './RecipeBatchPreview';
import { ALL_UNITS, unitLabel, unitsForType, type UnitCode } from './units';

type IngredientOption = { value: string; label: string };
type NamedVariant = { id: string; name: string };
type PreviewRow = RecipePreview['items'][number];
type WarehouseOptions = { id: string; name: string }[];
type RowDialog = 'processing' | 'net' | 'settings';

function unitFactor(unit: UnitCode) {
  return ALL_UNITS.find((value) => value.code === unit)!.factor;
}

function ingredientOption(item: Ingredient): IngredientOption {
  return { value: item.id, label: item.name + ' · ' + unitLabel(item.baseUnit ?? item.displayUnit) };
}

function newRow(item: Ingredient): RecipeDraftRow {
  return { ingredientId: item.id, name: item.name, unitType: item.unitType,
    amount: 0, unit: item.baseUnit ?? item.displayUnit };
}

function replacementRow(row: RecipeDraftRow, item: Ingredient): RecipeDraftRow {
  const replacement = { ...newRow(item), warehouseId: row.warehouseId, fromCommonWarehouse: row.fromCommonWarehouse };
  return item.unitType === row.unitType ? { ...replacement, unit: row.unit, amount: row.amount,
    ...(row.variantAmounts && { variantAmounts: row.variantAmounts }) } : replacement;
}

function DraftCell({ label, children, className = '', mobileActions }: {
  label: string; children: ReactNode; className?: string; mobileActions?: ReactNode;
}) {
  return <td className={'min-w-0 max-xl:!p-0 xl:px-2 xl:py-2 ' + className}>
    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-text-muted xl:hidden">
      <span>{label}</span>
      {mobileActions}
    </div>
    {children}
  </td>;
}

function inlineAmount(quantity: number | null, unit: UnitCode) {
  return quantity == null ? 'Не рассчитано' : recipeQuantity(quantity, unitLabel(unit));
}

function lossLabel(loss: number) {
  return taxRateLabel(Number(loss.toFixed(2)));
}

function processingSummary(stages: readonly ProcessingStage[], appliedLoss: number | null) {
  if (!stages.length) return appliedLoss
    ? 'По брутто и нетто · ' + lossLabel(appliedLoss)
    : 'Без обработки';
  if (stages.length === 1) {
    const stage = stages[0];
    const method = PROCESSING_METHODS.find(({ value }) => value === stage.method)?.label ?? stage.method;
    return method + ' · ' + lossLabel(appliedLoss ?? stage.lossPercent);
  }
  return 'Несколько этапов' + (appliedLoss == null ? '' : ' · ' + lossLabel(appliedLoss));
}

function scaleAmount(amount: number | null | undefined, factor: number) {
  return amount == null ? null : Number((amount * factor).toFixed(6));
}

export function RecipeDraftFields({ rows, onChange, variants = [], showCosts = true, allowCreate = true,
  disabled = false, preview, previewVariant, outputDetails, showBatchPreview = true, batchAction, inputPortions = 1 }: {
  rows: RecipeDraftRow[];
  onChange: (rows: RecipeDraftRow[]) => void;
  variants?: { id?: string; name: string }[];
  showCosts?: boolean;
  allowCreate?: boolean;
  disabled?: boolean;
  preview: ReturnType<typeof useRecipePreview>;
  previewVariant?: string;
  outputDetails?: ReactNode;
  showBatchPreview?: boolean;
  batchAction?: ReactNode;
  inputPortions?: number;
}) {
  const ingredients = useIngredients('');
  const warehouses = useWarehouseLocations(rows.length > 0);
  const [createIngredient, setCreateIngredient] = useState(false);
  const existing = new Set(rows.map((row) => row.ingredientId));
  const activeIngredients = (ingredients.data ?? []).filter((item) => item.isActive);
  const available = activeIngredients.filter((item) => !existing.has(item.id));
  const options = available.map(ingredientOption);
  const ingredientsById = new Map(ingredients.data?.map((item) => [item.id, item]));
  const calculatedById = new Map(preview.data?.items.map((item) => [item.ingredientId, item]));
  const namedVariants = variants.filter((variant): variant is NamedVariant => !!variant.id);

  function add(item: Ingredient) {
    onChange([...rows, newRow(item)]);
  }

  const calculatedOutput = preview.data?.output;
  const missingCosts = preview.data?.compositionMissingCosts ?? [];
  const output = calculatedOutput ? recipeQuantity(calculatedOutput.amount, unitLabel(calculatedOutput.unit)) : null;
  const scaleCostToBatch = inputPortions > 1 && !previewVariant;
  const compositionCost = preview.data?.compositionCostForScaling ?? preview.data?.compositionFoodCost;
  const footerCost = compositionCost == null ? null : compositionCost * (scaleCostToBatch ? inputPortions : 1);
  const totalLabel = scaleCostToBatch ? 'Итого на партию' : inputPortions > 1 ? 'Итого на порцию' : 'Итого';
  const addActions = <div className="flex min-w-0 flex-wrap items-center gap-2">
    <div className="w-full min-w-0 sm:w-64">
      <Select searchable ariaLabel="Добавить компонент" placeholder="Добавить компонент…" className="h-9 w-full" value=""
        disabled={disabled || ingredients.isPending || ingredients.isError || !options.length}
        onChange={(id) => {
          const selected = ingredientsById.get(id);
          if (selected && !existing.has(id)) add(selected);
        }}
        options={options} />
    </div>
    {allowCreate && <button className="btn-ghost btn-md shrink-0 text-primary" type="button" disabled={disabled}
      onClick={() => setCreateIngredient(true)}>+ Новый ингредиент</button>}
    {batchAction}
  </div>;

  return <section className="w-full min-w-0 space-y-3 border-t border-border pt-4" aria-label="Состав техкарты">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className="text-lg font-semibold">Состав техкарты</h3>
      {inputPortions > 1 && <span className="text-sm text-text-muted">Нормы на {inputPortions.toLocaleString('ru-RU')} порций</span>}
    </div>
    {rows.length > 0 ? <div className="min-w-0 xl:overflow-x-auto">
      <table className="w-full text-sm max-xl:block xl:min-w-[800px] xl:table-fixed">
        <thead className="max-xl:sr-only">
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th scope="col" className="py-2 pl-2 font-medium">Ингредиент / полуфабрикат</th>
            <th scope="col" className="w-[19%] px-2 font-medium">Обработка</th>
            <th scope="col" className="w-[17%] px-2 font-medium">Брутто</th>
            <th scope="col" className="w-[15%] px-2 font-medium">Нетто</th>
            {showCosts && <th scope="col" className="w-[14%] px-2 text-right font-medium">Себестоимость</th>}
            <th scope="col" className="w-[80px]"><span className="sr-only">Действия</span></th>
          </tr>
        </thead>
        <tbody className="max-xl:grid max-xl:gap-2">
          {rows.map((row, index) => <CompositionRow key={row.ingredientId} row={row} showCosts={showCosts} disabled={disabled}
            ingredient={ingredientsById.get(row.ingredientId)} options={options}
            calculated={calculatedById.get(row.ingredientId)} pending={preview.pending}
            previewVariant={previewVariant} inputPortions={inputPortions}
            variants={namedVariants} locations={warehouses.data?.locations ?? []} loadingWarehouses={warehouses.isPending}
            onChange={(next) => onChange(rows.map((item, position) => position === index ? next : item))}
            onReplace={(id) => {
              const item = ingredientsById.get(id);
              if (item?.isActive && !existing.has(id)) {
                onChange(rows.map((previous, position) => position === index ? replacementRow(previous, item) : previous));
              }
            }}
            onRemove={() => onChange(rows.filter((_, position) => position !== index))} />)}
        </tbody>
        <tfoot className="max-xl:block">
          <tr className="max-xl:block">
            <td colSpan={showCosts ? 6 : 5} className="px-2 py-3 max-xl:block max-xl:!px-0">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                {addActions}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {outputDetails ?? (output && <span>Выход порции: <strong>{output}</strong></span>)}
                  {showCosts && <span>{totalLabel}: <strong>{footerCost == null
                    ? preview.pending ? 'Расчёт…' : 'не рассчитано' : money(footerCost)}</strong></span>}
                </div>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div> : <div className="flex flex-wrap items-center justify-between gap-2">
      {addActions}
      {outputDetails}
    </div>}
    {rows.length > 0 && showBatchPreview && <RecipeBatchPreview preview={preview.data} pending={preview.pending} showCosts={showCosts} />}
    {ingredients.error && <p role="alert" className="text-sm text-danger">{apiError(ingredients.error)}{' '}
      <button type="button" className="underline" onClick={() => void ingredients.refetch()}>Повторить</button></p>}
    {preview.error && <p role="alert" className="text-sm text-danger">{apiError(preview.error)}{' '}
      <button type="button" className="underline" onClick={() => void preview.retry()}>Повторить расчёт</button></p>}
    {showCosts && missingCosts.length > 0 && <p role="status" className="text-sm text-warning">
      Неполная калькуляция. Нет данных о себестоимости: {missingCosts.join(', ')}.
    </p>}
    {createIngredient && <ItemCard compact defaultKind="raw" onClose={() => setCreateIngredient(false)} onSaved={add} />}
  </section>;
}

function CompositionRow({ row, ingredient, options, calculated, pending, showCosts, disabled, previewVariant, inputPortions,
  variants, locations, loadingWarehouses, onChange, onReplace, onRemove }: {
  row: RecipeDraftRow;
  ingredient?: Ingredient;
  options: IngredientOption[];
  calculated?: PreviewRow;
  pending: boolean;
  showCosts: boolean;
  disabled: boolean;
  previewVariant?: string;
  inputPortions: number;
  variants: NamedVariant[];
  locations: WarehouseOptions;
  loadingWarehouses: boolean;
  onChange: (row: RecipeDraftRow) => void;
  onReplace: (ingredientId: string) => void;
  onRemove: () => void;
}) {
  const [dialog, setDialog] = useState<RowDialog>();
  const processing = supportsProcessing(row.unitType);
  const volume = row.unitType === 'volume';
  const pieces = row.unitType === 'count';
  const unit = unitLabel(row.unit);
  const lineCostScale = previewVariant ? 1 : inputPortions;
  const fallbackLoss = row.lossPercent ?? 0;
  const stages = displayedProcessingStages(row);
  const basis = row.processingBasis ?? (row.netAmount == null ? 'gross' : 'manual');
  const retention = processingRetention(stages, fallbackLoss);
  const calculatedBaseNet = previewVariant ? null : scaleAmount(calculated?.netAmount, inputPortions);
  const calculatedBaseWeight = previewVariant ? null : scaleAmount(calculated?.netWeightGrams, inputPortions);
  const netAmount = processing && basis === 'gross' ? processingQuantities(row.amount, 0, basis, retention).netAmount
    : (row.processingBasis === 'manual' || row.processingBasis === 'net') && row.netAmount == null
      ? null : row.netAmount ?? calculatedBaseNet ?? netFromLoss(row.amount, fallbackLoss);
  const pieceGrams = ingredient ? ingredient.pieceWeightGrams : calculated?.pieceWeightGrams;
  const measuredGrams = row.measuredNetWeightGrams ?? null;
  const netGrams = measuredGrams ?? calculatedBaseWeight ?? (pieces ? pieceNetWeight(netAmount, pieceGrams) : null);
  const invalidNet = processing ? (basis === 'net' ? retention <= 0 || !netAmount : netAmount == null || netAmount < 0)
    : netAmount != null && (netAmount < 0 || netAmount > row.amount || (fallbackLoss === 100 && netAmount > 0));
  const effectiveLoss = row.amount > 0 && netAmount != null ? (1 - netAmount / row.amount) * 100 : null;
  const configuredLoss = (1 - retention) * 100;
  const appliedProcessingLoss = stages.length ? configuredLoss : effectiveLoss;
  const missingDefaults = ingredient && stages.some(({ method, lossPercent }) =>
    lossPercent === 0 && ingredient.processingLosses?.[method] == null);
  const warehouseChoice = row.warehouseId ?? (row.fromCommonWarehouse ? 'common' : 'auto');
  const explicitWarehouse = locations.find((location) => location.id === row.warehouseId);
  const savedWarehouseName = explicitWarehouse?.name ?? calculated?.warehouseName ?? 'Сохранённый склад';
  const warehouseOverride = row.warehouseId ? savedWarehouseName : row.fromCommonWarehouse ? 'Общий склад' : null;
  const visibleWarehouse = warehouseOverride ?? (disabled ? calculated?.warehouseName : null);
  const previewCost = calculated?.lineCostForScaling ?? calculated?.lineCost;
  const selectedOption = ingredient ? ingredientOption(ingredient) : { value: row.ingredientId, label: row.name };
  const grossLabel = 'Брутто ' + row.name;
  const netLabel = 'Нетто ' + row.name;
  const pieceWeightLabel = pieceGrams == null ? 'Вес штуки не задан в карточке ингредиента' : 'Вес одной штуки: ' + recipeQuantity(pieceGrams, 'г');

  function patch(next: Partial<RecipeDraftRow>) {
    onChange({ ...row, ...next });
  }

  function changeUnit(nextUnit: UnitCode) {
    const factor = unitFactor(row.unit) / unitFactor(nextUnit);
    patch({ unit: nextUnit, amount: scaleAmount(row.amount, factor) ?? 0,
      netAmount: row.netAmount == null ? row.netAmount : scaleAmount(row.netAmount, factor),
      ...(row.variantAmounts && { variantAmounts: Object.fromEntries(
        Object.entries(row.variantAmounts).map(([id, quantity]) => [id, scaleAmount(quantity, factor) ?? 0])) }),
    });
  }

  function changeGross(value: number | null) {
    const amount = value ?? 0;
    if (processing) {
      patch({ amount, processingBasis: basis, netAmount: basis === 'gross' ? undefined : netAmount });
    } else {
      const nextNet = pieces || row.netAmount === row.amount ? undefined : row.netAmount;
      patch({ amount, netAmount: nextNet, ...(volume && nextNet != null && { lossPercent: lossFromAmounts(amount, nextNet) }) });
    }
  }

  function updateProcessing(nextBasis: ProcessingBasis, nextStages?: ProcessingStage[]) {
    const nextRetention = nextStages === undefined ? retention : processingRetention(nextStages);
    const quantities = processingQuantities(row.amount, netAmount ?? 0, nextBasis, nextRetention);
    patch({ amount: quantities.amount, processingBasis: nextBasis,
      netAmount: nextBasis === 'gross' ? undefined : netAmount,
      ...(nextStages !== undefined && { processingStages: nextStages, processingMethod: null, lossPercent: 0 }) });
  }

  const processingFields = processing && <RecipeProcessingFields label={'Обработка: ' + row.name} basis={basis} stages={stages}
    gross={row.amount} unit={unit} defaults={ingredient?.processingLosses} disabled={disabled}
    onBasis={(nextBasis) => updateProcessing(nextBasis)} onStages={(nextStages) => updateProcessing(basis, nextStages)} />;
  const measuredFields = volume ? <VolumeNetFields label={netLabel} unit={unit} grams={measuredGrams}
    volume={netAmount} invalidVolume={invalidNet} disabled={disabled}
    onGrams={(measuredNetWeightGrams) => patch({ measuredNetWeightGrams })}
    onVolume={(value) => {
      const amount = row.amount || value || 0;
      const netAmount = value ?? amount;
      patch({ amount, netAmount, lossPercent: lossFromAmounts(amount, netAmount) });
    }} /> : pieces && <div className="space-y-2">
    <div className="flex max-w-40 items-center gap-1.5">
      <QuantityInput label={netLabel + ', г'} value={measuredGrams}
        onChange={(measuredNetWeightGrams) => patch({ measuredNetWeightGrams })}
        precision={3} placeholder={netGrams == null ? 'Укажите вес' : String(netGrams)} disabled={disabled} />
      <span className="shrink-0 text-xs text-text-muted">г</span>
    </div>
    <p className="text-xs text-text-muted">{pieceWeightLabel}.
      {' '}Ручное нетто меняет выход блюда. Брутто определяет списание и себестоимость.</p>
    {measuredGrams != null && <button type="button" className="text-xs text-primary hover:underline" disabled={disabled}
      onClick={() => patch({ measuredNetWeightGrams: null })}>Вернуть автоматический расчёт</button>}
  </div>;

  const rowActions = <div className="flex shrink-0 items-center justify-end">
    <button type="button" aria-label={'Параметры строки: ' + row.name}
      title={variants.length ? 'Склад и нормы по вариантам' : 'Склад списания'}
      className="btn-ghost h-9 w-9 text-text-muted" disabled={disabled} onClick={() => setDialog('settings')}>
      <IconSettings className="h-4 w-4" />
    </button>
    <button type="button" aria-label={'Убрать ' + row.name} title="Убрать из состава"
      className="btn-ghost h-9 w-9 text-text-muted hover:text-danger" disabled={disabled} onClick={onRemove}>
      <IconX className="h-4 w-4" />
    </button>
  </div>;
  return <tr className="relative align-top max-xl:grid max-xl:grid-cols-2 max-xl:gap-3 max-xl:rounded-md max-xl:border max-xl:border-border max-xl:p-3 xl:border-b xl:border-border">
    <DraftCell label="Ингредиент / полуфабрикат" className="max-xl:col-span-2" mobileActions={rowActions}>
      <Select searchable ariaLabel={'Ингредиент: ' + row.name} className="h-9 w-full" value={row.ingredientId}
        disabled={disabled || !options.length} onChange={onReplace} options={[selectedOption, ...options]} />
      {ingredient?.isActive === false && <p className="text-xs text-warning">Архивная складская позиция</p>}
      {previewVariant && calculated && <p className="mt-1 text-xs text-text-muted">
        Вариант: {recipeQuantity(calculated.amount, unitLabel(calculated.amountUnit))} брутто
        {calculated.netWeightGrams != null ? ' · ' + recipeQuantity(calculated.netWeightGrams, 'г') + ' нетто'
          : calculated.netAmount != null && ' · ' + recipeQuantity(calculated.netAmount, unitLabel(calculated.amountUnit)) + ' нетто'}
      </p>}
      {visibleWarehouse && <p className="mt-1 break-words text-xs text-text-muted">Склад: {visibleWarehouse}</p>}
    </DraftCell>
    <DraftCell label="Обработка" className={processing || stages.length ? 'max-xl:col-span-2' : 'max-xl:hidden'}>
      {processing ? <button type="button" className="break-words text-left text-sm text-primary hover:underline xl:min-h-10"
        aria-label={'Обработка: ' + row.name} disabled={disabled} onClick={() => setDialog('processing')}>
        {processingSummary(stages, appliedProcessingLoss)}
      </button> : <span className="block py-2 text-sm text-text-muted">
        {stages.length ? processingSummary(stages, fallbackLoss) : '—'}
      </span>}
      {missingDefaults && <p className="text-xs text-warning">Потери не настроены в карточке</p>}
      {processing && basis === 'manual' && stages.length > 0 && effectiveLoss != null &&
        Math.abs(effectiveLoss - configuredLoss) >= 0.01 && <p className="text-xs text-text-muted">
        По брутто и нетто: {lossLabel(effectiveLoss)}
      </p>}
    </DraftCell>
    <DraftCell label="Брутто">
      <div className="flex min-w-0 items-center gap-1.5">
        <QuantityInput label={grossLabel} value={row.amount || null} invalid={row.amount <= 0} disabled={disabled}
          readOnly={processing && basis === 'net'} onChange={changeGross} />
        {unitsForType(row.unitType).length > 1 ? <select aria-label={'Единица ' + row.name}
          className="max-w-16 shrink-0 rounded border border-border bg-background px-1 py-1 text-xs" value={row.unit} disabled={disabled}
          onChange={(event) => changeUnit(event.target.value as UnitCode)}>
          {unitsForType(row.unitType).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select> : <span className="shrink-0 text-xs text-text-muted">{unit}</span>}
      </div>
    </DraftCell>
    <DraftCell label="Нетто">
      {processing ? <div className="flex min-w-0 items-center gap-1.5">
        <QuantityInput label={netLabel} value={netAmount} invalid={invalidNet} disabled={disabled}
          readOnly={basis === 'gross'} onChange={(value) => patch({ processingBasis: basis, netAmount: value,
            amount: processingQuantities(row.amount, value ?? 0, basis, retention).amount })} />
        <span className="shrink-0 text-xs text-text-muted">{unit}</span>
      </div> : <button type="button"
        className={'min-h-10 text-left hover:underline ' + (invalidNet ? 'text-danger' : 'text-primary')}
        aria-label={netLabel} title={pieces ? pieceWeightLabel : undefined} disabled={disabled} onClick={() => setDialog('net')}>
        {netGrams == null ? inlineAmount(netAmount, row.unit) : recipeQuantity(netGrams, 'г')}
      </button>}
    </DraftCell>
    {showCosts && <DraftCell label="Себестоимость" className="max-xl:col-span-2 max-xl:flex max-xl:items-baseline max-xl:justify-between xl:text-right">
      <div className="font-medium tabular-nums xl:pt-2">{previewCost == null
        ? <span className="text-xs text-text-muted">{pending ? 'Расчёт…' : 'Не рассчитана'}</span>
        : money(previewCost * lineCostScale)}</div>
    </DraftCell>}
    <td className="hidden py-2 xl:table-cell">{rowActions}</td>
    {dialog && createPortal(
      <Modal open manageFocus title={dialog === 'processing' ? 'Обработка: ' + row.name
        : dialog === 'net' ? 'Нетто: ' + row.name : 'Параметры строки: ' + row.name}
        onClose={() => setDialog(undefined)} panelClassName="max-w-md"
        footer={<div className="flex justify-end"><button type="button" className="btn-primary btn-md"
          onClick={() => setDialog(undefined)}>Готово</button></div>}>
        <div className="space-y-4">
          {dialog === 'processing' && processingFields}
          {dialog === 'net' && measuredFields}
          {dialog === 'settings' && <div className="space-y-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Склад списания
              <select aria-label={'Склад: ' + row.name} className="input h-10 w-full min-w-0 truncate"
                value={warehouseChoice} disabled={disabled || loadingWarehouses} onChange={(event) => {
                  const value = event.target.value;
                  patch({ warehouseId: value === 'auto' || value === 'common' ? null : value, fromCommonWarehouse: value === 'common' });
                }}>
                <option value="auto">По цеху</option>
                <option value="common">Общий склад</option>
                {row.warehouseId && !explicitWarehouse && <option value={row.warehouseId}>{savedWarehouseName}</option>}
                {locations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            {warehouseChoice === 'auto' && calculated?.warehouseName &&
              <p className="text-xs text-text-muted">Списание по цеху: {calculated.warehouseName}</p>}
            {showCosts && calculated?.avgCost != null &&
              <p className="text-xs text-text-muted">Себестоимость за {unit}: {money(calculated.avgCost)}</p>}
          </div>}
          {dialog === 'settings' && variants.length > 0 && <div className="space-y-2">
            <h4 className="font-medium">Нормы брутто по вариантам</h4>
            <p className="text-xs text-text-muted">{inputPortions > 1 && 'Введите брутто для всей партии. '}
              Пустое поле использует базовую норму брутто.</p>
            {variants.map(({ id, name }) => <div key={id} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-2">
              <span className="break-words text-sm">{name || 'Новый вариант'}</span>
              <QuantityInput label={'Расход ' + row.name + ': ' + (name || 'Новый вариант')}
                value={row.variantAmounts?.[id] ?? null} disabled={disabled} onChange={(value) => {
                  const variantAmounts = { ...row.variantAmounts };
                  if (value == null) delete variantAmounts[id];
                  else variantAmounts[id] = value;
                  patch({ variantAmounts });
                }} />
              <span className="text-xs text-text-muted">{unit}</span>
            </div>)}
          </div>}
        </div>
      </Modal>, document.body)}
  </tr>;
}
