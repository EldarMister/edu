import { useEffect, useRef, useState } from 'react';
import type { Order, OrderStatus } from '@/types';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { displayOrderNumber, hallSuffix, money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { OrdersFilters, type OrderSort } from '../components/OrdersFilters';
import { OrdersTable } from '../components/OrdersTable';
import { CancelOrderModal } from '../components/CancelOrderModal';
import { OrderDetailsModal } from '../components/OrderDetailsModal';
import { useAdminOrdersInfinite, useOrdersSummary, useCancelOrder, useStaff, useUpdateOrderStatus } from '../api';
import './orders-redesign.css';

const MANUAL_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'sent_to_kitchen', label: 'Активный' },
  { value: 'accepted_by_kitchen', label: 'Принят кухней' },
  { value: 'cooking', label: 'Готовится' },
  { value: 'ready', label: 'Готов' },
  { value: 'picked_up', label: 'Забран' },
  { value: 'served', label: 'Подан гостям' },
  { value: 'waiting_payment', label: 'Ожидает оплаты' },
  { value: 'cancelled', label: 'Отменён' },
];

function sortRequest(sort: OrderSort): { sort: 'default' | 'date' | 'amount'; sortDirection?: 'asc' | 'desc' } {
  if (sort.startsWith('date')) return { sort: 'date', sortDirection: sort.endsWith('_asc') ? 'asc' : 'desc' };
  if (sort.startsWith('amount')) return { sort: 'amount', sortDirection: sort.endsWith('_asc') ? 'asc' : 'desc' };
  return { sort: 'default' };
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Диапазон дат по выбранному периоду (неделя — 7 дней, месяц — 30 дней, как в статистике). */
function periodRange(period: string, customDate: string): { dateFrom?: string; dateTo?: string } {
  const today = new Date();
  const minus = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  switch (period) {
    case 'today':
      return { dateFrom: ymd(today), dateTo: ymd(today) };
    case 'week':
      return { dateFrom: ymd(minus(6)), dateTo: ymd(today) };
    case 'month':
      return { dateFrom: ymd(minus(29)), dateTo: ymd(today) };
    case 'custom':
      return customDate ? { dateFrom: customDate, dateTo: customDate } : {};
    default:
      return {};
  }
}

export function OrdersPage() {
  const [tab, setTab] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [waiterId, setWaiterId] = useState('');
  const [period, setPeriod] = useState('all');
  const [customDate, setCustomDate] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<OrderSort>('default');

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [statusTarget, setStatusTarget] = useState<Order | null>(null);
  const [manualStatus, setManualStatus] = useState<OrderStatus>('served');
  const [manualReason, setManualReason] = useState('');
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tr = useT();
  const push = useNotifications((s) => s.push);
  const cancelOrder = useCancelOrder();
  const updateStatus = useUpdateOrderStatus();

  const waiters = useStaff('WAITER', '');
  const waiterOptions = [
    { value: '', label: tr('Все официанты') },
    ...(waiters.data ?? []).map((w) => ({ value: w.id, label: w.name })),
  ];

  const dateFilter = periodRange(period, customDate);
  const filters = { search, paymentMethod, waiterId, ...dateFilter };
  const requestSort = sortRequest(sort);

  const ordersQ = useAdminOrdersInfinite({ tab, ...requestSort, ...filters });
  const summaryQ = useOrdersSummary(filters);
  const loadedItems = ordersQ.data?.pages.flatMap((p) => p.items) ?? [];
  const items =
    sort === 'default'
      ? loadedItems
      : [...loadedItems].sort((a, b) => {
          const comparison = sort.startsWith('date')
            ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            : Number(a.finalAmount) - Number(b.finalAmount);
          return sort.endsWith('_asc') ? comparison : -comparison;
        });
  const ordersError = ordersQ.isError ? apiError(ordersQ.error) : null;
  const s = summaryQ.data;

  // Бесконечная подгрузка: тянем следующую страницу, когда «маяк» внизу появляется в зоне видимости.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = ordersQ;
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      // root — сам прокручиваемый контейнер списка, иначе на телефоне «маяк»
      // не попадает во вьюпорт и автоподгрузка не срабатывает при скролле.
      { root: scrollRef.current, rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  async function confirmCancel(reason: string) {
    if (!cancelTarget) return;
    try {
      await cancelOrder.mutateAsync({ orderId: cancelTarget.id, reason });
      push({ message: 'Заказ отменён', type: 'success', at: new Date().toISOString() });
      setCancelTarget(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  function openStatusEditor(order: Order) {
    setStatusTarget(order);
    setManualStatus(order.status === 'paid' || order.status === 'rejected' ? 'waiting_payment' : order.status);
    setManualReason('');
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    try {
      await updateStatus.mutateAsync({
        orderId: statusTarget.id,
        status: manualStatus,
        reason: manualReason.trim() || undefined,
      });
      push({ message: 'Статус заказа изменён', type: 'success', at: new Date().toISOString() });
      setStatusTarget(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  return (
    <div className="orders-redesign">
      {/* Inline-сводка под заголовком */}
      <div className="orders-summary">
        <Sum label={tr('Всего заказов')} value={s ? s.total : '—'} />
        <Sep />
        <Sum label={tr('Оплачено')} value={s ? s.paid : '—'} />
        <Sep />
        <Sum label={tr('Не оплачено')} value={s ? s.unpaid : '—'} />
        <Sep />
        <Sum label={tr('Отменено')} value={s ? s.cancelled : '—'} />
        <Sep />
        <Sum label={tr('Выручка')} value={s ? money(s.revenue) : '—'} />
      </div>

      <OrdersFilters
        tab={tab}
        paymentMethod={paymentMethod}
        waiterId={waiterId}
        waiterOptions={waiterOptions}
        period={period}
        customDate={customDate}
        sort={sort}
        search={search}
        onTabChange={setTab}
        onPaymentMethodChange={setPaymentMethod}
        onWaiterChange={setWaiterId}
        onPeriodChange={setPeriod}
        onCustomDateChange={setCustomDate}
        onSortChange={setSort}
        onSearchChange={setSearch}
      />

      <OrdersTable
        items={items}
        isLoading={ordersQ.isLoading}
        error={ordersError}
        scrollRef={scrollRef}
        loadMoreRef={loadMoreRef}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        onOpen={setDetailsOrder}
        onEdit={openStatusEditor}
        onCancel={setCancelTarget}
      />
      <CancelOrderModal
        open={!!cancelTarget}
        orderLabel={
          cancelTarget
            ? `${tr('Заказ')} ${displayOrderNumber(cancelTarget.orderNumber)} · ${tr('Стол')} ${cancelTarget.table.number}${hallSuffix(cancelTarget.table)} · ${money(cancelTarget.finalAmount)}`
            : ''
        }
        submitting={cancelOrder.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
      <StatusEditorModal
        open={!!statusTarget}
        order={statusTarget}
        value={manualStatus}
        reason={manualReason}
        submitting={updateStatus.isPending}
        onValueChange={setManualStatus}
        onReasonChange={setManualReason}
        onClose={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />
      <OrderDetailsModal
        order={detailsOrder}
        onClose={() => setDetailsOrder(null)}
        onOrderChange={setDetailsOrder}
        allowItemCancellation
      />
    </div>
  );
}

function StatusEditorModal({
  open,
  order,
  value,
  reason,
  submitting,
  onValueChange,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  order: Order | null;
  value: OrderStatus;
  reason: string;
  submitting: boolean;
  onValueChange: (value: OrderStatus) => void;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tr = useT();
  if (!open || !order) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-white shadow-soft">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-semibold text-text-primary">{tr('Изменить статус заказа')}</h3>
          <p className="mt-0.5 text-sm text-text-muted">
            {displayOrderNumber(order.orderNumber)} · {tr('Стол')} {order.table.number}{hallSuffix(order.table)}
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <Select
            className="h-10 w-full text-sm"
            value={value}
            onChange={(next) => onValueChange(next as OrderStatus)}
            options={MANUAL_STATUS_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))}
          />
          <textarea
            className="min-h-[84px] w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            placeholder={tr('Причина изменения')}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            maxLength={240}
          />
          {order.status === 'cancelled' && value !== 'cancelled' && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              {tr('Отменённые позиции будут восстановлены в выбранный статус.')}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="h-10 rounded-xl border border-border bg-white px-4 text-sm text-text-secondary transition hover:border-primary/40 hover:text-text-primary"
            onClick={onClose}
            disabled={submitting}
          >
            {tr('Отмена')}
          </button>
          <button
            type="button"
            className="flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary-dark disabled:opacity-60"
            onClick={onConfirm}
            disabled={submitting || order.status === value}
          >
            {submitting ? <Spinner className="h-4 w-4" /> : tr('Сохранить')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Sum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span>
      {label}: <span className="font-medium text-text-primary">{value}</span>
    </span>
  );
}
function Sep() {
  return <span className="orders-summary-separator" aria-hidden="true" />;
}
