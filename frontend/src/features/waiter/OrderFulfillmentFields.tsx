import { useState } from 'react';
import { apiError } from '@/lib/api';
import { Select } from '@/components/Select';
import { useT } from '@/lib/i18n';
import type { Order } from '@/types';
import { useUpdateOrderFulfillment } from './api';

export type OrderType = 'dine_in' | 'delivery' | 'pickup';
export const ORDER_TYPES = [
  { value: 'dine_in', label: 'В зале' },
  { value: 'delivery', label: 'Доставка' },
  { value: 'pickup', label: 'Самовывоз' },
] as const;
export const orderType = (source?: Order['source']): OrderType => source === 'delivery' || source === 'pickup' ? source : 'dine_in';
export const orderTypeLabel = (value: OrderType) => ORDER_TYPES.find((item) => item.value === value)!.label;

export function OrderTypeSelect({ value, disabled, onChange }: {
  value: OrderType; disabled?: boolean; onChange: (type: OrderType) => void;
}) {
  const t = useT();
  return <div className="flex items-center gap-1.5 rounded-lg border border-border pl-2 text-text-secondary">
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {value === 'delivery' ? <path d="M2 5h13v12H2zM15 10h4l3 4v3h-7M6 17v3m12-3v3" />
        : value === 'pickup' ? <path d="M4 8h16l1 13H3zM8 9V6a4 4 0 0 1 8 0v3" />
          : <path d="M5 3v7m3-7v7m3-7v7a3 3 0 0 1-6 0m3 3v8m10 0V3c-3 3-4 7-4 10h4" />}
    </svg>
    <Select ariaLabel={t('Тип заказа')} value={value} className="h-8 w-auto border-0 px-1.5 text-xs"
      disabled={disabled} options={ORDER_TYPES.map(({ value, label }) => ({ value, label: t(label) }))}
      onChange={(next) => { const option = ORDER_TYPES.find(({ value }) => value === next); if (option) onChange(option.value); }} />
  </div>;
}

export const EMPTY_CUSTOMER = { customerName: '', customerPhone: '', deliveryAddress: '', deliveryFee: '', pickupTime: '' };
type Customer = typeof EMPTY_CUSTOMER;
export const moneyInput = (text: string) => Number(text.trim().replace(',', '.'));

export function customerOrderPayload(type: 'delivery' | 'pickup', fields: Customer) {
  return {
    type, customerName: fields.customerName.trim(), customerPhone: fields.customerPhone.trim(),
    ...(type === 'delivery'
      ? { deliveryAddress: fields.deliveryAddress.trim(), deliveryFee: moneyInput(fields.deliveryFee) }
      : { pickupTime: fields.pickupTime || undefined }),
  };
}

export function customerOrderError(type: 'delivery' | 'pickup', fields: Customer) {
  if (!/^\+?(?:[ ()-]*\d){6,15}[ ()-]*$/.test(fields.customerPhone.trim())) return 'Укажите корректный телефон клиента';
  if (type === 'delivery' && !fields.deliveryAddress.trim()) return 'Укажите адрес доставки';
  if (type === 'delivery' && (!/^\d{0,7}(?:[.,]\d{0,2})?$/.test(fields.deliveryFee.trim()) || !Number.isFinite(moneyInput(fields.deliveryFee)) || moneyInput(fields.deliveryFee) > 9_999_999)) return 'Укажите корректную стоимость доставки';
  if (type === 'pickup' && fields.pickupTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fields.pickupTime)) return 'Укажите время самовывоза в формате ЧЧ:ММ';
  return '';
}

export function OrderFulfillmentFields({ value, type, disabled, error, comment, onComment, onChange }: {
  value: Customer; type: 'delivery' | 'pickup'; disabled: boolean; error: string;
  comment: string; onComment: (value: string) => void; onChange: (value: Customer) => void;
}) {
  const t = useT();
  const input = (key: keyof Customer, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <input className="input h-9 w-full min-w-0 text-sm" aria-label={t(label)} placeholder={t(label)}
      value={value[key]} disabled={disabled} onChange={(event) => onChange({ ...value, [key]: event.target.value })} {...props} />;
  return <div className="mb-3 grid gap-2 rounded-lg border border-border p-2.5">
    {input('customerPhone', 'Телефон клиента', { type: 'tel', autoComplete: 'tel', maxLength: 40, required: true })}
    {input('customerName', 'Имя клиента', { autoComplete: 'name', maxLength: 120 })}
    {type === 'delivery' ? <>
      {input('deliveryAddress', 'Адрес доставки', { maxLength: 300, required: true })}
      {input('deliveryFee', 'Стоимость доставки', { inputMode: 'decimal', maxLength: 10 })}
    </> : <label className="grid gap-1 text-xs text-text-muted">
      {t('Время самовывоза')}{input('pickupTime', 'Время самовывоза', { type: 'time' })}
    </label>}
    <input className="input h-9 w-full text-sm" placeholder={t('Комментарий к заказу')} maxLength={500}
      value={comment} disabled={disabled} onChange={(event) => onComment(event.target.value)} />
    {error && <p role="alert" className="text-sm text-danger">{t(error)}</p>}
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
  const [type, setType] = useState(() => orderType(order.source));
  const [tableId, setTableId] = useState(orderType(order.source) === 'dine_in' ? order.table.id : '');
  const [fields, setFields] = useState({
    customerName: order.deliveryCustomerName ?? '', customerPhone: order.deliveryCustomerPhone ?? '',
    deliveryAddress: order.deliveryAddress ?? '', deliveryFee: order.deliveryFee ?? '', pickupTime: order.pickupTime ?? '',
  });
  const [comment, setComment] = useState(order.comment ?? '');
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
      const problem = type === 'dine_in' ? (tableId ? '' : 'Выберите стол') : customerOrderError(type, fields);
      setError(problem);
      if (problem) return;
      save.mutate({ orderId: order.id, expectedUpdatedAt: version, comment,
        ...(type === 'dine_in' ? { tableId } : { delivery: customerOrderPayload(type, fields) }),
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
        : <OrderFulfillmentFields value={fields} type={type} onChange={setFields} error="" disabled={save.isPending}
            comment={comment} onComment={setComment} />}
      {error && <p role="alert" className="text-sm text-danger">{t(error)}</p>}
    </form>}
  </div>;
}
