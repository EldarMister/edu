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
}: {
  order: Order;
  submitting: boolean;
  onPickedUp: () => void;
  onServed: () => void;
  onToPayment: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Заказ {displayOrderNumber(order.orderNumber)}</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Стол {order.table.number}
          </p>
        </div>
        <OrderBadge status={order.status} />
      </div>

      {/* Позиции */}
      <div className="no-scrollbar flex-1 space-y-2.5 overflow-y-auto py-3">
        {order.items.map((it) => {
          const rejected = it.status === 'rejected';
          return (
            <div
              key={it.id}
              className={`rounded-xl border p-3 ${rejected ? 'border-danger/30 bg-danger/5' : 'border-border'}`}
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
}: {
  order: Order;
  submitting: boolean;
  onPickedUp: () => void;
  onServed: () => void;
  onToPayment: () => void;
}) {
  const s = order.status;
  const spin = submitting ? <Spinner /> : null;

  if (s === 'sent_to_kitchen' || s === 'accepted_by_kitchen' || s === 'cooking') {
    return (
      <div className="rounded-xl bg-background py-3 text-center text-sm text-text-muted">
        {ORDER_STATUS[s].label} — ожидаем кухню
      </div>
    );
  }
  if (s === 'ready' || s === 'partially_rejected') {
    return (
      <button className="btn-primary btn-lg w-full font-semibold" disabled={submitting} onClick={onPickedUp}>
        {spin ?? 'Забрал с кухни'}
      </button>
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
