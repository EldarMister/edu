import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Order, OrderItemStatus, OrderSetComponent } from '@/types';
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
  onBatch: (
    type: 'reject' | 'ready',
    ids: { itemIds: string[]; setComponentIds: string[] },
  ) => void;
}) {
  const waitSec = Math.floor((now - new Date(order.createdAt).getTime()) / 1000);
  const slow = waitSec > SLOW_AFTER && (tab === 'new' || tab === 'in_work');
  // Частичный отказ/ожидание решения — только если отказ есть среди позиций ЭТОЙ станции.
  // Станции независимы: отказ на баре не блокирует кухню и наоборот.
  const stationRejected = order.items.some((it) => it.status === 'rejected');
  const waitingDecision = order.requiresWaiterDecision && stationRejected;
  const canSelect = (tab === 'new' || tab === 'in_work') && !waitingDecision;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Карта статусов по id — и обычные позиции, и блюда внутри сетов.
  // id блюд состава нужны, чтобы при отправке разделить их от обычных позиций.
  const { statusById, componentIds } = useMemo(() => {
    const statusById = new Map<string, OrderItemStatus>();
    const componentIds = new Set<string>();
    for (const it of order.items) {
      statusById.set(it.id, it.status);
      for (const sc of it.setComponents ?? []) {
        statusById.set(sc.id, sc.status);
        componentIds.add(sc.id);
      }
    }
    return { statusById, componentIds };
  }, [order.items]);

  // Позицию можно выбрать, если она ещё «живая» и по ней нет отложенного действия.
  const isSelectable = (status: OrderItemStatus, id: string) =>
    canSelect && !FINAL_ITEM_STATUSES.includes(status) && !pendingItemIds.includes(id);

  // Чистим выбор от позиций, которые стали невыбираемыми (обновление по сокету / отложенное действие).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(
        [...prev].filter((id) => {
          const status = statusById.get(id);
          return status !== undefined && isSelectable(status, id);
        }),
      );
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusById, pendingItemIds]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function runBatch(type: 'reject' | 'ready') {
    if (selected.size === 0) return;
    const itemIds: string[] = [];
    const setComponentIds: string[] = [];
    for (const id of selected) (componentIds.has(id) ? setComponentIds : itemIds).push(id);
    onBatch(type, { itemIds, setComponentIds });
    setSelected(new Set());
  }

  // Все ещё «живые» позиции станции (для действий по всему заказу).
  // У сета берём его блюда состава, у обычного блюда — саму позицию.
  function collectAllActive(): { itemIds: string[]; setComponentIds: string[] } {
    const itemIds: string[] = [];
    const setComponentIds: string[] = [];
    for (const it of order.items) {
      const setParts = it.setComponents ?? [];
      if (setParts.length > 0) {
        for (const sc of setParts) {
          if (isSelectable(sc.status, sc.id)) setComponentIds.push(sc.id);
        }
      } else if (isSelectable(it.status, it.id)) {
        itemIds.push(it.id);
      }
    }
    return { itemIds, setComponentIds };
  }

  /** Действие по всему заказу (отмена/готово целиком) — переиспользует ту же логику onBatch. */
  function runWhole(type: 'reject' | 'ready') {
    const ids = collectAllActive();
    if (ids.itemIds.length === 0 && ids.setComponentIds.length === 0) return;
    onBatch(type, ids);
    setSelected(new Set());
  }

  /**
   * Подпись блюда состава сета для кухни (с вариантом, например «Coca-Cola 1 л»).
   * Для замены показываем наглядно: старое блюдо зачёркнуто → новое выделено.
   */
  const componentLabel = (sc: OrderSetComponent): ReactNode => {
    const orig = sc.originalVariantNameSnapshot
      ? `${sc.originalNameSnapshot} ${sc.originalVariantNameSnapshot}`
      : sc.originalNameSnapshot;
    if (sc.action !== 'replaced') return orig;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-text-muted line-through">{orig}</span>
        <ArrowRightIcon />
        <span className="font-semibold text-primary">{sc.finalNameSnapshot}</span>
      </span>
    );
  };

  // Единая строка позиции — и для обычных блюд, и для блюд внутри сета.
  // Сам сет — контейнер (container), его нельзя выбрать целиком: действия идут по составу.
  function renderLine(
    id: string,
    status: OrderItemStatus,
    content: ReactNode,
    opts?: { container?: boolean },
  ) {
    const selectable = !opts?.container && isSelectable(status, id);
    const pending = pendingItemIds.includes(id);
    const rejected = status === 'rejected' || (pending && pendingType === 'reject');
    const isReady = status === 'ready' || status === 'served' || (pending && pendingType === 'ready');
    // Заказ уже в работе, а позиция всё ещё «new» — значит её добавили/заменили при
    // редактировании. Подсвечиваем, чтобы повар видел, какое блюдо изменилось.
    const isFresh = tab === 'in_work' && status === 'new' && !opts?.container && !pending;
    return (
      <div
        className={`flex items-center gap-3 ${selectable ? 'cursor-pointer' : ''}`}
        onClick={() => {
          if (selectable) toggle(id);
        }}
      >
        {canSelect && selectable && selected.has(id) && (
          <input
            type="checkbox"
            checked={true}
            readOnly
            className="h-[22px] w-[22px] shrink-0 cursor-pointer rounded-[6px] border-border accent-primary pointer-events-none"
          />
        )}
        <span
          className={`min-w-0 flex-1 ${
            rejected ? 'text-danger line-through' : isReady ? 'text-text-muted' : isFresh ? 'font-semibold text-primary' : 'text-text-primary'
          }`}
        >
          {content}
        </span>
        {isFresh && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Новое
          </span>
        )}
        {isReady && <span className="shrink-0 text-[13px] font-bold text-green-600">✓ Готово</span>}
        {rejected && <span className="shrink-0 text-[13px] font-bold text-danger">Отказ</span>}
      </div>
    );
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
          const itemName = orderItemDisplayName(it);
          const setParts = it.setComponents ?? [];
          const isSet = setParts.length > 0;
          const header = (
            <>
              <span className="font-semibold">{it.quantity}×</span> {itemName}
              {it.comment && <span className="text-warning font-medium"> · {it.comment}</span>}
            </>
          );
          return (
            <li key={it.id} className="text-[15px]">
              {/* Обычное блюдо — выбираемая строка. Сет — заголовок-контейнер. */}
              {renderLine(it.id, it.status, header, { container: isSet })}
              {isSet && (
                <ul className="mt-1.5 space-y-1.5 pl-3 text-[14px]">
                  {setParts.map((sc) =>
                    sc.action === 'removed' ? (
                      <li key={sc.id} className="flex flex-wrap items-center gap-1.5 font-medium text-danger">
                        <span className="line-through">{sc.originalNameSnapshot}</span>
                        <span className="text-[12px]">— убрали</span>
                      </li>
                    ) : (
                      // Каждое блюдо внутри сета — отдельная выбираемая позиция.
                      <li key={sc.id}>{renderLine(sc.id, sc.status, componentLabel(sc))}</li>
                    ),
                  )}
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

      {/* Действия. Выбраны блюда чекбоксами → действия по выбранным.
          Ничего не выбрано → действия по всему заказу (отмена + принять/готово). */}
      {canSelect && selected.size > 0 ? (
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
      ) : canSelect ? (
        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <button
            onClick={() => runWhole('reject')}
            disabled={submitting}
            className="btn-danger btn-md flex-1 font-semibold"
          >
            Отменить заказ
          </button>
          {tab === 'new' ? (
            <button
              className="btn-primary btn-md flex-1 font-semibold"
              disabled={submitting}
              onClick={onAccept}
            >
              {submitting ? <Spinner /> : 'Принять в работу'}
            </button>
          ) : (
            <button
              onClick={() => runWhole('ready')}
              disabled={submitting}
              className="btn-primary btn-md flex-1 font-semibold"
            >
              Готово
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Стрелка «заменили на» для наглядной замены блюда в составе сета. */
function ArrowRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-text-light"
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
