import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { OrderRefunds } from '@/features/refunds/OrderRefunds';
import { useT } from '@/lib/i18n';
import { EditorPage } from '../pages/warehouse/EditorPage';
import { OrderStatusBadges } from '@/components/StatusBadge';
import type { Order, OrderItemStatus } from '@/types';
import { displayOrderNumber, hallSuffix, isSplitPayment, mixedPaymentBreakdown, money, orderItemDisplayName,
  paymentDisplayLabel, paymentMethodLabel, tableLabel, taxRateLabel, timeHM } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useCancelOrderItem, useRetryFiscal } from '../api';
import { CancelOrderModal } from './CancelOrderModal';
import { OrderStockMovements } from './OrderStockMovements';

const ITEM_STATUS: Record<OrderItemStatus, string> = {
  new: 'Новое',
  accepted: 'Принято',
  cooking: 'Готовится',
  ready: 'Готово',
  rejected: 'Отказано',
  served: 'Подано',
  cancelled: 'Отменено',
};

export function OrderDetailsModal({
  order,
  onClose,
  onOrderChange,
  allowItemCancellation = false,
  waiterLayout = false,
  refundMode,
  presentation = 'modal',
}: {
  order: Order | null;
  onClose: () => void;
  onOrderChange?: (order: Order) => void;
  allowItemCancellation?: boolean;
  waiterLayout?: boolean;
  refundMode?: 'request' | 'manage';
  presentation?: 'modal' | 'page';
}) {
  const t = useT();
  const Container = presentation === 'page' ? EditorPage : Modal;
  const [cancelItem, setCancelItem] = useState<Order['items'][number] | null>(null);
  const cancelOrderItem = useCancelOrderItem();
  const push = useNotifications((s) => s.push);
  const { effectiveRole, canSection } = usePermissions();
  const showStockMovements = !waiterLayout && (effectiveRole === 'ADMIN' || effectiveRole === 'OWNER')
    && canSection('orders') && canSection('warehouse');

  if (!order) return null;

  const date = new Date(order.createdAt);
  const itemCancellationAllowed = order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded'
    && !['paid', 'cancelled', 'rejected'].includes(order.status);
  const isDelivery = order.source === 'delivery';
  const refunded = Number(order.refundedAmount ?? 0);

  async function confirmItemCancellation(reason: string) {
    if (!cancelItem) return;
    try {
      const updated = await cancelOrderItem.mutateAsync({
        orderId: order!.id,
        itemId: cancelItem.id,
        reason,
      });
      onOrderChange?.(updated);
      setCancelItem(null);
      push({ message: 'Блюдо отменено', type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  const infoRows: { label: string; value: React.ReactNode }[][] = [
    [
      { label: 'Статус', value: <OrderStatusBadges order={order} /> },
      { label: isDelivery ? 'Оформил' : 'Официант', value: order.waiter?.name ?? (isDelivery ? 'Онлайн-заказ' : 'QR menu') },
    ],
    [
      { label: 'Дата', value: `${date.toLocaleDateString('ru-RU')} ${timeHM(order.createdAt)}` },
      { label: 'Сумма', value: money(order.finalAmount) },
    ],
    [
      {
        label: isDelivery ? (order.externalOrderId ? 'Внешний заказ' : 'Тип заказа') : 'Стол',
        value: isDelivery ? order.externalOrderId ?? 'Доставка' : `${tableLabel(order.table)}${hallSuffix(order.table)}`,
      },
      { label: 'Оплата', value: order.paymentMethod ? paymentDisplayLabel(order) : '—' },
    ],
  ];
  if (waiterLayout) {
    const [dateCell, amountCell] = infoRows[1];
    const [tableCell, paymentCell] = infoRows[2];
    infoRows[1] = [dateCell, tableCell];
    infoRows[2] = [amountCell, paymentCell];
  }
  if (order.paymentMethod === 'mixed' && !isSplitPayment(order)) {
    const breakdown = mixedPaymentBreakdown(order.payments)
      .map(({ method, amount }) => ({ label: t(paymentMethodLabel(method)), value: money(amount) }));
    if (breakdown.length) infoRows.push(breakdown.slice(0, 2));
    if (breakdown.length > 2) infoRows.push(breakdown.slice(2));
  }
  if (isDelivery) {
    infoRows.push(
      [
        { label: 'Клиент', value: order.deliveryCustomerName ?? '—' },
        { label: 'Телефон', value: order.deliveryCustomerPhone ?? '—' },
      ],
      [
        { label: 'Адрес доставки', value: order.deliveryAddress ?? '—' },
      ],
    );
  }

  return (
    <Container
      open={!!order}
      onClose={onClose}
      title={`Заказ ${displayOrderNumber(order.orderNumber)}`}
      panelClassName="max-w-2xl"
    >
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Информация</h4>
          <div className="overflow-hidden rounded-xl border border-border text-sm">
            {infoRows.map((pair, ri, rows) => (
              <div
                key={ri}
                className={`grid ${waiterLayout && pair.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'} ${ri < rows.length - 1 ? 'border-b border-border' : ''}`}
              >
                {pair.map((cell, ci) => (
                  <div
                    key={ci}
                    className={`flex min-w-0 px-4 py-3 ${waiterLayout ? 'flex-col gap-1' : 'items-center justify-between gap-3'} ${
                      ci === 1 ? (waiterLayout ? 'border-l border-border' : 'border-t border-border sm:border-l sm:border-t-0') : ''
                    }`}
                  >
                    <span className="text-text-muted">{cell.label}</span>
                    <span className={`break-words font-medium text-text-primary ${waiterLayout ? '' : 'text-right'}`}>{cell.value}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {isSplitPayment(order) && !!order.payments?.length && (
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Платежи</p>
            <div className="mt-1.5 space-y-1">
              {order.payments.map((payment, index) => (
                <div key={index} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-text-secondary">
                    Платеж {index + 1} — {paymentMethodLabel(payment.method)}
                  </span>
                  <span className="font-medium text-text-primary">{money(payment.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {order.comment && (
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Комментарий</p>
            <p className="mt-0.5 text-sm text-text-primary">{order.comment}</p>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-text-primary">Блюда</h4>
            <span className="text-xs text-text-muted">{order.items.length} поз.</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            {order.items.map((item) => (
              <div key={item.id} className="border-b border-border px-4 py-2.5 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {item.quantity}× {orderItemDisplayName(item)}
                    </p>
                    {!!item.refundedQuantity && <p className="mt-0.5 text-xs text-text-muted">{t('Возвращено')} · {item.refundedQuantity} / {item.quantity}</p>}
                    {item.comment && <p className="mt-0.5 text-xs text-warning">{item.comment}</p>}
                    {item.rejectReason && (
                      <p className="mt-0.5 text-xs text-danger">
                        {item.status === 'cancelled' ? 'Причина' : 'Отказ'}: {item.rejectReason}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center gap-2">
                      <p className="whitespace-nowrap text-sm font-semibold text-text-primary">
                        {money(item.finalPrice)}
                        <span className="ml-1.5 text-xs font-medium text-text-muted">· {ITEM_STATUS[item.status]}</span>
                      </p>
                      {allowItemCancellation &&
                        itemCancellationAllowed &&
                        !['rejected', 'cancelled'].includes(item.status) && (
                        <button
                          type="button"
                          title="Отменить блюдо"
                          aria-label={`Отменить блюдо ${orderItemDisplayName(item)}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-light transition-colors hover:bg-danger/10 hover:text-danger"
                          onClick={() => setCancelItem(item)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5 border-t border-border pt-3 text-sm">
          <Total label="Итого" value={money(order.totalAmount)} />
          {Number(order.discountAmount) > 0 && <Total label="Скидка" value={money(order.discountAmount)} />}
          {Number(order.serviceChargeAmount) > 0 && (
            <Total label="Обслуживание" value={money(order.serviceChargeAmount)} />
          )}
          {Number(order.roundingAmount) > 0 && <Total label="Округление" value={`−${money(order.roundingAmount ?? 0)}`} />}
          {order.taxes?.map((tax) => <Total key={tax.id}
            label={`В т. ч. ${tax.name} (${taxRateLabel(tax.rate)})`} value={money(tax.amount)} />)}
          <Total label={order.status === 'paid' ? t('Оплачено') : t('К оплате')} value={money(order.finalAmount)} strong />
          {refunded > 0 && <>
            <Total label={t('Возвращено')} value={money(refunded)} />
            <Total label={t('Оплата после возврата')} value={money(Number(order.finalAmount) - refunded)} />
          </>}
        </div>

        {showStockMovements && <OrderStockMovements key={`stock-${order.id}`} orderId={order.id} />}
        {refundMode && order.status === 'paid' && <OrderRefunds key={order.id} order={order} mode={refundMode} />}
        <FiscalBlock order={order} />
      </div>
      <CancelOrderModal
        open={!!cancelItem}
        orderLabel={
          cancelItem
            ? `${cancelItem.quantity}× ${orderItemDisplayName(cancelItem)} · ${money(cancelItem.finalPrice)}`
            : ''
        }
        submitting={cancelOrderItem.isPending}
        onClose={() => setCancelItem(null)}
        onConfirm={confirmItemCancellation}
        title="Отменить блюдо?"
        confirmLabel="Отменить блюдо"
      />
    </Container>
  );
}

/** ККМ / фискальный чек. Ничего не показывает, пока чек не пробит и нет ошибки
 *  (т.е. при выключенной ККМ). При ошибке — бейдж и кнопка «Повторить». */
function FiscalBlock({ order }: { order: Order }) {
  const retry = useRetryFiscal();
  const push = useNotifications((s) => s.push);

  const hasReceipt = !!order.fiscalReceiptNumber;
  const simulated = order.fiscalReceiptNumber?.startsWith('MOCK-');
  const hasError = !hasReceipt && !!order.fiscalError;
  if (!hasReceipt && !hasError) return null;

  const onRetry = async () => {
    try {
      const res = await retry.mutateAsync(order.id);
      if (res?.success) {
        push({ message: res.simulated ? 'Эмуляция завершена' : 'Фискальный чек получен', type: 'success', at: new Date().toISOString() });
      } else {
        push({
          message: res?.error ?? 'ККМ вернул ошибку',
          type: 'error',
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  if (hasReceipt) {
    const qr = simulated ? '' : order.fiscalQrCode ?? '';
    const isImage = qr.startsWith('data:image');
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
            {simulated ? 'Тестовый чек' : 'Фискальный чек'}
          </span>
          <span className="text-sm font-semibold text-text-primary">№ {order.fiscalReceiptNumber}</span>
        </div>
        {!simulated && order.fiscalSign && (
          <p className="mt-1 text-xs text-text-muted">Фискальный признак: {order.fiscalSign}</p>
        )}
        {qr && (
          <div className="mt-2">
            {isImage ? (
              <img src={qr} alt="QR ГНС" className="h-28 w-28 rounded border border-border bg-paper p-1" />
            ) : (
              <a
                href={qr}
                target="_blank"
                rel="noreferrer"
                className="break-all text-xs text-primary underline"
              >
                {qr}
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-block rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-medium text-danger">
          Ошибка ККМ
        </span>
        <button
          type="button"
          onClick={onRetry}
          disabled={retry.isPending}
          className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {retry.isPending ? 'Повтор…' : 'Повторить'}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-danger">{order.fiscalError}</p>
    </div>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'text-base font-semibold text-text-primary' : 'text-text-secondary'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
