import { useState } from 'react';
import { apiError } from '@/lib/api';
import { Select } from '@/components/Select';
import { useT } from '@/lib/i18n';
import type { Order } from '@/types';
import { useUpdateOrderFulfillment } from './api';

export type OrderType = 'dine_in' | 'delivery' | 'pickup';
export type TerminalOrderType = Exclude<OrderType, 'pickup'>;
export const ORDER_TYPES = [
  { value: 'dine_in', label: 'В зале' },
  { value: 'delivery', label: 'Доставка' },
  { value: 'pickup', label: 'Самовывоз' },
] as const;
export const orderType = (source?: Order['source']): OrderType => source === 'delivery' || source === 'pickup' ? source : 'dine_in';
export const TERMINAL_ORDER_TYPES = ORDER_TYPES.filter((item) => item.value !== 'pickup');
export const orderTypeLabel = (value: OrderType) => ORDER_TYPES.find((item) => item.value === value)!.label;

export function OrderTypeSelect({ value, disabled, onChange }: {
  value: TerminalOrderType; disabled?: boolean; onChange: (type: TerminalOrderType) => void;
}) {
  const t = useT();
  return <div className="flex items-center gap-1.5 rounded-lg border border-border pl-2 text-text-secondary">
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {value === 'delivery' ? <path d="M2 5h13v12H2zM15 10h4l3 4v3h-7M6 17v3m12-3v3" />
        : <path d="M5 3v7m3-7v7m3-7v7a3 3 0 0 1-6 0m3 3v8m10 0V3c-3 3-4 7-4 10h4" />}
    </svg>
    <Select ariaLabel={t('Тип заказа')} value={value} className="h-8 w-auto border-0 px-1.5 text-xs"
      disabled={disabled} options={TERMINAL_ORDER_TYPES.map(({ value, label }) => ({ value, label: t(label) }))}
      onChange={(next) => { const option = TERMINAL_ORDER_TYPES.find(({ value }) => value === next); if (option) onChange(option.value); }} />
  </div>;
}

export function EditOrderFulfillment({ order, tables, onUpdated }: {
  order: Order;
  tables: { value: string; label: string }[];
  onUpdated: (order: Order) => void;
}) {
  const t = useT();
  const save = useUpdateOrderFulfillment();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TerminalOrderType>(() => order.source === 'delivery' ? 'delivery' : 'dine_in');
  const [tableId, setTableId] = useState(orderType(order.source) === 'dine_in' ? order.table.id : '');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(order.updatedAt);
  return <div className="mb-2">
    <button type="button" className="btn-secondary btn-sm" disabled={save.isPending} onClick={() => {
      if (!open) setVersion(order.updatedAt);
      setOpen(!open);
      setError('');
    }}>{t(open ? 'Отмена' : 'Изменить тип заказа')}</button>
    {open && <form className="mt-2 grid gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (!version || save.isPending) return;
      const problem = type === 'dine_in' && !tableId ? 'Выберите стол' : '';
      setError(problem);
      if (problem) return;
      save.mutate({ orderId: order.id, expectedUpdatedAt: version,
        ...(type === 'dine_in' ? { tableId } : { delivery: { type } }),
      }, {
        onSuccess: (updated) => { setOpen(false); onUpdated(updated); },
        onError: (reason) => setError(apiError(reason)),
      });
    }}>
      <div className="flex items-center gap-2">
        <OrderTypeSelect value={type} disabled={save.isPending} onChange={setType} />
        <button type="submit" className="btn-primary btn-sm" disabled={save.isPending}>{t('Сохранить')}</button>
      </div>
      {type === 'dine_in'
        ? <Select ariaLabel={t('Стол')} value={tableId} className="h-9" disabled={save.isPending}
            options={[{ value: '', label: t('Выберите стол') }, ...tables]} onChange={setTableId} />
        : null}
      {error && <p role="alert" className="text-sm text-danger">{t(error)}</p>}
    </form>}
  </div>;
}
