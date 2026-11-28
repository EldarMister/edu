import { useEffect, useRef, useState } from 'react';
import type { Order, OrderStatus } from '@/types';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, orderPlaceLabel } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { normalizeOrderPaymentMethod, OrdersFilters, type OrderSort } from '../components/OrdersFilters';
import { availableOrderColumns, defaultOrderColumns, orderColumnLabel, orderTableWidth, OrdersTable } from '../components/OrdersTable';
import { OrdersExportButton } from '../components/OrdersExportButton';
import { ColumnButton } from '../components/ColumnControl';
import { CancelOrderModal } from '../components/CancelOrderModal';
import { OrderDetailsModal } from '../components/OrderDetailsModal';
import { useCanManageOrderRefunds } from '@/features/refunds/api';
import { useAdminOrderDetails, useAdminOrdersInfinite, useOrdersSummary, useCancelOrder, useOrderWaiters, useUpdateOrderStatus, type OrderListFilters } from '../api';
import { WorkspaceHeaderActions } from './WorkspaceHeader';
import { ORDER_TYPES } from '@/features/waiter/OrderFulfillmentFields';
import { useListPeriod } from './warehouse/ListPeriodFilter';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './warehouse/WarehouseColumnSettings';
import { usePageFilters } from './warehouse/workspace-route';
import './orders-redesign.css';

const MANUAL_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'sent_to_kitchen', label: 'Активный' },
  { value: 'accepted_by_kitchen', label: 'Принят кухней' },
  { value: 'cooking', label: 'Готовится' },
  { value: 'ready', label: 'Готов' },
  { value: 'picked_up', label: 'Забран' },
  { value: 'served', label: 'Подан гостям' },
  { value: 'waiting_payment', label: 'Ожидает оплаты' },
  { value: 'cancelled', label: 'Отменён' },
];

function sortRequest(sort: OrderSort): { sort: 'default' | 'date' | 'amount'; sortDirection?: 'asc' | 'desc' } {
  if (sort.startsWith('date')) return { sort: 'date', sortDirection: sort.endsWith('_asc') ? 'asc' : 'desc' };
  if (sort.startsWith('amount')) return { sort: 'amount', sortDirection: sort.endsWith('_asc') ? 'asc' : 'desc' };
  return { sort: 'default' };
}

