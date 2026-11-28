import { useId, useRef, useState, type ReactNode } from 'react';
import { Select, type SelectOption } from '@/components/Select';
import { useT } from '@/lib/i18n';
import { IconX } from './icons';
import { ORDER_TYPES } from '@/features/waiter/OrderFulfillmentFields';

export type OrderSort = 'default' | 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'active', label: 'Не оплачен' },
  { value: 'cancelled', label: 'Отменён' },
];

const PAYMENT_OPTIONS = [
  { value: '', label: 'Все способы оплаты' },
  { value: 'cash', label: 'Наличные' },
  { value: 'qr', label: 'QR' },
  { value: 'mixed', label: 'Смешанная' },
  { value: 'card', label: 'Карта' },
];

const COMMENT_OPTIONS = [
  { value: '', label: 'Комментарии' },
  { value: 'with', label: 'С комментарием' },
  { value: 'without', label: 'Без комментария' },
];

export function normalizeOrderPaymentMethod(value: string) {
  return PAYMENT_OPTIONS.some((option) => option.value === value) ? value : '';
}

const SORT_OPTIONS: { value: OrderSort; label: string }[] = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'date_desc', label: 'Дата: новые → старые' },
  { value: 'date_asc', label: 'Дата: старые → новые' },
  { value: 'amount_desc', label: 'Сумма: больше → меньше' },
  { value: 'amount_asc', label: 'Сумма: меньше → больше' },
];

type Props = {
  periodFilter: ReactNode;
  orderType: string;
  onOrderTypeChange: (value: string) => void;
  tab: string;
  paymentMethod: string;
  waiterId: string;
  comments: string;
  waiterOptions: SelectOption[];
  sort: OrderSort;
  search: string;
  onTabChange: (value: string) => void;
  onPaymentMethodChange: (value: string) => void;
  onWaiterChange: (value: string) => void;
  onCommentsChange: (value: string) => void;
  onSortChange: (value: OrderSort) => void;
  onSearchChange: (value: string) => void;
};

export function OrdersFilters(props: Props) {
  const tr = useT();
  const ctrl = 'orders-filter-control';
  const advancedId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeCount = [props.orderType, props.paymentMethod, props.waiterId, props.comments, props.sort !== 'default'].filter(Boolean).length;
  return (
    <div className="orders-filters">
      <div className="orders-period-filter">{props.periodFilter}</div>
      <Select className={`${ctrl} orders-status-select`} ariaLabel={tr('Статус заказа')} value={props.tab} onChange={props.onTabChange} options={STATUS_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />
      <button type="button" className={`${ctrl} orders-more-filters`} aria-expanded={advancedOpen}
        aria-controls={advancedId} onClick={() => setAdvancedOpen((open) => !open)}>
        <span>{tr('Фильтры')}{activeCount > 0 && ` (${activeCount})`}</span>
        <svg aria-hidden="true" className={advancedOpen ? 'rotate-180' : ''} width="16" height="16"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <OrdersSearchField value={props.search} onChange={props.onSearchChange} />
      <div id={advancedId} className="orders-extra-filters" hidden={!advancedOpen}>
        <Select className={ctrl} ariaLabel={tr('Тип заказа')} value={props.orderType} onChange={props.onOrderTypeChange}
          options={[{ value: '', label: tr('Все типы заказов') }, ...ORDER_TYPES.map(({ value, label }) => ({ value, label: tr(label) }))]} />
        <Select className={`${ctrl} orders-payment-select`} ariaLabel={tr('Способ оплаты')} value={props.paymentMethod} onChange={props.onPaymentMethodChange} options={PAYMENT_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />
        <Select className={`${ctrl} orders-waiter-select`} ariaLabel={tr('Официант')} value={props.waiterId} onChange={props.onWaiterChange} options={props.waiterOptions} />
        <Select className={`${ctrl} orders-comment-select`} ariaLabel={tr('Комментарии к чекам')} value={props.comments} onChange={props.onCommentsChange} options={COMMENT_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))} />
        <Select className={`${ctrl} orders-sort-select`} value={props.sort} onChange={(value) => props.onSortChange(value as OrderSort)} options={SORT_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))} />
      </div>
    </div>
  );
}

function OrdersSearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const tr = useT();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`orders-search-wrap${value ? ' has-value' : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input ref={input} type="search" className="orders-filter-control orders-search-input" placeholder={tr('Номер чека, блюдо или сотрудник')}
        aria-label={tr('Поиск по заказам')} value={value} onChange={(event) => onChange(event.target.value)} />
      {value && <button type="button" className="orders-search-clear" aria-label={tr('Очистить поиск')} onClick={() => {
        onChange('');
        input.current?.focus();
      }}><IconX className="h-4 w-4" aria-hidden="true" /></button>}
    </div>
  );
}
