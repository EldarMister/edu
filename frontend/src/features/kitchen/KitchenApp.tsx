import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { Spinner } from '@/components/Spinner';
import { disconnectSocket } from '@/lib/socket';
import { usePushNotifications } from '@/lib/push';
import { useKitchenRealtime } from './useKitchenRealtime';
import {
  useKitchenOrders,
  useAccept,
  useReady,
  useRejectOrder,
  useRejectItem,
  type KitchenTab,
} from './api';
import { KitchenOrderCard } from './KitchenOrderCard';
import { RejectModal } from './RejectModal';

const TABS: { key: KitchenTab; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'in_work', label: 'В работе' },
  { key: 'ready', label: 'Готовые' },
  { key: 'rejected', label: 'Отказанные' },
];

type RejectTarget =
  | { type: 'order'; orderId: string }
  | { type: 'item'; orderId: string; itemId: string; name: string };

export function KitchenApp() {
  useKitchenRealtime();
  const { user, logout } = useAuth();
  const push = useNotifications((s) => s.push);
  const pushNotifications = usePushNotifications(user?.role === 'KITCHEN');

  const [tab, setTab] = useState<KitchenTab>('new');
  const [now, setNow] = useState(() => Date.now());
  const [reject, setReject] = useState<RejectTarget | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const ordersQ = useKitchenOrders(tab);
  const accept = useAccept();
  const ready = useReady();
  const rejectOrder = useRejectOrder();
  const rejectItem = useRejectItem();

  // Тикающий таймер ожидания.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const orders = ordersQ.data ?? [];
  const counts = orders.length;

  useEffect(() => {
    if (orders.length > 0) setNow(Date.now());
  }, [orders]);

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

  async function confirmReject(reason: string, comment?: string) {
    if (!reject) return;
    try {
      if (reject.type === 'order') {
        await rejectOrder.mutateAsync({ orderId: reject.orderId, reason, comment });
      } else {
        await rejectItem.mutateAsync({
          orderId: reject.orderId,
          itemId: reject.itemId,
          reason,
          comment,
        });
      }
      setReject(null);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  function onLogout() {
    disconnectSocket();
    logout();
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <OfflineBanner />

      {/* Шапка */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3.5">
        <h1 className="text-2xl font-semibold text-text-primary">Кухня</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-text-secondary">Повар: {user?.name}</span>
          <ConnectionStatus />
          {pushNotifications.status !== 'subscribed' && pushNotifications.status !== 'unsupported' && (
            <button onClick={pushNotifications.enable} className="text-text-muted hover:text-primary">
              Уведомления
            </button>
          )}
          <button onClick={onLogout} className="text-text-muted hover:text-danger">
            Выйти
          </button>
        </div>
      </header>

      {/* Вкладки */}
      <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-white px-5 py-2.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-[15px] font-medium transition-colors ${
              tab === t.key
                ? 'bg-primary text-white'
                : 'text-text-secondary hover:bg-background'
            }`}
          >
            {t.label}
            {tab === t.key && counts > 0 && (
              <span className="ml-2 rounded-full bg-white/25 px-1.5 text-xs">{counts}</span>
            )}
          </button>
        ))}
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
                  ? 'Готовых заказов нет'
                  : 'Отказанных заказов нет'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {orders.map((o) => (
              <KitchenOrderCard
                key={o.id}
                order={o}
                tab={tab}
                now={now}
                submitting={actingId === o.id}
                onAccept={() => act(o.id, () => accept.mutateAsync(o.id))}
                onReady={() => act(o.id, () => ready.mutateAsync(o.id))}
                onRejectOrder={() => setReject({ type: 'order', orderId: o.id })}
                onRejectItem={(itemId, name) =>
                  setReject({ type: 'item', orderId: o.id, itemId, name })
                }
              />
            ))}
          </div>
        )}
      </main>

      <RejectModal
        open={!!reject}
        title={
          reject?.type === 'item' ? `Отказ: ${reject.name}` : 'Отказ по заказу'
        }
        submitting={rejectOrder.isPending || rejectItem.isPending}
        onClose={() => setReject(null)}
        onConfirm={confirmReject}
      />
    </div>
  );
}
