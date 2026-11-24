import { useState, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { money, taxRateLabel } from '@/lib/format';
import { ItemCard } from './ItemCard';
import { qty, useIngredients, useWarehouseLocations, type Ingredient, type ProcessingBasis, type ProcessingStage } from './api';
import type { useRecipePreview } from './recipe-preview-api';
import { displayedProcessingStages, lossFromAmounts, pieceNetWeight, processingQuantities, processingRetention, recipeQuantity,
  supportsProcessing, type RecipeDraftRow } from './recipe-draft-values';
import { RecipeProcessingFields, recipeProcessingLabel } from './RecipeProcessingFields';
import { RecipeBatchPreview } from './RecipeBatchPreview';
import { ALL_UNITS, unitLabel, unitsForType, type UnitCode } from './units';

function unitFactor(unit: UnitCode) {
  return ALL_UNITS.find((value) => value.code === unit)!.factor;
}

function QuantityInput({ label, value, onChange, invalid = false, readOnly = false }: {
  label: string; value: number | null; onChange: (value: number | null) => void; invalid?: boolean; readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<string>();
  return <input aria-label={label} aria-invalid={invalid || undefined}
    className={'input h-10 w-full min-w-0 tabular-nums' + (invalid ? ' !border-danger' : '')}
    type="text" inputMode="decimal" value={draft ?? value ?? ''} placeholder="0" readOnly={readOnly}
    onBlur={() => setDraft(undefined)}
    onChange={(event) => {
      const text = event.target.value;
      if (!/^\d{0,11}(?:[,.]\d{0,6})?$/.test(text)) return;
      setDraft(text);
      const normalized = text.replace(',', '.');
      if (normalized === '') onChange(null);
      else if (Number.isFinite(Number(normalized))) onChange(Number(normalized));
    }} />;
}

function DraftCell({ label, children, className = '' }: {
  label: string; children: ReactNode; className?: string;
}) {
  return <td className={`min-w-0 xl:px-2 xl:py-3 ${className}`}>
    <span className="mb-1 block text-xs text-text-muted xl:hidden">{label}</span>
    {children}
  </td>;
}

export function RecipeDraftFields({ rows, onChange, variants = [], showCosts = true, allowCreate = true, disabled = false, preview, previewVariant }: {
  rows: RecipeDraftRow[];
  onChange: (rows: RecipeDraftRow[]) => void;
  variants?: { id?: string; name: string }[];
  showCosts?: boolean;
  allowCreate?: boolean;
  disabled?: boolean;
  preview: ReturnType<typeof useRecipePreview>;
  previewVariant?: string;
}) {
  const ingredients = useIngredients('');
  const warehouses = useWarehouseLocations(rows.length > 0);
  const [createIngredient, setCreateIngredient] = useState(false);
  const existing = new Set(rows.map((row) => row.ingredientId));
  const available = (ingredients.data ?? []).filter((item) => item.isActive && !existing.has(item.id));
  const locations = warehouses.data?.locations ?? [];
  const ingredientsById = new Map(ingredients.data?.map((item) => [item.id, item]));
  const calculatedById = new Map(preview.data?.items.map((item) => [item.ingredientId, item]));
  const namedVariants = variants.filter((variant): variant is { id: string; name: string } => !!variant.id);

  function add(item: Ingredient) {
    onChange([...rows, { ingredientId: item.id, name: item.name, unitType: item.unitType,
      amount: 0, unit: item.baseUnit ?? item.displayUnit }]);
  }

  function patch(index: number, values: Partial<RecipeDraftRow>) {
    onChange(rows.map((row, position) => position === index ? { ...row, ...values } : row));
  }

  const calculatedOutput = preview.data?.output;
  const missingCosts = preview.data?.compositionMissingCosts ?? [];
  const output = calculatedOutput ? recipeQuantity(calculatedOutput.amount, unitLabel(calculatedOutput.unit)) : null;

  return <section className="w-full min-w-0 space-y-4 border-t border-border pt-6">
    <h3 className="text-lg font-semibold">Состав техкарты</h3>
    {rows.length > 0 && <div className="w-full min-w-0 xl:overflow-x-auto">
      <table className="w-full text-sm max-xl:block xl:min-w-[860px]">
        <thead className="max-xl:sr-only"><tr className="border-b border-border text-left text-xs text-text-muted">
          <th scope="col" className="py-3 pr-2 font-medium">Ингредиент / полуфабрикат</th>
          <th scope="col" className="px-2 font-medium">Склад</th>
          <th scope="col" className="px-2 font-medium">Обработка</th>
          <th scope="col" className="w-20 px-2 font-medium">Брутто</th>
          <th scope="col" className="w-20 px-2 font-medium">Нетто</th>
          <th scope="col" className="w-20 px-2 font-medium">Потери, %</th>
          <th scope="col" className="w-20 px-2 font-medium">Ед.</th>
          {showCosts && <th scope="col" className="px-2 text-right font-medium">Себестоимость</th>}
          <th scope="col"><span className="sr-only">Действия</span></th>
        </tr></thead>
        <tbody className="max-xl:grid max-xl:gap-3">
          {rows.map((row, index) => {
            const calculated = calculatedById.get(row.ingredientId);
            const ingredient = ingredientsById.get(row.ingredientId);
            const warehouseChoice = row.warehouseId ?? (row.fromCommonWarehouse ? 'common' : 'auto');
            const explicitWarehouseRemoved = row.warehouseId && !locations.some((location) => location.id === row.warehouseId);
            const invalidGross = row.amount <= 0;
            const processing = supportsProcessing(row.unitType);
            const loss = row.lossPercent ?? 0;
            const legacyProcessing = !processing && !!row.processingMethod;
            const stages = displayedProcessingStages(row);
            const basis = row.processingBasis ?? (row.netAmount == null ? 'gross' : 'manual');
            const retention = processingRetention(stages, loss);
            const calculatedBaseNet = previewVariant ? null : calculated?.netAmount;
            const netAmount = processing && basis === 'gross' ? processingQuantities(row.amount, 0, basis, retention).netAmount
              : (row.processingBasis === 'manual' || row.processingBasis === 'net') && row.netAmount == null
                ? null : row.netAmount ?? calculatedBaseNet ?? row.amount;
            const pieceNet = row.netAmount === undefined ? calculatedBaseNet : row.netAmount;
            const pieceGrams = ingredient ? ingredient.pieceWeightGrams : calculated?.pieceWeightGrams;
            const netGrams = row.unitType === 'count' ?
              (!previewVariant ? calculated?.netWeightGrams : null) ?? pieceNetWeight(pieceNet, pieceGrams) : null;
            const invalidNet = processing ? (basis === 'net' ? retention <= 0 || !netAmount : netAmount == null || netAmount < 0)
              : netAmount != null && (netAmount < 0 || netAmount > row.amount || (loss === 100 && netAmount > 0));
            const effectiveLoss = row.amount > 0 && netAmount != null ? (1 - netAmount / row.amount) * 100 : null;
            function updateProcessing(nextBasis: ProcessingBasis, nextStages?: ProcessingStage[]) {
              const nextRetention = nextStages === undefined ? retention : processingRetention(nextStages);
              const quantities = processingQuantities(row.amount, netAmount ?? 0, nextBasis, nextRetention);
              patch(index, { amount: quantities.amount, processingBasis: nextBasis,
                netAmount: nextBasis === 'gross' ? undefined : netAmount,
                ...(nextStages !== undefined && { processingStages: nextStages, processingMethod: null, lossPercent: 0 }) });
            }
            return <tr key={row.ingredientId} className="relative align-top max-xl:grid max-xl:grid-cols-2 max-xl:gap-3 max-xl:rounded-xl max-xl:border max-xl:border-border max-xl:p-3 xl:border-b xl:border-border">
              <td className="min-w-0 max-xl:col-span-2 max-xl:pr-11 xl:py-3 xl:pr-2">
                <div className="break-words font-medium xl:pt-2">{row.name}</div>
                {ingredient?.isActive === false && <p className="text-xs text-warning">Архивная складская позиция</p>}
                {previewVariant && calculated && <p className="mt-1 text-xs text-text-muted">
                  Вариант: {qty(calculated.amount, unitLabel(calculated.amountUnit))} брутто
                  {calculated.netWeightGrams != null && ` · ${recipeQuantity(calculated.netWeightGrams, 'г')} нетто`}
                  {calculated.netAmount != null && (calculated.netWeightGrams == null
                    ? ` · ${qty(calculated.netAmount, unitLabel(calculated.amountUnit))} нетто`
                    : ` (${qty(calculated.netAmount, unitLabel(calculated.amountUnit))})`)}
                </p>}
                {namedVariants.length > 0 && <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-text-muted">Нормы по вариантам</summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-text-muted">Пустое поле использует базовую норму брутто.</p>
                    {namedVariants.map(({ id, name }) => <label key={id} className="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-2">
                      <span className="break-words">{name || 'Новый вариант'}</span>
                      <QuantityInput label={`Расход ${row.name}: ${name || 'Новый вариант'}`} value={row.variantAmounts?.[id] ?? null}
                        onChange={(value) => {
                          const amounts = { ...row.variantAmounts };
                          if (value == null) delete amounts[id];
                          else amounts[id] = value;
                          patch(index, { variantAmounts: amounts });
                        }} />
                    </label>)}
                  </div>
                </details>}
              </td>
              <DraftCell label="Склад">
                <select aria-label={`Склад: ${row.name}`} className="input h-10 w-full min-w-0 px-2 xl:min-w-32"
                  value={warehouseChoice} disabled={disabled || warehouses.isPending}
                  onChange={(event) => {
                    const value = event.target.value;
                    patch(index, { warehouseId: value === 'auto' || value === 'common' ? null : value, fromCommonWarehouse: value === 'common' });
                  }}>
                  <option value="auto">По цеху</option>
                  <option value="common">Общий склад</option>
                  {explicitWarehouseRemoved && <option value={row.warehouseId!}>{calculated?.warehouseName ?? 'Сохранённый склад'}</option>}
                  {locations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
                {calculated?.warehouseName && <div className="mt-1 text-xs text-text-muted">{calculated.warehouseName}</div>}
              </DraftCell>
              <DraftCell label="Обработка" className={!processing && !legacyProcessing ? 'max-xl:hidden' : undefined}>
                {processing ? <RecipeProcessingFields label={`Обработка: ${row.name}`} basis={basis} stages={stages}
                  gross={row.amount} unit={unitLabel(row.unit)} defaults={ingredient?.processingLosses} disabled={disabled}
                  onBasis={(nextBasis) => updateProcessing(nextBasis)} onStages={(nextStages) => updateProcessing(basis, nextStages)} />
                : <span className="block text-sm text-text-muted xl:pt-2">
                  {recipeProcessingLabel(row) || '—'}
                </span>}
              </DraftCell>
              <DraftCell label="Брутто">
                <QuantityInput label={`Брутто ${row.name}`} value={row.amount || null} invalid={invalidGross}
                  readOnly={processing && basis === 'net'} onChange={(value) => {
                  const amount = value ?? 0;
                  if (processing) patch(index, { amount, processingBasis: basis, netAmount: basis === 'gross' ? undefined : netAmount });
                  else {
                    const nextNet = row.unitType === 'count' || row.netAmount === row.amount ? undefined : row.netAmount;
                    patch(index, { amount, netAmount: nextNet, ...(row.unitType === 'volume' && nextNet != null && {
                      lossPercent: lossFromAmounts(amount, nextNet),
                    }) });
                  }
                }} />
              </DraftCell>
              <DraftCell label="Нетто">
                {row.unitType === 'count' ? <output aria-label={`Нетто ${row.name}`} className="block py-2 tabular-nums text-text-secondary">
                  {netGrams == null ? (pieceNet == null ? '—' : qty(pieceNet, unitLabel(row.unit))) : <>
                    <span className="whitespace-nowrap">{recipeQuantity(netGrams, 'г')}</span>
                    {pieceNet != null && <span className="block whitespace-nowrap text-xs text-text-muted">{qty(pieceNet, unitLabel(row.unit))}</span>}
                  </>}
                </output> : <QuantityInput label={`Нетто ${row.name}`} value={netAmount} invalid={invalidNet}
                  readOnly={processing && basis === 'gross'} onChange={(value) => {
                  if (!processing) {
                    const amount = row.amount || value || 0;
                    const netAmount = value ?? amount;
                    patch(index, { amount, netAmount, lossPercent: lossFromAmounts(amount, netAmount) });
                  } else patch(index, { processingBasis: basis, netAmount: value,
                    amount: processingQuantities(row.amount, value ?? 0, basis, retention).amount });
                }} />}
              </DraftCell>
              <DraftCell label="Потери, %" className={!processing && !legacyProcessing ? 'max-xl:hidden' : undefined}>
                <span className="block text-sm tabular-nums text-text-muted xl:pt-2">{processing && effectiveLoss != null
                  ? taxRateLabel(Number(effectiveLoss.toFixed(2))) : legacyProcessing ? taxRateLabel(loss) : '—'}</span>
              </DraftCell>
              <DraftCell label="Единица">
                <select aria-label={`Единица ${row.name}`} className="input h-10 w-full px-2" value={row.unit} onChange={(event) => {
                  const unit = event.target.value as UnitCode;
                  const factor = unitFactor(row.unit) / unitFactor(unit);
                  patch(index, { unit, amount: Number((row.amount * factor).toFixed(6)),
                    netAmount: row.netAmount == null ? row.netAmount : Number((row.netAmount * factor).toFixed(6)),
                    variantAmounts: Object.fromEntries(Object.entries(row.variantAmounts ?? {}).map(([id, value]) => [id, Number((value * factor).toFixed(6))])),
                  });
                }}>
                  {unitsForType(row.unitType).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </DraftCell>
              {showCosts && <DraftCell label="Себестоимость" className="max-xl:col-span-2 xl:whitespace-nowrap xl:text-right">
                <div className="font-medium tabular-nums xl:pt-2">{calculated?.lineCost == null ? '—' : money(calculated.lineCost)}</div>
                {calculated?.avgCost != null && <p className="text-xs text-text-muted">{money(calculated.avgCost)} / {unitLabel(row.unit)}</p>}
              </DraftCell>}
              <td className="max-xl:absolute max-xl:right-2 max-xl:top-2 xl:py-3 xl:pl-1">
                <button type="button" aria-label={`Убрать ${row.name}`} className="btn-ghost btn-md text-danger"
                  onClick={() => onChange(rows.filter((_, position) => position !== index))}>×</button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
    <div className={rows.length ? 'flex flex-wrap items-center gap-3' : 'flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-background p-4'}>
      {!rows.length && <p className="w-full text-sm text-text-muted">Добавьте ингредиенты, полуфабрикаты и расходники на одну порцию.</p>}
      <div className="w-full min-w-0 sm:max-w-sm">
        <Select searchable ariaLabel="Добавить компонент" placeholder="Добавить компонент…" className="h-11 w-full" value=""
          disabled={disabled || ingredients.isPending || ingredients.isError}
          onChange={(id) => { const selected = available.find((item) => item.id === id); if (selected) add(selected); }}
          options={available.map((item) => ({ value: item.id, label: `${item.name} · ${unitLabel(item.baseUnit ?? item.displayUnit)}` }))} />
      </div>
      {allowCreate && <button className="btn-ghost btn-md text-primary" type="button" disabled={disabled}
        onClick={() => setCreateIngredient(true)}>+ Новый ингредиент</button>}
      {rows.length > 0 && (output || showCosts) && <div className="flex w-full flex-wrap gap-x-4 gap-y-1 text-sm">
        {output && <span>Выход: <strong>{output}</strong></span>}
        {showCosts && <span>Стоимость состава: <strong>{preview.data?.compositionFoodCost == null
          ? preview.pending ? 'Расчёт…' : 'не рассчитана' : money(preview.data.compositionFoodCost)}</strong></span>}
      </div>}
    </div>
    {rows.length > 0 && <RecipeBatchPreview preview={preview.data} pending={preview.pending} showCosts={showCosts} />}
    {ingredients.error && <p role="alert" className="text-sm text-danger">{apiError(ingredients.error)}{' '}
      <button type="button" className="underline" onClick={() => void ingredients.refetch()}>Повторить</button></p>}
    {preview.error && <p role="alert" className="text-sm text-danger">{apiError(preview.error)}{' '}
      <button type="button" className="underline" onClick={() => void preview.retry()}>Повторить расчёт</button></p>}
    {showCosts && missingCosts.length > 0 && <p className="text-sm text-text-secondary">Нет данных о себестоимости: {missingCosts.join(', ')}.</p>}
    {createIngredient && <ItemCard compact defaultKind="raw" onClose={() => setCreateIngredient(false)} onSaved={add} />}
  </section>;
}
