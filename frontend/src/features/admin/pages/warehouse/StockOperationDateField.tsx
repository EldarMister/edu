import { useEffect, useState } from 'react';
import { DateTimePicker } from '@/components/DatePicker';
import { DocumentField } from './WarehouseUi';
import { inventoryTimingError, type InventoryTiming } from './inventory-time';

/** Ordinary documents have one operation date; the two count modes belong to inventory only. */
export function StockOperationDateField({ label, value, onChange, onValidityChange, disabled = false }: {
  label: string;
  value: InventoryTiming;
  onChange: (value: InventoryTiming) => void;
  onValidityChange: (valid: boolean) => void;
  disabled?: boolean;
}) {
  const [dateValid, setDateValid] = useState(true);
  const error = inventoryTimingError(value, undefined, true);
  useEffect(() => onValidityChange(dateValid && !error), [dateValid, error, onValidityChange]);
  return <DocumentField label={label}>
    <div className="w-[250px] max-w-full">
      <DateTimePicker aria-label={label} className="input h-9" value={value.local} required disabled={disabled}
        onValidityChange={setDateValid} onChange={(local) => onChange({ mode: 'past', local })} />
    </div>
    <p className="mt-1 text-xs text-text-muted">Время Бишкека{value.mode === 'current' ? ' · при сохранении' : ''}</p>
    {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
  </DocumentField>;
}
