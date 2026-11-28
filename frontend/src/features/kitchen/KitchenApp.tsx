import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { displayOrderNumber } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { Spinner } from '@/components/Spinner';
import { Select } from '@/components/Select';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { WorkShiftSettingsCard } from '@/features/settings/WorkShiftBanner';
import { WorkspaceLinks } from '@/components/WorkspaceLinks';
import { disconnectSocket } from '@/lib/socket';
import { usePushNotifications } from '@/lib/push';
import { useKitchenRealtime } from './useKitchenRealtime';
import type { PrepStation } from '@/types';
import { useKitchenOrders, useAccept, useReadyItems, useRejectItems, type KitchenTab } from './api';
import { KitchenOrderCard } from './KitchenOrderCard';
import { StopListDrawer } from './StopListDrawer';
import { KitchenHandControl } from './hand-control/KitchenHandControl';
import { KitchenStats } from './KitchenStats';
import { KitchenTapFeedback, KitchenTapFeedbackSetting } from './KitchenTapFeedback';
import { useListPeriod } from '@/features/admin/pages/warehouse/ListPeriodFilter';
import { calendarDate, warehouseDay } from '@/features/admin/pages/warehouse/warehouse-period';
import { usePreparationStations, usePreparationStationUpdates } from './stations';

const TABS: { key: KitchenTab; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'in_work', label: 'В работе' },
  { key: 'ready', label: 'Завершенные' },
  { key: 'rejected', label: 'Отказанные' },
];

/** Сколько секунд показывается блок отмены, прежде чем действие уйдёт официанту. */
const UNDO_SECONDS = 10;

