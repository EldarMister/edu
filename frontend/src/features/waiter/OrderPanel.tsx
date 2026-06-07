import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { ORDER_STATUS } from '@/lib/status';
import { displayOrderNumber, money, orderItemDisplayName } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';

function InfoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-primary"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

/** Возвращает null если строка состоит только из U+FFFD (кракозябры из bash-тестов). */
function safeComment(s: string | null | undefined): string | null {
  if (!s) return null;
  if ([...s].every(c => c === '�' || c === ' ')) return null;
  return s;
}

export function OrderPanel({
  order,
  submitting,
  onPickedUp,
  onServed,
  onToPayment,
  onContinueAfterRejection,
  onAddReplacement,
  onCancelOrder,
}: {
  order: Order;
  submitting: boolean;
  onPickedUp: () => void;
  onServed: () => void;
  onToPayment: () => void;
  onContinueAfterRejection: () => void;
  onAddReplacement: () => void;
  onCancelOrder: () => void;
}) {
  const t = useT();
  const waitingDecision = order.status === 'partially_rejected' && order.requiresWaiterDecision;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{t('Заказ')} {displayOrderNumber(order.orderNumber)}</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {t('Стол')} {order.table.number}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <OrderBadge status={order.status} />
          {waitingDecision && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              {t('Нужен ответ')}
            </span>
          )}
        </div>
      </div>

      {/* Позиции — компактный список */}
      <div className="no-scrollbar flex-1 space-y-1.5 overflow-y-auto py-3">
        {order.items.map((it) => {
          const rejected = it.status === 'rejected';
          const waitingItem = waitingDecision && !rejected;
          const comment = safeComment(it.comment);
          const hasExtra = comment || (rejected && it.rejectReason) || waitingItem;
          return (
            <div
              key={it.id}
              className={`rounded-lg border px-3 py-2 ${
                rejected
                  ? 'border-danger/30 bg-danger/5'
                  : waitingItem
                    ? 'border-warning/20 bg-warning/5'
                    : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`min-w-0 flex-1 truncate text-[15px] ${
                    rejected ? 'text-danger line-through' : 'text-text-primary'
                  }`}
                >
                  {orderItemDisplayName(it)}
                </span>
                <span className="shrink-0 text-sm text-text-secondary">×{it.quantity}</span>
                <span className="shrink-0 min-w-[56px] text-right text-[15px] font-medium text-text-primary">
                  {money(it.finalPrice)}
                </span>
              </div>
              {hasExtra && (
                <div className="mt-0.5 text-xs">
                  {comment && <p className="text-text-muted">{comment}</p>}
                  {rejected && it.rejectReason && <p className="text-danger">{t('Отказ')}: {it.rejectReason}</p>}
                  {waitingItem && <p className="text-warning">{t('Ожидает решения клиента')}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Низ */}
      <div className="border-t border-border pt-3">
        {order.comment && (
          <p className="mb-2 rounded-lg bg-background px-3 py-2 text-sm text-text-secondary">
            {order.comment}
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-medium text-text-secondary">{t('Итого')}</span>
          <span className="text-xl font-semibold text-text-primary">{money(order.finalAmount)}</span>
        </div>

        <div className="mt-3">
          <ActionButton
            order={order}
            submitting={submitting}
            onPickedUp={onPickedUp}
            onServed={onServed}
            onToPayment={onToPayment}
            onContinueAfterRejection={onContinueAfterRejection}
            onAddReplacement={onAddReplacement}
            onCancelOrder={onCancelOrder}
          />
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  order,
  submitting,
  onPickedUp,
  onServed,
  onToPayment,
  onContinueAfterRejection,
  onAddReplacement,
  onCancelOrder,
}: {
  order: Order;
  submitting: boolean;
  onPickedUp: () => void;
  onServed: () => void;
  onToPayment: () => void;
  onContinueAfterRejection: () => void;
  onAddReplacement: () => void;
  onCancelOrder: () => void;
}) {
  const t = useT();
  const s = order.status;
  const spin = submitting ? <Spinner /> : null;
  const waitingDecision = s === 'partially_rejected' && order.requiresWaiterDecision;
  const hasReadyItem = order.items.some((item) => item.status === 'ready');

  if (waitingDecision) {
    return (
      <div className="space-y-2.5">
        <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('Кухня отказала часть заказа. Уточните у клиента, что делать дальше.')}
        </div>
        <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onContinueAfterRejection}>
          {spin ?? t('Продолжить без отказанного блюда')}
        </button>
        <button className="btn-secondary btn-lg w-full font-semibold" disabled={submitting} onClick={onAddReplacement}>
          {t('Добавить замену')}
        </button>
        <button className="btn-danger btn-lg w-full font-semibold" disabled={submitting} onClick={onCancelOrder}>
          {t('Отменить весь заказ')}
        </button>
      </div>
    );
  }

  if (
    hasReadyItem &&
    !['paid', 'cancelled', 'rejected', 'waiting_payment', 'picked_up', 'served'].includes(s)
  ) {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onPickedUp}>
        {spin ?? t('Забрал с кухни')}
      </button>
    );
  }

  if (s === 'sent_to_kitchen' || s === 'accepted_by_kitchen' || s === 'cooking' || s === 'partially_rejected') {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl bg-background px-3 py-2.5 text-sm text-text-muted">
        <InfoIcon />
        <span>{t(ORDER_STATUS[s].label)} - {t('ожидаем кухню')}</span>
      </div>
    );
  }
  if (s === 'picked_up') {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onServed}>
        {spin ?? t('Вынес гостям')}
      </button>
    );
  }
  if (s === 'served') {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onToPayment}>
        {spin ?? t('Перейти к оплате')}
      </button>
    );
  }
  if (s === 'waiting_payment') {
    return (
      <div className="rounded-xl bg-purple-50 py-3 text-center text-sm text-purple-600">
        {t('Ожидает оплаты')}
      </div>
    );
  }
  if (s === 'rejected') {
    return (
      <div className="rounded-xl bg-danger/5 py-3 text-center text-sm text-danger">
        {t('Кухня отказала в заказе')}
      </div>
    );
  }
  return null;
}
