import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Order, OrderItemStatus, OrderSetComponent, OrderStatus } from '@/types';
import type { KitchenTab } from './api';
import { OrderBadge } from '@/components/StatusBadge';
import { displayOrderNumber, hallSuffix, timeHM, dateDM, elapsed, orderItemDisplayName } from '@/lib/format';
import { Spinner } from '@/components/Spinner';

/** Порог «долгого» ожидания, после которого таймер краснеет (сек). */
const SLOW_AFTER = 20 * 60;

const FINAL_ITEM_STATUSES: OrderItemStatus[] = ['rejected', 'cancelled', 'ready', 'served'];
const QR_ORDER_COMMENT = 'Заказ из QR-меню';

function kitchenCardBadgeStatus(order: Order, tab: KitchenTab): OrderStatus {
  if (tab !== 'ready' || order.status === 'paid') return order.status;

  const activeItems = order.items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');
  if (activeItems.length === 0) return order.status;
  if (activeItems.every((item) => item.status === 'served')) return 'served';
  if (activeItems.every((item) => item.status === 'ready' || item.status === 'served')) return 'ready';
  return order.status;
}

function isQrOrder(order: Order) {
  return order.source === 'qr' || order.comment?.trim() === QR_ORDER_COMMENT;
}

function kitchenItemComment(comment: string | null, qrOrder: boolean) {
  if (!comment) return null;
  const value = comment.trim();
  if (!qrOrder) return value;
  const withoutGuestPrefix = value.replace(/^Гость\s+\d+\s*·\s*/, '').trim();
  if (/^Гость\s+\d+$/.test(withoutGuestPrefix)) return null;
  return withoutGuestPrefix || null;
}

