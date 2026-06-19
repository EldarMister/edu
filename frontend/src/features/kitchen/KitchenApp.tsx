import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { Spinner } from '@/components/Spinner';
import { disconnectSocket } from '@/lib/socket';
import { usePushNotifications } from '@/lib/push';
import { useKitchenRealtime } from './useKitchenRealtime';
import type { PrepStation } from '@/types';
import { useKitchenOrders, useAccept, useReadyItems, useRejectItems, type KitchenTab } from './api';
import { KitchenOrderCard } from './KitchenOrderCard';
import { StopListDrawer } from './StopListDrawer';
import { KitchenVoiceSettings } from './KitchenVoiceSettings';

const TABS: { key: KitchenTab; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'in_work', label: 'В работе' },
  { key: 'ready', label: 'Завершенные' },
  { key: 'rejected', label: 'Отказанные' },
];

/** Сколько секунд показывается блок отмены, прежде чем действие уйдёт официанту. */
const UNDO_SECONDS = 8;

type PendingAction = {
  orderId: string;
  type: 'reject' | 'ready';
  itemIds: string[];
  setComponentIds: string[];
  /** Частичный отказ по количеству для обычных позиций. */
  partial?: { itemId: string; quantity: number }[];
  deadline: number;
};

/** Русское склонение: 1 позиция, 2 позиции, 5 позиций. */
function pluralPositions(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'позиций';
  if (b > 1 && b < 5) return 'позиции';
  if (b === 1) return 'позиция';
  return 'позиций';
}

export function KitchenApp({
  station = 'kitchen',
}: {
  station?: PrepStation;
} = {}) {
  useKitchenRealtime(station);
  const { user, logout } = useAuth();
  const push = useNotifications((s) => s.push);
  const pushNotifications = usePushNotifications(user?.role === 'KITCHEN' || user?.role === 'BAR');

  const [tab, setTab] = useState<KitchenTab>('new');
  const [now, setNow] = useState(() => Date.now());
  const [actingId, setActingId] = useState<string | null>(null);
  const [stopListOpen, setStopListOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const ordersQ = useKitchenOrders(tab, station);
  const accept = useAccept(station);
  const readyItems = useReadyItems(station);
  const rejectItems = useRejectItems(station);

  // Тикающий таймер (ожидание заказов + обратный отсчёт блока отмены).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const orders = ordersQ.data ?? [];
  const counts = orders.length;

  useEffect(() => {
    if (orders.length > 0) setNow(Date.now());
  }, [orders]);

  // Отправляет отложенное действие на сервер (= «уходит официанту»).
  function commit(p: PendingAction) {
    const run =
      p.type === 'reject'
        ? rejectItems.mutateAsync({
            orderId: p.orderId,
            itemIds: p.itemIds,
            setComponentIds: p.setComponentIds,
            partial: p.partial,
          })
        : readyItems.mutateAsync({
            orderId: p.orderId,
            itemIds: p.itemIds,
            setComponentIds: p.setComponentIds,
          });
    run.catch((err) => push({ message: apiError(err), at: new Date().toISOString() }));
  }

  // По истечении таймера действие фиксируется и уходит на сервер.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      commit(pending);
      setPending(null);
    }, Math.max(0, pending.deadline - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  function onBatch(
    orderId: string,
    type: 'reject' | 'ready',
    ids: { itemIds: string[]; setComponentIds: string[]; partial?: { itemId: string; quantity: number }[] },
  ) {
    // Новое действие, пока предыдущее не подтверждено — фиксируем предыдущее сразу.
    if (pending) commit(pending);
    setPending({ orderId, type, ...ids, deadline: Date.now() + UNDO_SECONDS * 1000 });
  }

  function cancelPending() {
    setPending(null);
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setActingId(id);
    try {
      await fn();
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    } finally {
      setActingId(null);
    }
  }

  function onLogout() {
    disconnectSocket();
    logout();
  }

  const undoSecondsLeft = pending ? Math.max(0, Math.ceil((pending.deadline - now) / 1000)) : 0;

  return (
    <div className="flex h-full flex-col bg-background">
      <OfflineBanner />

      {/* Шапка */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="text-[26px] font-medium tracking-tight text-text-primary">
            {new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <ConnectionStatus />
          {pushNotifications.status !== 'subscribed' &&
            pushNotifications.status !== 'unsupported' &&
            pushNotifications.status !== 'checking' && (
            <button onClick={pushNotifications.enable} className="text-text-muted hover:text-primary">
              Уведомления
            </button>
            )}
          <button onClick={onLogout} className="text-text-muted hover:text-text-primary">
            Выйти
          </button>
        </div>
      </header>

      {/* Вкладки + Стоп-лист */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-white px-5 py-2.5">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-lg px-4 py-2 text-[15px] font-medium transition-colors ${
                tab === t.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
              }`}
            >
              {t.label}
              {tab === t.key && counts > 0 && (
                <span className="ml-2 rounded-full bg-white/25 px-1.5 text-xs">{counts}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <KitchenVoiceSettings />
          <button
            onClick={() => setStopListOpen(true)}
            className="shrink-0 rounded-lg border border-primary bg-white px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            Стоп-лист
          </button>
        </div>
      </div>

      {/* Лента заказов */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-5">
        {ordersQ.isLoading ? (
          <div className="flex justify-center py-16 text-primary">
            <Spinner className="h-7 w-7" />
          </div>
        ) : orders.length === 0 ? (
          <p className="py-16 text-center text-text-muted">
            {tab === 'new'
              ? 'Новых заказов нет'
              : tab === 'in_work'
                ? 'Нет заказов в работе'
                : tab === 'ready'
                  ? 'Завершённых заказов нет'
                  : 'Отказанных заказов нет'}
          </p>
        ) : (
          // Masonry через CSS-колонки: карточки разной высоты упаковываются
          // плотно по вертикали, без пустот «по высоте самой длинной в ряду»,
          // как было у grid (Сет с раскрытым составом тянул весь ряд).
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {orders.map((o) => (
              <div key={o.id} className="mb-4 break-inside-avoid">
                <KitchenOrderCard
                  order={o}
                  tab={tab}
                  now={now}
                  submitting={actingId === o.id}
                  pendingItemIds={
                    pending?.orderId === o.id ? [...pending.itemIds, ...pending.setComponentIds] : []
                  }
                  pendingType={pending?.orderId === o.id ? pending.type : null}
                  onAccept={() => act(o.id, () => accept.mutateAsync(o.id))}
                  onBatch={(type, ids) => onBatch(o.id, type, ids)}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Нижний блок отмены действия с таймером */}
      {pending && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="pointer-events-auto flex w-full max-w-5xl items-center gap-3.5 rounded-2xl border border-border bg-white px-4 py-3.5 shadow-soft sm:px-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" />
                <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-text-primary">
                {pending.itemIds.length + pending.setComponentIds.length}{' '}
                {pluralPositions(pending.itemIds.length + pending.setComponentIds.length)}{' '}
                {pending.type === 'reject' ? 'помечены как отказ' : 'помечены как готовые'}
              </p>
              <p className="text-[13px] text-text-muted">
                Отправка официанту через{' '}
                <span className="font-semibold text-danger">
                  {String(undoSecondsLeft).padStart(2, '0')} сек
                </span>
              </p>
            </div>
            <button
              onClick={cancelPending}
              className="shrink-0 rounded-xl border border-primary bg-white px-5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              Отменить
            </button>
          </div>
        </div>
      )}

      <StopListDrawer open={stopListOpen} station={station} onClose={() => setStopListOpen(false)} />
    </div>
  );
}