type PendingAction = {
  id: number;
  orderId: string;
  orderNumber: string;
  type: 'reject' | 'ready';
  itemIds: string[];
  setComponentIds: string[];
  /** Частичное действие по количеству для обычных позиций. */
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
  station: defaultStation = 'kitchen',
}: {
  station?: PrepStation;
} = {}) {
  const { user, logout } = useAuth();
  const { canSection, canEditSection, canAction, effectiveRole } = usePermissions();
  const canChangeOrders = canEditSection('orders');
  const canChangeStopList = !!user && (effectiveRole !== 'ADMIN' || (canEditSection('menu') && canAction('editMenu')));
  const [searchParams, setSearchParams] = useSearchParams();
  const stationKey = `edu-pos-prep-station:${user?.id ?? ''}:${defaultStation}`;
  const [selectedStation, setSelectedStation] = useState(() => {
    try { return localStorage.getItem(stationKey) ?? defaultStation; }
    catch { return defaultStation; }
  });
  const stations = usePreparationStations();
  usePreparationStationUpdates();
  const canAccessBoth = effectiveRole === 'OWNER' || effectiveRole === 'ADMIN';
  const assignedStation = user?.prepStation ?? defaultStation;
  const availableStations = (stations.data ?? []).filter((item) => canAccessBoth || item.id === assignedStation);
  const requestedStation = searchParams.get('station') ?? selectedStation;
  const fallbackStation = canAccessBoth && !availableStations.some((item) => item.id === assignedStation && item.isActive)
    ? availableStations.find((item) => item.isActive)?.id ?? assignedStation
    : assignedStation;
  const station = availableStations.some((item) => item.id === requestedStation) ? requestedStation : fallbackStation;
  useKitchenRealtime(station);
  const push = useNotifications((s) => s.push);
  const pushNotifications = usePushNotifications(user?.role === 'KITCHEN' || user?.role === 'BAR');

  const [tab, setTab] = useState<KitchenTab>('new');
  const [showStats, setShowStats] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const tracksShift = !!user && user.role !== 'OWNER' && user.permissions?.workShiftRequired !== false;
  const canOpenSettings = canChangeOrders || user?.role === 'BAR' || tracksShift;
  const showSettings = settingsOpen && canOpenSettings;
  const [now, setNow] = useState(() => Date.now());
  const [actingId, setActingId] = useState<string | null>(null);
  const [stopListOpen, setStopListOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const nextPendingId = useRef(0);
  const historyPeriod = useListPeriod('kitchenHistory', 'today');
  const historyTab = tab === 'ready' || tab === 'rejected';

  const newOrdersQ = useKitchenOrders('new', station);
  const inWorkOrdersQ = useKitchenOrders('in_work', station);
  const historyOrdersQ = useKitchenOrders(historyTab ? tab : null, station, historyTab
    ? { from: historyPeriod.range.dateFrom ?? '2000-01-01', to: historyPeriod.range.dateTo ?? calendarDate(warehouseDay()) }
    : undefined);
  const ordersQ = tab === 'new' ? newOrdersQ : tab === 'in_work' ? inWorkOrdersQ : historyOrdersQ;
  const accept = useAccept(station);
  const readyItems = useReadyItems(station);
  const rejectItems = useRejectItems(station);

  // Тикающий таймер (ожидание заказов + обратный отсчёт блока отмены).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const orders = ordersQ.data ?? [];
  const activeOrderCounts = { new: newOrdersQ.data?.length ?? 0, in_work: inWorkOrdersQ.data?.length ?? 0 };

  useEffect(() => {
    if (orders.length > 0) setNow(Date.now());
  }, [orders]);

  // Отправляет отложенное действие на сервер (= «уходит официанту»).
  function commit(p: PendingAction) {
    if (!canChangeOrders) return;
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
            partial: p.partial,
          });
    run.catch((err) => push({ message: apiError(err), at: new Date().toISOString() }));
  }

  useEffect(() => {
    if (!pending.length) return;
    if (!canChangeOrders) { setPending([]); return; }
    const timers = pending.map((action) => setTimeout(() => {
      commit(action);
      removePending(action.id);
    }, Math.max(0, action.deadline - Date.now())));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, canChangeOrders]);

  function onBatch(
    order: { id: string; orderNumber: string },
    type: 'reject' | 'ready',
    ids: { itemIds: string[]; setComponentIds: string[]; partial?: { itemId: string; quantity: number }[] },
  ) {
    if (!canChangeOrders) return;
    const startedAt = Date.now();
    setNow(startedAt);
    const action = { id: ++nextPendingId.current, orderId: order.id, orderNumber: order.orderNumber,
      type, ...ids, deadline: startedAt + UNDO_SECONDS * 1000 };
    setPending((current) => [...current, action]);
  }

  function removePending(id: number) {
    setPending((current) => current.filter((action) => action.id !== id));
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

  function acceptOrder(id: string) {
    if (!canChangeOrders) return;
    const isOnlyNewOrder = tab === 'new' && orders.length === 1;
    return act(id, async () => {
      await accept.mutateAsync(id);
      if (isOnlyNewOrder) setTab('in_work');
    });
  }

  function onLogout() {
    disconnectSocket();
    logout();
  }

  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsButton.current?.focus());
  }

  return (
    <div data-hand-scope className="flex h-full flex-col bg-background" onKeyDown={(event) => {
      if (showSettings && event.key === 'Escape') closeSettings();
    }}>
      <OfflineBanner />
      <KitchenTapFeedback />

      {/* Шапка */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-[26px] font-medium tracking-tight text-text-primary">
            {new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span aria-hidden="true" className="shrink-0 text-text-muted">|</span>
          {canAccessBoth ? <Select
            ariaLabel="Станция приготовления"
            className="h-10 max-w-[45vw]"
            value={station}
            options={availableStations.map((item) => ({ value: item.id, label: item.isActive ? item.name : `${item.name} (архив)` }))}
            onChange={(value) => {
              setSelectedStation(value);
              if (searchParams.has('station')) {
                const next = new URLSearchParams(searchParams);
                next.delete('station');
                setSearchParams(next, { replace: true });
              }
              try { localStorage.setItem(stationKey, value); } catch { /* Storage can be disabled. */ }
            }}
            disabled={pending.length > 0 || actingId !== null || stopListOpen}
          /> : <span className="text-sm font-medium text-text-primary">
            {availableStations[0]?.name ?? (assignedStation === 'bar' ? 'Бар' : assignedStation === 'kitchen' ? 'Кухня' : 'Станция приготовления')}
          </span>}
        </div>
        <div className="flex items-center gap-4 text-sm">
          {canSection('warehouse')&&<Link to="/warehouse" className="text-primary">Склад и техкарты</Link>}
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
      <WorkspaceLinks current="production" />

      {/* Вкладки + Стоп-лист */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-3 py-2.5 sm:flex-nowrap sm:px-5">
        <div className="no-scrollbar flex min-w-0 w-full gap-2 overflow-x-auto sm:w-auto sm:flex-1">
          {TABS.map(({ key, label }) => {
            const selected = !showSettings && !showStats && tab === key;
            const count = key === 'new' || key === 'in_work' ? activeOrderCounts[key] : selected ? orders.length : 0;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setTab(key);
                  setShowStats(false);
                  setSettingsOpen(false);
                }}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-[15px] font-medium transition-colors ${
                  selected ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
                }`}
              >
                {label}
                {count > 0 && <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${selected ? 'bg-paper/25 text-white' : 'bg-primary/10 text-primary'}`}>
                  {count}
                </span>}
              </button>
            );
          })}
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          {!showSettings && !showStats && historyTab && historyPeriod.filter}
          <button
            onClick={() => { setSettingsOpen(false); setShowStats((v) => !v); }}
            className={`shrink-0 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
              showStats
                ? 'border-primary bg-primary text-white'
                : 'border-primary bg-white text-primary hover:bg-primary/5'
            }`}
          >
            Статистика
          </button>
          {canOpenSettings && <button type="button" ref={settingsButton} aria-pressed={showSettings}
            onClick={() => { setShowStats(false); setSettingsOpen(!showSettings); }}
            className={`shrink-0 rounded-lg border border-primary px-3.5 py-2 text-sm font-medium transition-colors ${
              showSettings ? 'bg-primary text-white' : 'bg-white text-primary hover:bg-primary/5'
            }`}>
            Настройки
          </button>}
          {canChangeStopList && <button
            onClick={() => setStopListOpen(true)}
            className="shrink-0 rounded-lg border border-primary bg-white px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            Стоп-лист
          </button>}
        </div>
      </div>

      {!canChangeOrders && <p className="border-b border-border bg-card px-5 py-2 text-sm text-text-muted">Заказы доступны только для просмотра.</p>}

      {canChangeOrders && <KitchenHandControl showSettings={showSettings} />}
      {showSettings && !canChangeOrders && <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <WorkShiftSettingsCard />
          <section aria-label="Внешний вид" className="card p-4"><ThemeSwitch /></section>
          <KitchenTapFeedbackSetting />
        </div>
      </main>}

      {!showSettings && (showStats ? (
        <main className="flex-1 overflow-y-auto">
          <KitchenStats station={station} />
        </main>
      ) : (
      /* Лента заказов */
      <main className="flex-1 overflow-y-auto p-4 sm:p-5">
        {ordersQ.isLoading ? (
          <div className="flex justify-center py-16 text-primary">
            <Spinner className="h-7 w-7" />
          </div>
        ) : ordersQ.isError ? (
          <div role="alert" className="py-12 text-center text-danger">
            <p>{apiError(ordersQ.error)}</p>
            <button className="btn-secondary btn-md mt-3" onClick={() => void ordersQ.refetch()}>Повторить</button>
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
            {orders.map((o) => {
              const actions = pending.filter((action) => action.orderId === o.id);
              const pendingTypes = new Map<string, PendingAction['type']>();
              for (const action of actions) {
                for (const id of [...action.itemIds, ...action.setComponentIds]) pendingTypes.set(id, action.type);
              }
              return (
                <div key={o.id} className="mb-4 break-inside-avoid">
                  <KitchenOrderCard
                    order={o}
                    tab={tab}
                    now={now}
                    submitting={actingId === o.id}
                    readOnly={!canChangeOrders}
                    pendingTypes={pendingTypes}
                    pendingPartial={actions.flatMap((action) => action.partial ?? [])}
                    onAccept={() => acceptOrder(o.id)}
                    onBatch={(type, ids) => onBatch(o, type, ids)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>
      ))}

      {pending.length > 0 && (
        <section aria-label="Действия с возможностью отмены"
          className="max-h-[38dvh] shrink-0 space-y-2 overflow-y-auto px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
          {pending.map((action) => {
            const count = action.itemIds.length + action.setComponentIds.length;
            const secondsLeft = Math.max(0, Math.ceil((action.deadline - now) / 1000));
            const orderNumber = displayOrderNumber(action.orderNumber);
            return (
              <div key={action.id} className="mx-auto flex w-full max-w-5xl items-center gap-3 rounded-2xl border border-border bg-white px-3 py-2 shadow-soft sm:px-5">
                <UndoActionIcon />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-text-primary">
                    {orderNumber} · {count} {pluralPositions(count)}{' '}
                    {action.type === 'reject' ? 'помечены как отказ' : 'помечены как готовые'}
                  </p>
                  <p className="text-[13px] text-text-muted">
                    Отправка официанту через{' '}
                    <span className="font-semibold text-danger">
                      {String(secondsLeft).padStart(2, '0')} сек
                    </span>
                  </p>
                </div>
                <button type="button" aria-label={'Отменить действие по заказу ' + orderNumber} onClick={() => removePending(action.id)}
                  className="shrink-0 rounded-xl border border-primary bg-white px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5">
                  Отменить
                </button>
              </div>
            );
          })}
        </section>
      )}

      {canChangeStopList && <StopListDrawer open={stopListOpen} station={station} onClose={() => setStopListOpen(false)} />}
    </div>
  );
}

function UndoActionIcon() {
  return <img src="/undo-action-icon.png" width={48} height={48} className="h-12 w-12 shrink-0" alt="" />;
}
