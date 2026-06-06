import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { ORDER_STATUS } from '@/lib/status';
import { displayOrderNumber, money } from '@/lib/format';
import { Spinner } from '@/components/Spinner';

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
  const waitingDecision = order.status === 'partially_rejected' && order.requiresWaiterDecision;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Заказ {displayOrderNumber(order.orderNumber)}</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Стол {order.table.number}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <OrderBadge status={order.status} />
          {waitingDecision && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              Нужен ответ
            </span>
          )}
        </div>
      </div>

      {/* Позиции */}
      <div className="no-scrollbar flex-1 space-y-2.5 overflow-y-auto py-3">
        {order.items.map((it) => {
          const rejected = it.status === 'rejected';
          const waitingItem = waitingDecision && !rejected;
          return (
            <div
              key={it.id}
              className={`rounded-xl border p-3 ${
                rejected
                  ? 'border-danger/30 bg-danger/5'
                  : waitingItem
                    ? 'border-warning/20 bg-warning/5'
                    : 'border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-[15px] font-medium ${rejected ? 'text-danger line-through' : 'text-text-primary'}`}>
                    {it.dishNameSnapshot}
                  </p>
                  {safeComment(it.comment) && <p className="text-xs text-text-muted">{it.comment}</p>}
                  {rejected && it.rejectReason && (
                    <p className="text-xs text-danger">Отказ: {it.rejectReason}</p>
                  )}
                  {waitingItem && (
                    <p className="text-xs text-warning">Ожидает решения клиента</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm text-text-secondary">×{it.quantity}</p>
                  <p className="text-[15px] font-medium text-text-primary">{money(it.finalPrice)}</p>
                </div>
              </div>
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
          <span className="text-[15px] font-medium text-text-secondary">Итого</span>
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
  const s = order.status;
  const spin = submitting ? <Spinner /> : null;
  const waitingDecision = s === 'partially_rejected' && order.requiresWaiterDecision;
  const hasReadyItem = order.items.some((item) => item.status === 'ready');

  if (waitingDecision) {
    return (
      <div className="space-y-2.5">
        <div className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
          Кухня отказала часть заказа. Уточните у клиента, что делать дальше.
        </div>
        <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onContinueAfterRejection}>
          {spin ?? 'Продолжить без отказанного блюда'}
        </button>
        <button className="btn-secondary btn-lg w-full font-semibold" disabled={submitting} onClick={onAddReplacement}>
          Добавить замену
        </button>
        <button className="btn-danger btn-lg w-full font-semibold" disabled={submitting} onClick={onCancelOrder}>
          Отменить весь заказ
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
        {spin ?? 'Забрал с кухни'}
      </button>
    );
  }

  if (s === 'sent_to_kitchen' || s === 'accepted_by_kitchen' || s === 'cooking' || s === 'partially_rejected') {
    return (
      <div className="rounded-xl bg-background py-3 text-center text-sm text-text-muted">
        {ORDER_STATUS[s].label} — ожидаем кухню
      </div>
    );
  }
  if (s === 'picked_up') {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onServed}>
        {spin ?? 'Вынес гостям'}
      </button>
    );
  }
  if (s === 'served') {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onToPayment}>
        {spin ?? 'Перейти к оплате'}
      </button>
    );
  }
  if (s === 'waiting_payment') {
    return (
      <div className="rounded-xl bg-purple-50 py-3 text-center text-sm text-purple-600">
        Ожидает оплаты
      </div>
    );
  }
  if (s === 'rejected') {
    return (
      <div className="rounded-xl bg-danger/5 py-3 text-center text-sm text-danger">
        Кухня отказала в заказе
      </div>
    );
  }
  return null;
}
