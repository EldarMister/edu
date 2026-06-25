import { Modal } from '@/components/Modal';
import { OrderBadge } from '@/components/StatusBadge';
import type { Order, OrderItemStatus } from '@/types';
import { displayOrderNumber, hallSuffix, money, orderItemDisplayName, paymentDisplayLabel, timeHM, isSplitPayment, paymentMethodLabel } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { useRetryFiscal } from '../api';

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
}: {
  order: Order | null;
  onClose: () => void;
}) {
  if (!order) return null;

  const date = new Date(order.createdAt);
  const showMixedBreakdown =
    order.paymentMethod === 'mixed' && !isSplitPayment(order) && !!order.payments?.length;

  const infoRows: { label: string; value: React.ReactNode }[][] = [
    [
      { label: 'Статус', value: <OrderBadge status={order.status} /> },
      { label: 'Официант', value: order.waiter?.name ?? 'QR menu' },
    ],
    [
      { label: 'Дата', value: `${date.toLocaleDateString('ru-RU')} ${timeHM(order.createdAt)}` },
      { label: 'Сумма', value: money(order.finalAmount) },
    ],
    [
      { label: 'Стол', value: `Стол ${order.table.number}${hallSuffix(order.table)}` },
      { label: 'Оплата', value: order.paymentMethod ? paymentDisplayLabel(order) : '—' },
    ],
  ];
  if (showMixedBreakdown) {
    infoRows.push([
      { label: 'Наличными', value: money(mixedSumBy(order, 'cash')) },
      { label: 'QR', value: money(mixedSumBy(order, 'qr')) },
    ]);
  }

  return (
    <Modal
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
                className={`grid grid-cols-1 sm:grid-cols-2 ${ri < rows.length - 1 ? 'border-b border-border' : ''}`}
              >
                {pair.map((cell, ci) => (
                  <div
                    key={ci}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${
                      ci === 1 ? 'border-t border-border sm:border-l sm:border-t-0' : ''
                    }`}
                  >
                    <span className="text-text-muted">{cell.label}</span>
                    <span className="text-right font-medium text-text-primary">{cell.value}</span>
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
              <div key={item.id} className="border-b border-border px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      {item.quantity}× {orderItemDisplayName(item)}
                    </p>
                    {item.comment && <p className="mt-0.5 text-xs text-warning">{item.comment}</p>}
                    {item.rejectReason && <p className="mt-0.5 text-xs text-danger">Отказ: {item.rejectReason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-text-primary">{money(item.finalPrice)}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">{ITEM_STATUS[item.status]}</p>
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
          <Total label="К оплате" value={money(order.finalAmount)} strong />
        </div>

        <FiscalBlock order={order} />
      </div>
    </Modal>
  );
}

/** ККМ / фискальный чек. Ничего не показывает, пока чек не пробит и нет ошибки
 *  (т.е. при выключенной ККМ). При ошибке — бейдж и кнопка «Повторить». */
function FiscalBlock({ order }: { order: Order }) {
  const retry = useRetryFiscal();
  const push = useNotifications((s) => s.push);

  const hasReceipt = !!order.fiscalReceiptNumber;
  const hasError = !hasReceipt && !!order.fiscalError;
  if (!hasReceipt && !hasError) return null;

  const onRetry = async () => {
    try {
      const res = await retry.mutateAsync(order.id);
      if (res?.success) {
        push({ message: 'Фискальный чек пробит', type: 'success', at: new Date().toISOString() });
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
    const qr = order.fiscalQrCode ?? '';
    const isImage = qr.startsWith('data:image');
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
            Фискальный чек
          </span>
          <span className="text-sm font-semibold text-text-primary">№ {order.fiscalReceiptNumber}</span>
        </div>
        {order.fiscalSign && (
          <p className="mt-1 text-xs text-text-muted">Фискальный признак: {order.fiscalSign}</p>
        )}
        {qr && (
          <div className="mt-2">
            {isImage ? (
              <img src={qr} alt="QR ГНС" className="h-28 w-28 rounded border border-border bg-white p-1" />
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

/** Сумма платежей заказа по способу (наличные / QR) для смешанной оплаты. */
function mixedSumBy(
  order: { payments?: { method: string; amount: string }[] },
  method: string,
): number {
  return (order.payments ?? [])
    .filter((p) => p.method === method)
    .reduce((acc, p) => acc + Number(p.amount), 0);
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'text-base font-semibold text-text-primary' : 'text-text-secondary'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
