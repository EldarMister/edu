import { Select, type SelectOption } from '@/components/Select';
import { useT } from '@/lib/i18n';
import { OrdersDateFilter } from './OrdersDateFilter';

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

const SORT_OPTIONS: { value: OrderSort; label: string }[] = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'date_desc', label: 'Дата: новые → старые' },
  { value: 'date_asc', label: 'Дата: старые → новые' },
  { value: 'amount_desc', label: 'Сумма: больше → меньше' },
  { value: 'amount_asc', label: 'Сумма: меньше → больше' },
];

type Props = {
  tab: string;
  paymentMethod: string;
  waiterId: string;
  waiterOptions: SelectOption[];
  period: string;
  customDate: string;
  sort: OrderSort;
  search: string;
  onTabChange: (value: string) => void;
  onPaymentMethodChange: (value: string) => void;
  onWaiterChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  onCustomDateChange: (value: string) => void;
  onSortChange: (value: OrderSort) => void;
  onSearchChange: (value: string) => void;
};

export function OrdersFilters(props: Props) {
  const tr = useT();
  const ctrl = 'orders-filter-control';
  return (
    <div className="orders-filters">
      <Select className={`${ctrl} orders-status-select`} value={props.tab} onChange={props.onTabChange} options={STATUS_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />
      <Select className={`${ctrl} orders-payment-select`} value={props.paymentMethod} onChange={props.onPaymentMethodChange} options={PAYMENT_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))} />
      <Select className={`${ctrl} orders-waiter-select`} value={props.waiterId} onChange={props.onWaiterChange} options={props.waiterOptions} />
      <OrdersDateFilter period={props.period} date={props.customDate} onPeriodChange={props.onPeriodChange} onDateChange={props.onCustomDateChange} />
      <Select className={`${ctrl} orders-sort-select`} value={props.sort} onChange={(value) => props.onSortChange(value as OrderSort)} options={SORT_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))} />
      <OrdersSearchField value={props.search} onChange={props.onSearchChange} />
    </div>
  );
}

function OrdersSearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const tr = useT();
  return (
    <div className="orders-search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input className="orders-filter-control orders-search-input" placeholder={tr('Поиск по заказам')} aria-label={tr('Поиск по заказам')} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
