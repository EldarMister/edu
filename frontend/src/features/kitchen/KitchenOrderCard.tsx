import { useEffect, useState } from 'react';
import type { Order, OrderItemStatus } from '@/types';
import type { KitchenTab } from './api';
import { OrderBadge } from '@/components/StatusBadge';
import { displayOrderNumber, timeHM, elapsed, orderItemDisplayName } from '@/lib/format';
import { Spinner } from '@/components/Spinner';

/** Порог «долгого» ожидания, после которого таймер краснеет (сек). */
const SLOW_AFTER = 20 * 60;

const FINAL_ITEM_STATUSES: OrderItemStatus[] = ['rejected', 'cancelled', 'ready', 'served'];

export function KitchenOrderCard({
  order,
  tab,
  now,
  submitting,
  pendingItemIds,
  pendingType,
  onAccept,
  onBatch,
}: {
  order: Order;
  tab: KitchenTab;
  now: number;
  submitting: boolean;
  /** Блюда заказа с отложенным (ещё не подтверждённым) действием. */
  pendingItemIds: string[];
  pendingType: 'reject' | 'ready' | null;
  onAccept: () => void;
  onBatch: (type: 'reject' | 'ready', itemIds: string[]) => void;
}) {
  const waitSec = Math.floor((now - new Date(order.createdAt).getTime()) / 1000);
  const slow = waitSec > SLOW_AFTER && (tab === 'new' || tab === 'in_work');
  // Частичный отказ/ожидание решения — только если отказ есть среди позиций ЭТОЙ станции.
  // Станции независимы: отказ на баре не блокирует кухню и наоборот.
  const stationRejected = order.items.some((it) => it.status === 'rejected');
  const waitingDecision = order.requiresWaiterDecision && stationRejected;
  const canSelect = (tab === 'new' || tab === 'in_work') && !waitingDecision;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Блюдо можно выбрать, если оно ещё «живое» и по нему нет отложенного действия.
  const isSelectable = (status: OrderItemStatus, id: string) =>
    canSelect && !FINAL_ITEM_STATUSES.includes(status) && !pendingItemIds.includes(id);

  // Чистим выбор от позиций, которые стали невыбираемыми (обновление по сокету / отложенное действие).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => {
        const it = order.items.find((i) => i.id === id);
        return it && isSelectable(it.status, id);
      }));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.items, pendingItemIds]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function runBatch(type: 'reject' | 'ready') {
    if (selected.size === 0) return;
    onBatch(type, [...selected]);
    setSelected(new Set());
  }

  return (
    <div className="card flex flex-col p-4">
      {/* Шапка карточки */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight text-text-primary">{displayOrderNumber(order.orderNumber)}</p>
          <p className="mt-1 text-[13px] text-text-muted">Стол {order.table.number}</p>
        </div>
        <div className="text-right">
          <p className="text-[13px] text-text-muted">{timeHM(order.createdAt)}</p>
          {tab === 'new' || tab === 'in_work' ? (
            <p className={`text-[15px] font-semibold ${slow ? 'text-danger' : 'text-text-secondary'}`}>
              {elapsed(order.createdAt, now)}
            </p>
          ) : (
            <div className="mt-0.5">
              <OrderBadge status={order.status} />
            </div>
          )}
        </div>
      </div>

      <p className="mt-0.5 text-[13px] text-text-muted">Официант: {order.waiter.name}</p>

      {stationRejected && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
            Частичный отказ
          </span>
          {waitingDecision && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              Ожидает решения официанта
            </span>
          )}
        </div>
      )}

      {/* Позиции */}
      <ul className="mt-4 space-y-3 border-t border-border pt-4">
        {order.items.map((it) => {
          const pending = pendingItemIds.includes(it.id);
          const rejected = it.status === 'rejected' || (pending && pendingType === 'reject');
          const isReady =
            it.status === 'ready' || it.status === 'served' || (pending && pendingType === 'ready');
          const selectable = isSelectable(it.status, it.id);
          const itemName = orderItemDisplayName(it);
          const setParts = it.setComponents ?? [];
          return (
            <li key={it.id} className="text-[15px]">
              <label className={`flex items-center gap-3 ${selectable ? 'cursor-pointer' : ''}`}>
                {canSelect && (
                  selectable ? (
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      className="h-[22px] w-[22px] shrink-0 cursor-pointer rounded-[6px] border-border accent-primary"
                    />
                  ) : (
                    <span className="h-[22px] w-[22px] shrink-0" />
                  )
                )}
                <span
                  className={`min-w-0 flex-1 ${
                    rejected ? 'text-danger line-through' : isReady ? 'text-text-muted' : 'text-text-primary'
                  }`}
                >
                  <span className="font-semibold">{it.quantity}×</span> {itemName}
                  {it.comment && <span className="text-warning font-medium"> · {it.comment}</span>}
                </span>
                {isReady && <span className="shrink-0 text-[13px] font-bold text-green-600">✓ Готово</span>}
                {rejected && <span className="shrink-0 text-[13px] font-bold text-danger">Отказ</span>}
              </label>
              {setParts.length > 0 && (
                <ul className={`mt-1.5 space-y-1 text-[13.5px] ${canSelect ? 'pl-8' : 'pl-3'}`}>
                  {setParts.map((sc) => (
                    <li
                      key={sc.id}
                      className={sc.action === 'removed' ? 'text-danger font-medium' : 'text-text-muted'}
                    >
                      {sc.action === 'replaced'
                        ? `Замена: ${sc.originalNameSnapshot} → ${sc.finalNameSnapshot}`
                        : sc.action === 'removed'
                          ? `Без ${sc.originalNameSnapshot}`
                          : `• ${sc.originalNameSnapshot}`}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {order.comment && (
        <p className="mt-2.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[13px] text-warning">{order.comment}</p>
      )}

      {waitingDecision && (
        <div className="mt-3 rounded-lg border border-warning/20 bg-warning/10 px-2.5 py-1.5 text-[13px] text-warning">
          Ожидаем решение официанта по частичному отказу
        </div>
      )}

      {/* Блок действий по выбранным блюдам */}
      {canSelect && selected.size > 0 && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border pt-3">
            <span className="text-[13px] font-medium text-text-secondary">Выбрано: {selected.size}</span>
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={() => runBatch('reject')}
                className="btn-danger h-8 rounded-lg px-2.5 text-[13px] font-semibold"
              >
                Отказать выбранные
              </button>
              {tab === 'in_work' && (
                <button
                  onClick={() => runBatch('ready')}
                  className="btn-primary h-8 rounded-lg px-2.5 text-[13px] font-semibold"
                >
                  Готово выбранные
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="mt-2 self-start text-[12px] font-medium text-primary hover:text-primary-hover"
          >
            Снять выбор
          </button>
        </>
      )}

      {/* «Принять» — кухня начинает работу, заказ уходит в «В работе». */}
      {tab === 'new' && !waitingDecision && (
        <button
          className="btn-primary btn-md mt-3 w-full font-semibold"
          disabled={submitting}
          onClick={onAccept}
        >
          {submitting ? <Spinner /> : 'Принять в работу'}
        </button>
      )}
    </div>
  );
}
