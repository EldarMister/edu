import type { OrderStatus } from '@/types';
import { useAuth } from '@/store/auth';
import { useLocale } from '@/store/locale';
import { disconnectSocket } from '@/lib/socket';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { ORDER_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { Spinner } from '@/components/Spinner';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { OrderDetailsModal } from '@/features/admin/components/OrderDetailsModal';
import { WaiterVoiceSettings } from '@/features/kitchen/KitchenVoiceSettings';
import { Select } from '@/components/Select';
import { Modal } from '@/components/Modal';
import { useState } from 'react';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { IconPrinter } from '@/features/admin/components/icons';
import { useOrderReceiptPrinter } from './useOrderReceiptPrinter';
import { useReceiptPrint } from './receiptPrint';
import { fetchReceipt, useCreateReceiptPrintRequest, useWaiterCabinet, useWaiterOrderHistory, useOrderDetails, type CabinetRecentOrder } from './api';

export function WaiterCabinet({ onBack, onOpenHistory }: { onBack: () => void; onOpenHistory: () => void }) {
  const logout = useAuth((s) => s.logout);
  const userId = useAuth((s) => s.user?.id);
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const cabinetQ = useWaiterCabinet(period);
  const [detailId, setDetailId] = useState<string | null>(null);

  function onLogout() {
    disconnectSocket();
    logout();
  }

  const groups = groupByDay(cabinetQ.data?.recentOrders ?? [], t);

  return (
    <div className="mx-auto max-w-md space-y-4">
      {/* Заголовок с кнопкой назад */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label={t('Назад')}
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-background"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h2 className="text-lg font-semibold text-text-primary">{t('Личный кабинет')}</h2>
      </div>

      {/* Язык */}
      <div className="card flex items-center justify-between gap-3 p-4">
        <span className="text-[15px] font-medium text-text-primary">{t('Язык')}</span>
        <div className="flex rounded-lg border border-border p-0.5">
          <LangButton active={locale === 'ky'} onClick={() => setLocale('ky')}>
            {t('Кыргызча')}
          </LangButton>
          <LangButton active={locale === 'ru'} onClick={() => setLocale('ru')}>
            {t('Русский')}
          </LangButton>
        </div>
      </div>

      <div className="card p-4">
        <ThemeSwitch />
      </div>

      {userId && <div className="flex justify-end"><WaiterVoiceSettings userId={userId} /></div>}

      {/* Статистика */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-text-primary">
            {period === 'day' ? t('Статистика за день') : period === 'month' ? t('Статистика за месяц') : t('Статистика за 7 дней')}
          </h3>
          <Select
            className="h-10 w-36"
            value={period}
            onChange={(v) => setPeriod(v as 'day' | 'week' | 'month')}
            options={[
              { value: 'day', label: t('За день') },
              { value: 'week', label: t('За 7 дней') },
              { value: 'month', label: t('За месяц') },
            ]}
          />
        </div>
        {cabinetQ.isLoading ? (
          <div className="flex justify-center py-4 text-primary">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            <StatRow icon={<IconCheck />} tint="text-success" label={t('Завершено')} value={String(cabinetQ.data?.stats.completed ?? 0)} />
            <StatRow icon={<IconCancel />} tint="text-warning" label={t('Отменено')} value={String(cabinetQ.data?.stats.cancelled ?? 0)} />
            <StatRow icon={<IconRevenue />} tint="text-primary" label={t('Выручка')} value={money(cabinetQ.data?.stats.revenue ?? 0)} valueClass="text-primary" />
          </div>
        )}
      </div>

      {/* Последние заказы */}
      <div className="card p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-text-primary">{t('Последние заказы')}</h3>
          <button onClick={onOpenHistory} className="text-sm font-medium text-primary hover:underline">
            {t('Смотреть все')}
          </button>
        </div>

        {cabinetQ.isLoading ? (
          <div className="flex justify-center py-4 text-primary">
            <Spinner className="h-5 w-5" />
          </div>
        ) : groups.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">{t('Заказов пока нет')}</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-light">{g.label}</p>
                <div className="divide-y divide-border">
                  {g.orders.map((o) => (
                    <OrderRow key={o.id} order={o} tableLabel={t('Стол')} onOpen={() => setDetailId(o.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Выход */}
      <button className="btn-secondary btn-lg w-full gap-2 text-danger hover:bg-danger/5" onClick={onLogout}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5M21 12H9" />
        </svg>
        {t('Выйти')}
      </button>

      {detailId && <WaiterOrderDetails id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export function WaiterOrderArchive({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [detailId, setDetailId] = useState<string | null>(null);
  const history = useWaiterOrderHistory(true);
  const orders = history.data?.pages.flatMap((page) => page.items) ?? [];
  return <>
      <Modal open suspended={!!detailId} onClose={onClose} title={t('История заказов')}>
        {history.isLoading && <Spinner className="mx-auto h-5 w-5" />}
        {history.isError && <p className="py-2 text-sm text-danger">{t('Не удалось загрузить заказы')}</p>}
        {!history.isLoading && !history.isError && !orders.length && <p>{t('Заказов пока нет')}</p>}
        {orders.map((order, index) => {
          const date = new Date(order.createdAt).toDateString();
          return <div key={order.id} className="border-b border-border">
            {(index === 0 || new Date(orders[index - 1].createdAt).toDateString() !== date) &&
              <p className="pt-3 text-xs text-text-muted">{new Date(order.createdAt).toLocaleDateString('ru-RU')}</p>}
            <OrderRow order={order} tableLabel={t('Стол')} onOpen={() => setDetailId(order.id)} />
          </div>;
        })}
        {(history.hasNextPage || (history.isError && !orders.length)) && <button
          type="button"
          className="btn-secondary btn-md mt-3 w-full"
          disabled={history.isFetching}
          onClick={() => void (orders.length ? history.fetchNextPage({ cancelRefetch: false }) : history.refetch())}
        >{t(history.isError ? 'Повторить' : 'Показать ещё')}</button>}
      </Modal>
      {detailId && <WaiterOrderDetails id={detailId} onClose={() => setDetailId(null)} />}
  </>;
}

function WaiterOrderDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { canAction, canOwnerOperation } = usePermissions();
  const detail = useOrderDetails(id);
  const print = useOrderReceiptPrinter();
  const request = useCreateReceiptPrintRequest();
  const beginPrint = useReceiptPrint((state) => state.begin);
  const push = useNotifications((state) => state.push);
  const [busy, setBusy] = useState(false);

  async function repeatPrint() {
    if (busy) return;
    setBusy(true);
    let popup: Window | null = null;
    try {
      if (canAction('printReceipts')) {
        popup = window.open('', '_blank', 'width=380,height=640');
        if (!popup) throw new Error(t('Разрешите всплывающие окна и повторите печать.'));
        await print(id, popup);
      } else {
        const receipt = await fetchReceipt(id);
        const ticket = await request.mutateAsync({ orderId: id, type: 'receipt' });
        beginPrint(ticket, receipt);
      }
    } catch (reason) {
      popup?.close();
      push({ message: apiError(reason), type: 'error', at: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }

  if (detail.data) return <OrderDetailsModal order={detail.data} onClose={onClose} waiterLayout
    refundMode={canOwnerOperation('refunds') ? 'request' : undefined}
    repeatPrint={detail.data.status === 'paid' && (canAction('printReceipts') || canAction('requestReceiptPrints')) &&
      <button type="button" className="btn-secondary btn-md inline-flex items-center gap-2" disabled={busy}
        onClick={() => void repeatPrint()}><IconPrinter />{t('Повторить печать чека')}</button>} />;
  return <Modal open onClose={onClose} title={t('Заказ')}>
    {detail.isError ? <p>{t('Не удалось загрузить заказ')}</p> : <Spinner className="mx-auto h-5 w-5" />}
  </Modal>;
}

function LangButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function StatRow({
  icon,
  tint,
  label,
  value,
  valueClass = 'text-text-primary',
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-background ${tint}`}>{icon}</span>
        <span className="text-[15px] text-text-secondary">{label}</span>
      </div>
      <span className={`text-[15px] font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

function OrderRow({
  order,
  tableLabel,
  onOpen,
}: {
  order: CabinetRecentOrder;
  tableLabel: string;
  onOpen: () => void;
}) {
  const t = useT();
  const s = order.paymentStatus === 'refunded' || Number(order.refundedAmount ?? 0) > 0
    ? { label: order.paymentStatus === 'refunded' ? 'Возвращён' : 'Частичный возврат', cls: 'bg-warning/10 text-warning' }
    : statusMeta(order.status);
  return (
    <button
      onClick={onOpen}
      className="-mx-1 flex w-[calc(100%+0.5rem)] flex-wrap items-center gap-2 rounded-lg px-1 py-2.5 text-left text-sm transition-colors hover:bg-background"
    >
      <span className="w-11 shrink-0 font-medium text-text-primary sm:w-14">{displayOrderNumber(order.orderNumber)}</span>
      <span className="shrink-0 text-text-muted">{order.source === 'delivery' || order.source === 'pickup' ? t(order.source === 'pickup' ? 'Самовывоз' : 'Доставка') : `${tableLabel} ${order.tableNumber}`}</span>
      <span className="shrink-0 text-text-light">{timeHM(order.createdAt)}</span>
      <span className="ml-auto shrink-0 font-medium text-text-primary">{money(order.finalAmount)}</span>
      <span className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{t(s.label)}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-light" aria-hidden>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

function statusMeta(status: OrderStatus): { label: string; cls: string } {
  if (status === 'paid') return { label: 'Оплачен', cls: 'bg-success/10 text-success' };
  if (status === 'cancelled') return { label: 'Отменён', cls: 'bg-danger/10 text-danger' };
  if (status === 'rejected') return { label: 'Отказан', cls: 'bg-danger/10 text-danger' };
  return { label: ORDER_STATUS[status]?.label ?? status, cls: 'bg-slate-100 text-text-muted' };
}

function groupByDay(
  orders: CabinetRecentOrder[],
  t: (value: string) => string,
) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayStart = startOfDay(new Date());
  const dayMs = 86_400_000;
  const buckets: Record<string, CabinetRecentOrder[]> = { today: [], yesterday: [], earlier: [] };
  for (const o of orders) {
    const diff = todayStart - startOfDay(new Date(o.createdAt));
    if (diff <= 0) buckets.today.push(o);
    else if (diff === dayMs) buckets.yesterday.push(o);
    else buckets.earlier.push(o);
  }
  return [
    { key: 'today', label: t('Сегодня'), orders: buckets.today },
    { key: 'yesterday', label: t('Вчера'), orders: buckets.yesterday },
    { key: 'earlier', label: t('Ранее'), orders: buckets.earlier },
  ].filter((g) => g.orders.length > 0);
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IconCancel() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function IconRevenue() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17l6-6 4 4 7-7" />
      <path d="M17 8h4v4" />
    </svg>
  );
}
