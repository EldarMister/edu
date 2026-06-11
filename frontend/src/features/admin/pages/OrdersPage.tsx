import { useState } from 'react';
import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, paymentCell, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { IconEye, IconX } from '../components/icons';
import { CancelOrderModal } from '../components/CancelOrderModal';
import { OrderDetailsModal } from '../components/OrderDetailsModal';
import { useAdminOrders, useOrdersSummary, useCancelOrder, useStaff } from '../api';

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
  const [page, setPage] = useState(1);

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);

  const tr = useT();
  const push = useNotifications((s) => s.push);
  const cancelOrder = useCancelOrder();

  const waiters = useStaff('WAITER', '');
  const waiterOptions = [
    { value: '', label: tr('Все официанты') },
    ...(waiters.data ?? []).map((w) => ({ value: w.id, label: w.name })),
  ];

  const dateFilter = periodRange(period, customDate);
  const filters = { search, paymentMethod, waiterId, ...dateFilter };

  const ordersQ = useAdminOrders({ tab, page, ...filters });
  const summaryQ = useOrdersSummary(filters);
  const data = ordersQ.data;
  const s = summaryQ.data;

  // Любая смена фильтра сбрасывает страницу.
  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
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
        ) : !data || data.items.length === 0 ? (
          <p className="py-12 text-center text-text-muted">{tr('Заказы не найдены')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border bg-background/40 text-left text-xs text-text-muted">
                  <Th>{tr('№ заказа')}</Th>
                  <Th>{tr('Дата и время')}</Th>
                  <Th>{tr('Стол')}</Th>
                  <Th>{tr('Официант')}</Th>
                  <Th className="text-right">{tr('Сумма')}</Th>
                  <Th>{tr('Статус заказа')}</Th>
                  <Th>{tr('Способ оплаты')}</Th>
                  <Th className="text-right">{tr('Действия')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((ord) => (
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
                      {tr('Стол')} {ord.table.number}
                    </Td>
                    <Td className="text-text-secondary">{ord.waiter.name}</Td>
                    <Td className="text-right font-medium text-text-primary">{money(ord.finalAmount)}</Td>
                    <Td>
                      <OrderBadge status={ord.status} size="sm" />
                    </Td>
                    <Td className="whitespace-nowrap text-text-secondary">{paymentCell(ord)}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {CANCELLABLE.has(ord.status) ? (
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
                        ) : (
                          <button
                            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-background hover:text-primary"
                            title={tr('Детали заказа')}
                            aria-label={tr('Детали заказа')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailsOrder(ord);
                            }}
                          >
                            <IconEye className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Нижняя строка: пагинация (итоги уже показаны в сводке под заголовком) */}
        {data && data.items.length > 0 && data.pages > 1 && (
          <div className="flex justify-end border-t border-border px-4 py-2.5">
            <Pagination page={data.page} pages={data.pages} onChange={setPage} />
          </div>
        )}
      </div>

      <CancelOrderModal
        open={!!cancelTarget}
        orderLabel={
          cancelTarget
            ? `${tr('Заказ')} ${displayOrderNumber(cancelTarget.orderNumber)} · ${tr('Стол')} ${cancelTarget.table.number} · ${money(cancelTarget.finalAmount)}`
            : ''
        }
        submitting={cancelOrder.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
      <OrderDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />
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

/** Компактная пагинация: ‹ 1 2 3 … 5 › */
function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;

  const items: (number | '…')[] = [];
  const push = (n: number | '…') => items.push(n);
  const window = 1; // соседей с каждой стороны от текущей
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || (p >= page - window && p <= page + window)) push(p);
    else if (items[items.length - 1] !== '…') push('…');
  }

  const arrow = 'flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-text-secondary transition-colors hover:bg-background disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div className="flex items-center gap-1">
      <button className={arrow} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Назад">
        ‹
      </button>
      {items.map((it, i) =>
        it === '…' ? (
          <span key={`e${i}`} className="px-1 text-text-light">
            …
          </span>
        ) : (
          <button
            key={it}
            onClick={() => onChange(it)}
            className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 transition-colors ${
              it === page ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
            }`}
          >
            {it}
          </button>
        ),
      )}
      <button className={arrow} disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Вперёд">
        ›
      </button>
    </div>
  );
}
