import { Fragment, useRef, useState, type ReactNode } from 'react';
import { Select, type SelectOption } from '@/components/Select';
import { useT } from '@/lib/i18n';
import { useFilterPreference } from '@/hooks/useColumnPreference';
import { ColumnCheckbox, ColumnPopover } from './ColumnPopover';
import { IconSliders, IconX } from './icons';
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

export type OrderFilter = 'period' | 'status' | 'type' | 'payment' | 'waiter' | 'comments' | 'sort';

const DEFAULT_FILTERS: OrderFilter[] = ['period', 'status'];
const DEFAULT_FILTER_PREFERENCE = DEFAULT_FILTERS.join(',');

type Props = {
  scope: 'admin' | 'terminal';
  periodFilter: ReactNode;
  periodActive: boolean;
  onClearFilters: (filters: OrderFilter[]) => void;
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
  const title = tr('Отображать фильтры');
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [saved, save] = useFilterPreference(props.scope + '-orders', DEFAULT_FILTER_PREFERENCE);
  const preferred = saved.split(',');
  const filters: { key: OrderFilter; label: string; active: boolean; control: ReactNode }[] = [
    {
      key: 'period', label: 'Период', active: props.periodActive,
      control: <div className="orders-period-filter">{props.periodFilter}</div>,
    },
    {
      key: 'status', label: 'Статус заказа', active: props.tab !== 'all',
      control: <Select className={`${ctrl} orders-status-select`} ariaLabel={tr('Статус заказа')}
        value={props.tab} onChange={props.onTabChange} options={STATUS_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />,
    },
    {
      key: 'type', label: 'Тип заказа', active: !!props.orderType,
      control: <Select className={ctrl} ariaLabel={tr('Тип заказа')} value={props.orderType} onChange={props.onOrderTypeChange}
        options={[{ value: '', label: tr('Все типы заказов') }, ...ORDER_TYPES.map(({ value, label }) => ({ value, label: tr(label) }))]} />,
    },
    {
      key: 'payment', label: 'Способ оплаты', active: !!props.paymentMethod,
      control: <Select className={`${ctrl} orders-payment-select`} ariaLabel={tr('Способ оплаты')}
        value={props.paymentMethod} onChange={props.onPaymentMethodChange} options={PAYMENT_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />,
    },
    {
      key: 'waiter', label: 'Официант', active: !!props.waiterId,
      control: <Select className={`${ctrl} orders-waiter-select`} ariaLabel={tr('Официант')}
        value={props.waiterId} onChange={props.onWaiterChange} options={props.waiterOptions} />,
    },
    {
      key: 'comments', label: 'Комментарии к чекам', active: !!props.comments,
      control: <Select className={`${ctrl} orders-comment-select`} ariaLabel={tr('Комментарии к чекам')}
        value={props.comments} onChange={props.onCommentsChange} options={COMMENT_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />,
    },
    {
      key: 'sort', label: 'Сортировка', active: props.sort !== 'default',
      control: <Select className={`${ctrl} orders-sort-select`} ariaLabel={tr('Сортировка')}
        value={props.sort} onChange={(value) => props.onSortChange(value as OrderSort)} options={SORT_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />,
    },
  ];
  const visible = filters.filter(({ key, active }) => active || preferred.includes(key));

  function toggleFilter(key: OrderFilter, checked: boolean) {
    const keys = filters.filter((filter) => filter.key === key ? checked : preferred.includes(filter.key));
    save(keys.map((filter) => filter.key).join(','));
    if (!checked && filters.some((filter) => filter.key === key && filter.active)) props.onClearFilters([key]);
  }

  function resetVisibility() {
    save(DEFAULT_FILTER_PREFERENCE);
    const hidden = filters.filter(({ key, active }) => active && !DEFAULT_FILTERS.includes(key)).map(({ key }) => key);
    if (hidden.length) props.onClearFilters(hidden);
  }

  return (
    <div className="orders-filters">
      <button type="button" className="orders-filter-settings" title={title} aria-label={title}
        aria-haspopup="dialog" aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
        <IconSliders aria-hidden="true" />
      </button>
      {visible.map(({ key, control }) => <Fragment key={key}>{control}</Fragment>)}
      <OrdersSearchField value={props.search} onChange={props.onSearchChange} />
      {anchor && <ColumnPopover anchor={anchor} title={title} align="start" onClose={() => setAnchor(null)} onReset={resetVisibility}>
        {filters.map(({ key, active, label }) =>
          <ColumnCheckbox key={key} checked={active || preferred.includes(key)} onChange={(checked) => toggleFilter(key, checked)}>
            {tr(label)}
          </ColumnCheckbox>,
        )}
      </ColumnPopover>}
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