function kitchenOrderComment(comment: string | null, qrOrder: boolean) {
  if (!comment) return null;
  const value = comment.trim();
  if (qrOrder && value === QR_ORDER_COMMENT) return null;
  return value;
}

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
    ids: { itemIds: string[]; setComponentIds: string[]; partial?: { itemId: string; quantity: number }[] },
  ) => void;
}) {
  const waitSec = Math.floor((now - new Date(order.createdAt).getTime()) / 1000);
  const slow = waitSec > SLOW_AFTER && (tab === 'new' || tab === 'in_work');
  const badgeStatus = kitchenCardBadgeStatus(order, tab);
  const qrOrder = isQrOrder(order);
  const visibleOrderComment = kitchenOrderComment(order.comment, qrOrder);
  // Частичный отказ/ожидание решения — только если отказ есть среди позиций ЭТОЙ станции.
  // Станции независимы: отказ на баре не блокирует кухню и наоборот.
  const stationRejected = order.items.some((it) => it.status === 'rejected');
  const waitingDecision = order.requiresWaiterDecision && stationRejected;
  const canSelect = (tab === 'new' || tab === 'in_work') && !waitingDecision;

  // «С собой»: если все живые позиции навынос — бейдж на весь заказ, иначе помечаем точечно.
  const liveItems = order.items.filter((it) => it.status !== 'rejected' && it.status !== 'cancelled');
  const allTakeaway = liveItems.length > 0 && liveItems.every((it) => it.takeaway);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Сколько штук отказать у выбранной позиции (по умолчанию — всё количество).
  const [rejectQtys, setRejectQtys] = useState<Record<string, number>>({});
  // Свёрнутые сеты (по id позиции-сета): по умолчанию состав раскрыт.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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

  // Выбор/снятие всего сета сразу: добавляем или убираем все его выбираемые блюда.
  function toggleSet(ids: string[], allSelected: boolean) {
    if (ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) (allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }

  function runBatch(type: 'reject' | 'ready') {
    if (selected.size === 0) return;
    const itemIds: string[] = [];
    const setComponentIds: string[] = [];
    for (const id of selected) (componentIds.has(id) ? setComponentIds : itemIds).push(id);
    // Частичный отказ по количеству — только для обычных позиций и только при отказе.
    const partial: { itemId: string; quantity: number }[] = [];
    if (type === 'reject') {
      for (const id of itemIds) {
        const it = order.items.find((i) => i.id === id);
        if (!it) continue;
        const qty = rejectQtys[id] ?? it.quantity;
        if (qty > 0 && qty < it.quantity) partial.push({ itemId: id, quantity: qty });
      }
    }
    onBatch(type, { itemIds, setComponentIds, partial: partial.length > 0 ? partial : undefined });
    clearSelection();
  }

  function clearSelection() {
    setSelected(new Set());
    setRejectQtys({});
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
    clearSelection();
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
        <span className="font-semibold text-text-muted">&gt;</span>
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
    const checked = selected.has(id);
    const selectionMode = selected.size > 0;
    const body = (
      <>
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggle(id)}
            className="peer sr-only"
          />
        )}
        {selectable && selectionMode && (
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-slate-300 bg-white text-white transition-all duration-150 ease-out peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/25 group-hover:border-primary/70"
          >
            <svg
              width="13"
              height="10"
              viewBox="0 0 13 10"
              fill="none"
              className={`transition-opacity duration-150 ${checked ? 'opacity-100' : 'opacity-0'}`}
              aria-hidden="true"
            >
              <path
                d="M1.5 5.1 4.8 8.2 11.5 1.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
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
      </>
    );

    return selectable ? (
      <label className="group flex cursor-pointer items-center gap-2.5 rounded-lg transition-colors focus-within:bg-primary/5 active:bg-primary/5">
        {body}
      </label>
    ) : (
      <div className="flex items-center gap-2.5">
        {body}
      </div>
    );
  }

  return (
    <div className="card flex flex-col p-4">
      {/* Шапка карточки */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight text-text-primary">{displayOrderNumber(order.orderNumber)}</p>
          <p className="mt-1 text-[13px] text-text-muted">Стол {order.table.number}{hallSuffix(order.table)}</p>
          {qrOrder && (
            <p className="mt-2 inline-flex rounded-lg bg-warning/10 px-2.5 py-1 text-[12px] font-medium text-warning">
              {QR_ORDER_COMMENT}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[13px] text-text-muted">
            {/* Завершённые/отказанные показываем с датой — их смотрят позже. */}
            {tab === 'new' || tab === 'in_work' ? timeHM(order.createdAt) : `${dateDM(order.createdAt)} ${timeHM(order.createdAt)}`}
          </p>
          {tab === 'new' || tab === 'in_work' ? (
            <p className={`text-[15px] font-semibold ${slow ? 'text-danger' : 'text-text-secondary'}`}>
              {elapsed(order.createdAt, now)}
            </p>
          ) : (
            <div className="mt-0.5">
              <OrderBadge status={badgeStatus} />
            </div>
          )}
        </div>
      </div>

      {order.waiter && <p className="mt-0.5 text-[13px] text-text-muted">Официант: {order.waiter.name}</p>}

      {allTakeaway && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <TakeawayIcon /> Весь заказ с собой
          </span>
        </div>
      )}

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
          const itemComment = kitchenItemComment(it.comment, qrOrder);
          const setParts = it.setComponents ?? [];
          const isSet = setParts.length > 0;
          const header = (
            <>
              <span className="font-semibold">{it.quantity}×</span> {itemName}
              {itemComment && <span className="text-warning font-medium"> · {itemComment}</span>}
              {/* Точечная метка «с собой» — только если весь заказ не навынос. */}
              {it.takeaway && !allTakeaway && (
                <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-primary">
                  <TakeawayIcon /> с собой
                </span>
              )}
            </>
          );
          if (!isSet) {
            // Степпер «сколько отказать» — у выбранной обычной позиции с количеством > 1.
            const showStepper =
              tab !== 'ready' && selected.has(it.id) && it.quantity > 1 && isSelectable(it.status, it.id);
            const rejectQty = rejectQtys[it.id] ?? it.quantity;
            return (
              <li key={it.id} className="text-[15px]">
                {renderLine(it.id, it.status, header)}
                {showStepper && (
                  <div className="mt-1.5 flex items-center gap-2 pl-9 text-[13px] text-text-secondary">
                    <span>Отказать:</span>
                    <QtyStepper
                      value={rejectQty}
                      min={1}
                      max={it.quantity}
                      onChange={(v) => setRejectQtys((prev) => ({ ...prev, [it.id]: v }))}
                    />
                    <span className="text-text-muted">из {it.quantity}</span>
                  </div>
                )}
              </li>
            );
          }

          // Сет: заголовок выбирается целиком (вся начинка), рядом — стрелка
          // раскрытия/сворачивания состава.
          const setSelectableIds = setParts
            .filter((sc) => sc.action !== 'removed' && isSelectable(sc.status, sc.id))
            .map((sc) => sc.id);
          const setSelectable = canSelect && setSelectableIds.length > 0;
          const setAllSelected = setSelectableIds.length > 0 && setSelectableIds.every((id) => selected.has(id));
          const setSomeSelected = setSelectableIds.some((id) => selected.has(id));
          const isCollapsed = collapsed.has(it.id);
          return (
            <li key={it.id} className="text-[15px]">
              <div className="flex items-center gap-2.5">
                {setSelectable ? (
                  <label className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg transition-colors focus-within:bg-primary/5 active:bg-primary/5">
                    <input
                      type="checkbox"
                      checked={setAllSelected}
                      onChange={() => toggleSet(setSelectableIds, setAllSelected)}
                      className="peer sr-only"
                    />
                    {selected.size > 0 && (
                      <span
                        aria-hidden="true"
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border text-white transition-all duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-primary/25 ${
                          setAllSelected || setSomeSelected ? 'border-primary bg-primary' : 'border-slate-300 bg-white group-hover:border-primary/70'
                        }`}
                      >
                        {setAllSelected ? (
                          <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden="true">
                            <path d="M1.5 5.1 4.8 8.2 11.5 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : setSomeSelected ? (
                          <svg width="12" height="3" viewBox="0 0 12 3" fill="none" aria-hidden="true">
                            <path d="M1.5 1.5h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        ) : null}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 text-text-primary">{header}</span>
                  </label>
                ) : (
                  <span className="min-w-0 flex-1 text-text-primary">{header}</span>
                )}
                <button
                  type="button"
                  onClick={() => toggleCollapsed(it.id)}
                  aria-label={isCollapsed ? 'Раскрыть состав' : 'Свернуть состав'}
                  aria-expanded={!isCollapsed}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-background hover:text-text-secondary"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                    aria-hidden
                  >
                    <path d="m6 15 6-6 6 6" />
                  </svg>
                </button>
              </div>
              {!isCollapsed && (
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

      {visibleOrderComment && (
        <p className="mt-2.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[13px] text-warning">{visibleOrderComment}</p>
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
            onClick={clearSelection}
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

/** Степпер выбора количества (например, сколько штук отказать). */
function QtyStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const btn =
    'flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-white text-text-secondary transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-secondary';
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(clamp(value - 1))} aria-label="Меньше">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <span className="min-w-[1.5rem] text-center text-[14px] font-semibold text-text-primary">{value}</span>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(clamp(value + 1))} aria-label="Больше">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
    </span>
  );
}

/** Иконка пакета — метка «с собой» (навынос). */
function TakeawayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4Z" />
      <path d="M4 6h16M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