export function OrdersPage({ scope = 'admin' }: { scope?: 'admin' | 'terminal' } = {}) {
  const readOnly = scope === 'terminal';
  const tr = useT();
  const [{ ordersTab: tab, ordersPaymentMethod, ordersComments, ordersType }, updateView] = usePageFilters({
    ordersTab: 'all', ordersPaymentMethod: '', ordersComments: '', ordersType: '',
  });
  const byClose = tab === 'paid';
  const paymentMethod = normalizeOrderPaymentMethod(ordersPaymentMethod);
  const comments = ordersComments === 'with' || ordersComments === 'without' ? ordersComments : undefined;
  const showTenderRevenue = paymentMethod !== '' && paymentMethod !== 'mixed';
  const [waiterId, setWaiterId] = useState('');
  const period = useListPeriod('orders', 'all', tr(byClose ? 'Дата закрытия' : 'Период'));
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<OrderSort>('default');
  const [columnsOpen, setColumnsOpen] = useState<HTMLButtonElement | null>(null);
  const [savedColumns, saveColumns] = useColumnPreference(scope + '-orders');
  const columnOptions = readOnly ? availableOrderColumns.filter((key) => key !== 'actions') : availableOrderColumns;
  const defaultColumns = readOnly ? defaultOrderColumns.filter((key) => key !== 'actions') : defaultOrderColumns;
  const columns = visibleWarehouseColumns(savedColumns, defaultColumns, columnOptions);

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const detail = useAdminOrderDetails(detailsOrder?.id ?? null, scope);
  const canManageRefunds = useCanManageOrderRefunds();
  const { canAction, canEditSection, canOwnerOperation } = usePermissions();
  const [statusTarget, setStatusTarget] = useState<Order | null>(null);
  const [manualStatus, setManualStatus] = useState<OrderStatus>('served');
  const [manualReason, setManualReason] = useState('');
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const push = useNotifications((s) => s.push);
  const cancelOrder = useCancelOrder();
  const updateStatus = useUpdateOrderStatus();

  const waiters = useOrderWaiters(scope);
  const waiterOptions = [
    { value: '', label: tr('Все официанты') },
    ...(waiters.data ?? []).map((w) => ({ value: w.id, label: w.name })),
  ];

  const filters: OrderListFilters = { tab, search, paymentMethod, waiterId, comments, orderType: ORDER_TYPES.find(({ value }) => value === ordersType)?.value, ...period.range, ...(byClose && { dateField: 'closed' }) };
  const listFilters = { ...filters, ...sortRequest(sort) };
  const ordersQ = useAdminOrdersInfinite(listFilters, scope);
  const summaryQ = useOrdersSummary(filters, scope);
  const items = ordersQ.data?.pages.flatMap((p) => p.items) ?? [];
  const ordersError = ordersQ.isError ? apiError(ordersQ.error) : null;
  const s = summaryQ.data;
  const summaryPlaceholder = summaryQ.isPending
    ? <span aria-hidden="true" className="workspace-skeleton inline-block h-3 w-8 align-middle" />
    : '—';

  // Бесконечная подгрузка: тянем следующую страницу, когда «маяк» внизу появляется в зоне видимости.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = ordersQ;
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { root: el.closest('[data-orders-scroll], main'), rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

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

  function openStatusEditor(order: Order) {
    setStatusTarget(order);
    setManualStatus(order.status === 'paid' || order.status === 'rejected' ? 'waiting_payment' : order.status);
    setManualReason('');
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    try {
      await updateStatus.mutateAsync({
        orderId: statusTarget.id,
        status: manualStatus,
        reason: manualReason.trim() || undefined,
      });
      push({ message: 'Статус заказа изменён', type: 'success', at: new Date().toISOString() });
      setStatusTarget(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  return (
    <div className="orders-redesign" style={items.length && !ordersError
      ? { width: `max(100%, calc(${orderTableWidth(columns)}px + 2 * var(--orders-gutter)))` }
      : undefined}>
      <WorkspaceHeaderActions>
        <ColumnButton label={tr('Столбцы')} expanded={!!columnsOpen} onClick={(event) => setColumnsOpen(columnsOpen ? null : event.currentTarget)} />
        {!readOnly && canAction('exportReports') && <OrdersExportButton filters={listFilters} disabled={!items.length || !!ordersError} />}
      </WorkspaceHeaderActions>
      <div className="orders-controls">
        <div className="orders-summary workspace-enter" aria-busy={summaryQ.isPending}>
          <Sum label={tr('Всего заказов')} value={s?.total ?? summaryPlaceholder} />
          <Sep />
          <Sum label={tr('Оплачено')} value={s?.paid ?? summaryPlaceholder} />
          <Sep />
          <Sum label={tr('Не оплачено')} value={s?.unpaid ?? summaryPlaceholder} />
          <Sep />
          <Sum label={tr('Отменено')} value={s?.cancelled ?? summaryPlaceholder} />
          <Sep />
          <Sum label={tr(showTenderRevenue ? 'Выручка по чекам' : 'Выручка')} value={s ? money(s.revenue) : summaryPlaceholder} />
          {showTenderRevenue && <>
            <Sep />
            <Sum label={tr('По выбранному способу оплаты')} value={s?.tenderRevenue != null ? money(s.tenderRevenue) : summaryPlaceholder} />
          </>}
        </div>

        <OrdersFilters
          periodFilter={period.filter}
          orderType={ordersType}
          onOrderTypeChange={(ordersType) => updateView({ ordersType })}
          tab={tab}
          paymentMethod={paymentMethod}
          waiterId={waiterId}
          comments={comments ?? ''}
          waiterOptions={waiterOptions}
          sort={sort}
          search={search}
          onTabChange={(ordersTab) => updateView({ ordersTab })}
          onPaymentMethodChange={(ordersPaymentMethod) => updateView({ ordersPaymentMethod })}
          onWaiterChange={setWaiterId}
          onCommentsChange={(ordersComments) => updateView({ ordersComments })}
          onSortChange={setSort}
          onSearchChange={setSearch}
        />
      </div>

      <OrdersTable
        columns={columns}
        byClose={byClose}
        items={items}
        isLoading={ordersQ.isLoading}
        error={ordersError}
        loadMoreRef={loadMoreRef}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        onOpen={setDetailsOrder}
        onEdit={readOnly ? undefined : openStatusEditor}
        onCancel={readOnly ? undefined : setCancelTarget}
      />
      {columnsOpen && <WarehouseColumnSettings anchor={columnsOpen} columns={columns} defaults={columnOptions} resetColumns={defaultColumns}
        label={(key) => tr(orderColumnLabel(key))} onClose={() => setColumnsOpen(null)}
        onApply={(selected) => {
          const value = selected.join(',');
          saveColumns(value === defaultColumns.join(',') ? '' : value);
          setColumnsOpen(null);
        }} />}
      <CancelOrderModal
        open={!!cancelTarget}
        orderLabel={
          cancelTarget
            ? `${tr('Заказ')} ${displayOrderNumber(cancelTarget.orderNumber)} · ${orderPlaceLabel(cancelTarget, tr)} · ${money(cancelTarget.finalAmount)}`
            : ''
        }
        submitting={cancelOrder.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
      <StatusEditorModal
        open={!!statusTarget}
        order={statusTarget}
        value={manualStatus}
        reason={manualReason}
        submitting={updateStatus.isPending}
        onValueChange={setManualStatus}
        onReasonChange={setManualReason}
        onClose={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />
      <OrderDetailsModal
        order={detail.data ?? detailsOrder}
        refundMode={!readOnly && canManageRefunds ? 'manage' : undefined}
        readOnly={readOnly}
        onClose={() => setDetailsOrder(null)}
        onOrderChange={setDetailsOrder}
        allowItemCancellation={!readOnly && canEditSection('orders') && canOwnerOperation('cancelItems')}
      />
    </div>
  );
}

function StatusEditorModal({
  open,
  order,
  value,
  reason,
  submitting,
  onValueChange,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  order: Order | null;
  value: OrderStatus;
  reason: string;
  submitting: boolean;
  onValueChange: (value: OrderStatus) => void;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tr = useT();
  const { canOwnerOperation } = usePermissions();
  if (!open || !order) return null;
  return (
    <div data-radio-blocking className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-white shadow-soft">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-semibold text-text-primary">{tr('Изменить статус заказа')}</h3>
          <p className="mt-0.5 text-sm text-text-muted">
            {displayOrderNumber(order.orderNumber)} · {orderPlaceLabel(order, tr)}
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <Select
            className="h-10 w-full text-sm"
            value={value}
            onChange={(next) => onValueChange(next as OrderStatus)}
            options={MANUAL_STATUS_OPTIONS.filter(({ value }) => value !== 'cancelled' || canOwnerOperation('cancelOrders'))
              .map((o) => ({ ...o, label: tr(o.label) }))}
          />
          <textarea
            className="min-h-[84px] w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            placeholder={tr('Причина изменения')}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            maxLength={240}
          />
          {order.status === 'cancelled' && value !== 'cancelled' && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
              {tr('Отменённые позиции будут восстановлены в выбранный статус.')}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="h-10 rounded-xl border border-border bg-white px-4 text-sm text-text-secondary transition hover:border-primary/40 hover:text-text-primary"
            onClick={onClose}
            disabled={submitting}
          >
            {tr('Отмена')}
          </button>
          <button
            type="button"
            className="flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary-dark disabled:opacity-60"
            onClick={onConfirm}
            disabled={submitting || order.status === value}
          >
            {submitting ? <Spinner className="h-4 w-4" /> : tr('Сохранить')}
          </button>
        </div>
      </div>
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
  return <span className="orders-summary-separator" aria-hidden="true" />;
}
