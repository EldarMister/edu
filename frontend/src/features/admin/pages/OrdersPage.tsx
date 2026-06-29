import { useEffect, useRef, useState } from 'react';
import type { Order, OrderStatus } from '@/types';
import { OrderStatusBadges } from '@/components/StatusBadge';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { displayOrderNumber, hallSuffix, money, paymentCell, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { IconEdit, IconX } from '../components/icons';
import { CancelOrderModal } from '../components/CancelOrderModal';
import { OrderDetailsModal } from '../components/OrderDetailsModal';
import { useAdminOrdersInfinite, useOrdersSummary, useCancelOrder, useStaff, useUpdateOrderStatus } from '../api';

/** Заказ можно отменить, пока он не оплачен/не отменён/не отклонён. */
const CANCELLABLE = new Set([
  'draft',
  'sent_to_kitchen',
  'accepted_by_kitchen',
  'cooking',
  'ready',
  'picked_up',
  'served',
  'waiting_payment',
  'partially_rejected',
]);

const STATUS_OPTIONS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'active', label: 'Не оплачен' },
  { value: 'cancelled', label: 'Отменён' },
];

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

const PAYMENT_OPTIONS = [
  { value: '', label: 'Все способы оплаты' },
  { value: 'cash', label: 'Наличные' },
  { value: 'qr', label: 'QR' },
  { value: 'mixed', label: 'Смешанная' },
  { value: 'card', label: 'Карта' },
];

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'За неделю' },
  { value: 'month', label: 'За месяц' },
  { value: 'custom', label: 'Выбрать дату' },
];

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

  const ordersQ = useAdminOrdersInfinite({ tab, ...filters });
  const summaryQ = useOrdersSummary(filters);
  const items = ordersQ.data?.pages.flatMap((p) => p.items) ?? [];
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

  // Смена фильтра — просто меняет queryKey, список перезагружается с начала.
  function reset<T>(setter: (v: T) => void) {
    return setter;
  }

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

  const ctrl = 'h-10 w-full text-sm';

  return (
    <div className="space-y-3">
      {/* Inline-сводка под заголовком */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
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

      {/* Панель фильтров в одну строку */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className={`${ctrl} sm:w-40`}
          value={tab}
          onChange={reset(setTab)}
          options={STATUS_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))}
        />
        <Select
          className={`${ctrl} sm:w-52`}
          value={paymentMethod}
          onChange={reset(setPaymentMethod)}
          options={PAYMENT_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))}
        />
        <Select
          className={`${ctrl} sm:w-48`}
          value={waiterId}
          onChange={reset(setWaiterId)}
          options={waiterOptions}
        />
        <Select
          className={`${ctrl} sm:w-40`}
          value={period}
          onChange={reset(setPeriod)}
          options={PERIOD_OPTIONS.map((o) => ({ ...o, label: tr(o.label) }))}
        />
        {period === 'custom' && (
          <input
            type="date"
            className="h-10 rounded-xl border border-border bg-white px-3 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={customDate}
            onChange={(e) => reset(setCustomDate)(e.target.value)}
          />
        )}
        <input
          className="h-10 flex-1 rounded-xl border border-border bg-white px-3.5 text-sm placeholder:text-text-light outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 sm:ml-auto sm:max-w-xs sm:flex-none"
          placeholder={tr('Поиск по заказам')}
          value={search}
          onChange={(e) => reset(setSearch)(e.target.value)}
        />
      </div>

      {/* Таблица заказов */}
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        {ordersQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : ordersError ? (
          <div className="px-4 py-12 text-center">
            <p className="font-medium text-danger">{tr('Не удалось загрузить заказы')}</p>
            <p className="mt-1 text-sm text-text-muted">{ordersError}</p>
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-text-muted">{tr('Заказы не найдены')}</p>
        ) : (
          <div ref={scrollRef} className="menu-scrollbar max-h-[calc(100vh-160px)] overflow-auto">
            <table className="w-full min-w-[860px] table-fixed text-sm">
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[16%]" />
                <col className="w-[8%]" />
                <col className="w-[14%]" />
                <col className="w-[9%]" />
                <col className="w-[22%]" />
                <col className="w-[12%]" />
                <col className="w-[76px]" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-background text-left text-xs text-text-muted">
                  <Th>{tr('№ заказа')}</Th>
                  <Th>{tr('Дата и время')}</Th>
                  <Th>{tr('Стол')}</Th>
                  <Th>{tr('Официант')}</Th>
                  <Th className="text-right">{tr('Сумма')}</Th>
                  <Th className="pl-4">{tr('Статус заказа')}</Th>
                  <Th>{tr('Способ оплаты')}</Th>
                  <Th className="px-1 text-center">{tr('Действия')}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((ord) => (
                  <tr
                    key={ord.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-background/60 focus-within:bg-background/60"
                    tabIndex={0}
                    role="button"
                    onClick={() => setDetailsOrder(ord)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailsOrder(ord);
                      }
                    }}
                  >
                    <Td className="font-medium text-text-primary">{displayOrderNumber(ord.orderNumber)}</Td>
                    <Td className="whitespace-nowrap text-text-secondary">
                      {new Date(ord.createdAt).toLocaleDateString('ru-RU')} {timeHM(ord.createdAt)}
                    </Td>
                    <Td className="text-text-secondary">
                      {tr('Стол')} {ord.table.number}{hallSuffix(ord.table)}
                    </Td>
                    <Td className="text-text-secondary">{ord.waiter?.name ?? 'QR menu'}</Td>
                    <Td className="text-right font-medium text-text-primary">{money(ord.finalAmount)}</Td>
                    <Td className="pl-4">
                      <OrderStatusBadges
                        order={ord}
                        size="sm"
                        className="flex flex-nowrap items-center justify-start gap-1"
                      />
                    </Td>
                    <Td className="whitespace-nowrap text-text-secondary">{paymentCell(ord)}</Td>
                    <Td className="px-1">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-primary/10 hover:text-primary"
                          title={tr('Изменить статус')}
                          aria-label={tr('Изменить статус')}
                          onClick={(e) => {
                            e.stopPropagation();
                            openStatusEditor(ord);
                          }}
                        >
                          <IconEdit className="h-4 w-4" />
                        </button>
                        {CANCELLABLE.has(ord.status) && (
                          <button
                            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                            title={tr('Отменить')}
                            aria-label={tr('Отменить')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCancelTarget(ord);
                            }}
                          >
                            <IconX className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Маяк бесконечной подгрузки + индикатор */}
            <div ref={loadMoreRef} />
            {isFetchingNextPage && (
              <div className="flex justify-center py-3 text-primary">
                <Spinner className="h-5 w-5" />
              </div>
            )}
            {!hasNextPage && (
              <p className="py-3 text-center text-xs text-text-light">{tr('Все заказы загружены')}</p>
            )}
          </div>
        )}
      </div>

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
      <OrderDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />
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
  return <span className="text-text-light">|</span>;
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
