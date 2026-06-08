import type { Order } from '@/types';
import type { KitchenTab } from './api';
import { OrderBadge } from '@/components/StatusBadge';
import { displayOrderNumber, timeHM, elapsed, orderItemDisplayName } from '@/lib/format';
import { Spinner } from '@/components/Spinner';

/** Порог «долгого» ожидания, после которого таймер краснеет (сек). */
const SLOW_AFTER = 20 * 60;

export function KitchenOrderCard({
  order,
  tab,
  now,
  submitting,
  onAccept,
  onReady,
  onReadyItem,
  onRejectOrder,
  onRejectItem,
}: {
  order: Order;
  tab: KitchenTab;
  now: number;
  submitting: boolean;
  onAccept: () => void;
  onReady: () => void;
  onReadyItem: (itemId: string) => void;
  onRejectOrder: () => void;
  onRejectItem: (itemId: string, name: string) => void;
}) {
  const waitSec = Math.floor((now - new Date(order.createdAt).getTime()) / 1000);
  const slow = waitSec > SLOW_AFTER && (tab === 'new' || tab === 'in_work');
  const waitingDecision = order.status === 'partially_rejected' && order.requiresWaiterDecision;
  const canRejectItem = (tab === 'new' || tab === 'in_work') && !waitingDecision;

  const activeItemsCount = order.items.filter(it => it.status !== 'rejected' && it.status !== 'cancelled').length;
  const readyItemsCount = order.items.filter(it => it.status === 'ready' || it.status === 'served').length;

  return (
    <div className="card flex flex-col p-4">
      {/* Шапка карточки */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[17px] font-semibold text-text-primary">{displayOrderNumber(order.orderNumber)}</p>
          <p className="text-sm text-text-muted">Стол {order.table.number}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-text-muted">{timeHM(order.createdAt)}</p>
          {(tab === 'new' || tab === 'in_work') ? (
            <p className={`text-[15px] font-semibold ${slow ? 'text-danger' : 'text-text-secondary'}`}>
              {elapsed(order.createdAt, now)}
            </p>
          ) : (
            <OrderBadge status={order.status} />
          )}
        </div>
      </div>

      <p className="mt-1 text-sm text-text-muted">Официант: {order.waiter.name}</p>

      {tab === 'in_work' && (
        <p className="mt-1 text-sm font-medium text-text-primary">
          Готово: {readyItemsCount} из {activeItemsCount}
        </p>
      )}

      {order.status === 'partially_rejected' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
            Частичный отказ
          </span>
          {waitingDecision && (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
              Ожидает решения официанта
            </span>
          )}
        </div>
      )}

      {/* Позиции */}
      <ul className="mt-3 space-y-2 border-t border-border pt-3">
        {order.items.map((it) => {
          const rejected = it.status === 'rejected';
          const isReady = it.status === 'ready' || it.status === 'served';
          const itemName = orderItemDisplayName(it);
          return (
            <li key={it.id} className="flex items-start justify-between gap-3 text-[15px]">
              <div className="min-w-0">
                <span className={rejected ? 'text-danger line-through' : 'text-text-primary'}>
                  <span className="font-medium">{it.quantity}×</span> {itemName}
                </span>
                {it.comment && <p className="text-xs text-warning">{it.comment}</p>}
                {rejected && it.rejectReason && (
                  <p className="text-xs text-danger">Отказ: {it.rejectReason}</p>
                )}
                {waitingDecision && !rejected && (
                  <p className="text-xs text-text-muted">Ожидает решения официанта</p>
                )}
              </div>
              {canRejectItem && !rejected && !isReady && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => onRejectItem(it.id, itemName)}
                    className="text-xs font-medium text-danger hover:underline"
                  >
                    отказать
                  </button>
                  {tab === 'in_work' && (
                    <button
                      onClick={() => onReadyItem(it.id)}
                      className="rounded bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
                      disabled={submitting}
                    >
                      Готово
                    </button>
                  )}
                </div>
              )}
              {isReady && (
                <span className="shrink-0 text-sm font-semibold text-green-600">
                  ✓ Готово
                </span>
              )}
              {rejected && (
                <span className="shrink-0 text-sm font-medium text-danger">
                  Отказано
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {order.comment && (
        <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          {order.comment}
        </p>
      )}

      {waitingDecision && (
        <div className="mt-4 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
          Ожидаем решение официанта по частичному отказу
        </div>
      )}

      {/* Действия */}
      {tab === 'new' && !waitingDecision && (
        <div className="mt-4 flex gap-2">
          <button className="btn-danger btn-md flex-1" disabled={submitting} onClick={onRejectOrder}>
            Отказать
          </button>
          <button className="btn-primary btn-md flex-[2] font-semibold" disabled={submitting} onClick={onAccept}>
            {submitting ? <Spinner /> : 'Принять'}
          </button>
        </div>
      )}
      {tab === 'in_work' && !waitingDecision && (
        <div className="mt-4 flex gap-2">
          <button className="btn-danger btn-md flex-1" disabled={submitting} onClick={onRejectOrder}>
            Отказать
          </button>
          <button className="btn-primary btn-md flex-[2] font-semibold" disabled={submitting} onClick={onReady}>
            {submitting ? <Spinner /> : 'Готово'}
          </button>
        </div>
      )}
    </div>
  );
}
