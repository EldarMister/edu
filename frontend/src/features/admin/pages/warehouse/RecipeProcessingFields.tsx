import { useState } from 'react';
import { PROCESSING_METHODS, type Ingredient, type ProcessingBasis, type ProcessingMethod, type ProcessingStage, type RecipeRowInput } from './api';
import { MAX_PROCESSING_STAGES, MIN_STAGE_LOSS, displayedProcessingStages, recipeQuantity } from './recipe-draft-values';

export function recipeProcessingLabel(item: Pick<RecipeRowInput, 'processingStages' | 'processingMethod' | 'lossPercent'>) {
  const stages = displayedProcessingStages(item);
  return stages.map(({ method }) => PROCESSING_METHODS.find(({ value }) => value === method)?.label ?? method).join(' → ');
}

function StagePercent({ stage, label, disabled, onChange }: {
  stage: ProcessingStage; label: string; disabled?: boolean; onChange: (loss: number) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const invalid = stage.lossPercent < MIN_STAGE_LOSS || stage.lossPercent > 100;
  return <input aria-label={label} aria-invalid={invalid || undefined} disabled={disabled}
    className={`input h-9 w-20 shrink-0 px-2 tabular-nums ${invalid ? '!border-danger' : ''}`}
    value={draft ?? stage.lossPercent} onBlur={() => setDraft(undefined)} onChange={(event) => {
      const text = event.target.value;
      if (!/^-?\d{0,3}([,.]\d{0,2})?$/.test(text)) return;
      setDraft(text);
      if (text === '') onChange(0);
      else if (Number.isFinite(Number(text.replace(',', '.')))) onChange(Number(text.replace(',', '.')));
    }} />;
}

export function RecipeProcessingFields({ label, basis, stages, gross, unit, defaults, disabled, onBasis, onStages }: {
  label: string;
  basis: ProcessingBasis;
  stages: readonly ProcessingStage[];
  gross: number;
  unit: string;
  defaults?: Ingredient['processingLosses'];
  disabled?: boolean;
  onBasis: (basis: ProcessingBasis) => void;
  onStages: (stages: ProcessingStage[]) => void;
}) {
  function selectStage(method: ProcessingMethod): ProcessingStage {
    return { method, lossPercent: defaults?.[method] ?? 0 };
  }
  let input = gross;
  return <div className="min-w-0 space-y-1.5 xl:min-w-40">
    {stages.map((stage, index) => {
      const output = input * (1 - stage.lossPercent / 100);
      const previous = input;
      input = output;
      return <div key={index} className="space-y-1">
        <div className="flex items-center gap-1">
          <select aria-label={`${label}, этап ${index + 1}`} value={stage.method} disabled={disabled}
            className="input h-9 min-w-0 flex-1 px-1"
            onChange={(event) => onStages(stages.map((item, position) => position === index
              ? selectStage(event.target.value as ProcessingMethod) : item))}>
            {PROCESSING_METHODS.map(({ value, label: name }) => <option key={value} value={value}>{name}</option>)}
          </select>
          <StagePercent stage={stage} label={`${label}, потери этапа ${index + 1}, %`} disabled={disabled}
            onChange={(lossPercent) => onStages(stages.map((item, position) => position === index ? { ...item, lossPercent } : item))} />
          <button type="button" className="btn-ghost h-9 shrink-0 px-1 text-danger" disabled={disabled}
            aria-label={`${label}, удалить этап ${index + 1}`} onClick={() => onStages(stages.filter((_, position) => position !== index))}>×</button>
        </div>
        {previous > 0 && output >= 0 && <p className="text-xs text-text-muted">{recipeQuantity(previous, unit)} → {recipeQuantity(output, unit)}</p>}
      </div>;
    })}
    {stages.length < MAX_PROCESSING_STAGES && <select aria-label={stages.length ? `${label}, добавить этап` : label}
      className="input h-9 w-full min-w-0 px-2 text-sm" disabled={disabled} value=""
      onChange={(event) => { if (event.target.value) onStages([...stages, selectStage(event.target.value as ProcessingMethod)]); }}>
      <option value="">{stages.length ? 'Добавить этап…' : 'Без обработки'}</option>
      {PROCESSING_METHODS.map(({ value, label: name }) => <option key={value} value={value}>{name}</option>)}
    </select>}
    {stages.length > 0 && <p className="text-xs text-text-muted">Потери, %. Отрицательное значение увеличивает вес.</p>}
    <select aria-label={`Основа расчёта: ${label}`} className="w-full bg-transparent text-xs text-text-secondary"
      value={basis} disabled={disabled} onChange={(event) => onBasis(event.target.value as ProcessingBasis)}>
      <option value="gross">Расчёт от брутто</option>
      <option value="net">Расчёт от нетто</option>
      <option value="manual">Брутто и нетто вручную</option>
    </select>
  </div>;
}
