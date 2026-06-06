import { useState } from 'react';
import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { Spinner } from '@/components/Spinner';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { StatCard, StatCardsRow } from '../components/StatCard';
import { IconOrders, IconClock, IconCheck, IconX } from '../components/icons';
import { CancelOrderModal } from '../components/CancelOrderModal';
import { useAdminOrders, useOrdersOverview, useCancelOrder } from '../api';

/** Заказ можно отменить, пока он не оплачен/не отменён/не отклонён. */
const CANCELLABLE = new Set(['draft', 'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready', 'picked_up', 'served', 'waiting_payment', 'partially_rejected']);

const TABS = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'paid', label: 'Оплаченные' },
  { key: 'cancelled', label: 'Отменённые' },
];

export function OrdersPage() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);

  const overview = useOrdersOverview();
  const ordersQ = useAdminOrders({ tab, search, page });
  const cancelOrder = useCancelOrder();
  const push = useNotifications((s) => s.push);
  const data = ordersQ.data;
  const tr = useT();

  function changeTab(t: string) {
    setTab(t);
    setPage(1);
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

  const o = overview.data;

  return (
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard label={tr('Заказов сегодня')} value={o?.ordersToday ?? '—'} icon={<IconOrders />} tone="primary" />
        <StatCard label={tr('Активных')} value={o?.activeCount ?? '—'} icon={<IconClock />} tone="warning" />
        <StatCard label={tr('Оплаченные')} value={o?.paidCount ?? '—'} icon={<IconCheck />} tone="success" />
        <StatCard label={tr('Отменённые')} value={o?.cancelledCount ?? '—'} icon={<IconX />} tone="danger" />
      </StatCardsRow>

      <div className="card overflow-hidden">
        {/* Вкладки + поиск */}
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => changeTab(t.key)}
                className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === t.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
                }`}
              >
                {tr(t.label)}
              </button>
            ))}
          </div>
          <input
            className="input h-10 sm:max-w-xs"
            placeholder={tr('Поиск по № или официанту')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {/* Таблица */}
        {ordersQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-12 text-center text-text-muted">{tr('Заказы не найдены')}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <Th>{tr('№ заказа')}</Th>
                    <Th>{tr('Дата и время')}</Th>
                    <Th>{tr('Стол')}</Th>
                    <Th>{tr('Официант')}</Th>
                    <Th className="text-right">{tr('Сумма')}</Th>
                    <Th>{tr('Статус')}</Th>
                    <Th className="text-right">{tr('Действия')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((ord) => (
                    <tr key={ord.id} className="border-b border-border last:border-0 hover:bg-background/60">
                      <Td className="font-medium text-text-primary">{displayOrderNumber(ord.orderNumber)}</Td>
                      <Td className="text-text-secondary">
                        {new Date(ord.createdAt).toLocaleDateString('ru-RU')} {timeHM(ord.createdAt)}
                      </Td>
                      <Td className="text-text-secondary">{tr('Стол')} {ord.table.number}</Td>
                      <Td className="text-text-secondary">{ord.waiter.name}</Td>
                      <Td className="text-right font-medium text-text-primary">{money(ord.finalAmount)}</Td>
                      <Td>
                        <OrderBadge status={ord.status} />
                      </Td>
                      <Td className="text-right">
                        {CANCELLABLE.has(ord.status) && (
                          <button
                            className="text-sm font-medium text-danger hover:underline"
                            onClick={() => setCancelTarget(ord)}
                          >
                            {tr('Отменить')}
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Пагинация */}
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
              <span className="text-text-muted">
                {tr('Всего')}: {data.total} · {data.page} / {data.pages}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn-secondary btn-md"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {tr('Назад')}
                </button>
                <button
                  className="btn-secondary btn-md"
                  disabled={page >= data.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {tr('Вперёд')}
                </button>
              </div>
            </div>
          </>
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
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
