import { useEffect, useId, useState, type FormEvent } from 'react';
import { DatePicker } from '@/components/DatePicker';
import { DocumentField } from './WarehouseUi';
import { inventoryLocalTime, inventoryTimingError, type InventoryTiming } from './inventory-time';

export function InventoryTimingFields({ value, onChange, onValidityChange, disabled = false, operationLabel }: {
  value: InventoryTiming;
  onChange: (value: InventoryTiming) => void;
  onValidityChange: (valid: boolean) => void;
  disabled?: boolean;
  operationLabel?: string;
}) {
  const id = useId();
  const [dateValid, setDateValid] = useState(true);
  const [date = '', time = ''] = value.local.split('T');
  const error = inventoryTimingError(value, undefined, !!operationLabel);
  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  useEffect(() => { onValidityChange(value.mode === 'current' || (dateValid && timeValid && !error)); }, [value.mode, dateValid, timeValid, error, onValidityChange]);
  const changeTime = (event: FormEvent<HTMLInputElement>) =>
    onChange({ ...value, local: `${date}T${event.currentTarget.value}` });
  return <>
    <DocumentField label={operationLabel ?? 'Проверка остатков'}>
      <div className="inventory-timing-mode" role="group" aria-label={operationLabel ?? 'Время проверки остатков'}>
        {([{ mode: 'current', label: 'На момент проведения' }, { mode: 'past', label: 'На указанную дату' }] as const).map((option) => <button key={option.mode} type="button" aria-pressed={value.mode === option.mode} disabled={disabled}
          onClick={() => onChange({ ...value, mode: option.mode })}>{option.label}</button>)}
      </div>
    </DocumentField>
    {value.mode === 'past' && <DocumentField label={operationLabel ? 'Дата и время операции' : 'Дата и время подсчёта'}>
      <div className="inventory-count-datetime">
        <DatePicker className="input h-9 w-full" containerClassName="min-w-0 flex-1" aria-label={operationLabel ? 'Дата складской операции' : 'Дата фактического подсчёта'} value={date} required max={inventoryLocalTime().slice(0, 10)} disabled={disabled}
          onValidityChange={setDateValid} onChange={(next) => onChange({ ...value, local: `${next}T${time}` })} />
        <input type="time" className="input h-9 w-28" aria-label={operationLabel ? 'Время складской операции' : 'Время фактического подсчёта'} aria-invalid={!timeValid || undefined} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} required disabled={disabled} value={time}
          onChange={changeTime} onInput={changeTime} />
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-text-muted">Время Бишкека. {operationLabel ? 'Документ изменит остатки и себестоимость с выбранного момента.' : 'Укажите момент, на который посчитали продукты.'}</p>
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </DocumentField>}
  </>;
}
