import { useState } from 'react';
import { recipeQuantity } from './recipe-draft-values';

export function QuantityInput({ label, value, onChange, invalid = false, readOnly = false,
  disabled, precision = 6, placeholder = '0', autoFocus }: {
  label: string; value: number | null; onChange: (value: number | null) => void; invalid?: boolean;
  readOnly?: boolean; disabled?: boolean; precision?: 3 | 6; placeholder?: string; autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState<string>();
  const pattern = precision === 3 ? /^\d{0,11}(?:[,.]\d{0,3})?$/ : /^\d{0,11}(?:[,.]\d{0,6})?$/;
  return <input aria-label={label} aria-invalid={invalid || undefined}
    className={'input h-10 w-full min-w-0 tabular-nums' + (invalid ? ' !border-danger' : '')}
    type="text" inputMode="decimal" value={draft ?? value ?? ''} placeholder={placeholder} readOnly={readOnly} disabled={disabled}
    autoFocus={autoFocus}
    onBlur={() => setDraft(undefined)}
    onChange={(event) => {
      const text = event.target.value;
      if (!pattern.test(text)) return;
      setDraft(text);
      const normalized = text.replace(',', '.');
      if (normalized === '') onChange(null);
      else if (Number.isFinite(Number(normalized))) onChange(Number(normalized));
    }} />;
}

export function VolumeNetFields({ label, unit, grams, volume, invalidVolume, disabled, onGrams, onVolume }: {
  label: string; unit: string; grams: number | null; volume: number | null; invalidVolume?: boolean; disabled?: boolean;
  onGrams: (value: number | null) => void; onVolume: (value: number | null) => void;
}) {
  return <div className="min-w-24">
    <div className="flex items-center gap-1.5">
      <QuantityInput label={`${label}, г`} value={grams} onChange={onGrams} precision={3} placeholder="—" disabled={disabled} />
      <span className="shrink-0 text-xs text-text-muted">г</span>
    </div>
    <details className="mt-1 text-xs">
      <summary className={`cursor-pointer ${invalidVolume ? 'text-danger' : 'text-text-muted'}`}>
        {volume == null ? `Объём нетто, ${unit}` : `По объёму · ${recipeQuantity(volume, unit)}`}
      </summary>
      <div className="mt-1 flex items-center gap-1.5">
        <QuantityInput label={`${label}, ${unit}`} value={volume} onChange={onVolume} invalid={invalidVolume} disabled={disabled} />
        <span className="shrink-0 text-xs text-text-muted">{unit}</span>
      </div>
    </details>
  </div>;
}
