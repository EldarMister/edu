import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { displayOrderNumber, money, timeHM } from '@/lib/format';

export function OrdersList({
  orders,
  onOpen,
}: {
  orders: Order[];
  onOpen: (order: Order) => void;
}) {
  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-text-muted">Активных заказов нет</p>;
  }
  const sortedOrders = [...orders].sort((a, b) => {
    const aAttention = isAttentionOrder(a) ? 1 : 0;
    const bAttention = isAttentionOrder(b) ? 1 : 0;
    if (aAttention !== bAttention) return bAttention - aAttention;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-3 px-1.5">
      {sortedOrders.map((o) => {
        const attention = isAttentionOrder(o);
        return (
          <div
            key={o.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(o)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(o);
              }
            }}
            className={`card flex w-full cursor-pointer items-stretch gap-3 px-4 py-3.5 text-left transition-colors hover:border-primary/40 ${
              attention ? 'border-primary/40 bg-primary/5 shadow-soft' : ''
            }`}
          >
            {/* Левая часть: номер, стол, время, позиции */}
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-base font-semibold text-text-primary">
                  {displayOrderNumber(o.orderNumber)}
                </span>
                <span className="text-sm text-text-muted">Стол {o.table.number}</span>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-text-light">
                <ClockIcon />
                {timeHM(o.createdAt)} · {o.items.length} поз.
              </p>
            </div>

            {/* Правая часть: статус сверху, сумма снизу — зеркально левой */}
            <div className="flex shrink-0 flex-col items-end justify-between gap-2">
              <OrderBadge status={o.status} />
              <span className="text-base font-semibold text-text-primary">
                {money(o.finalAmount)}
              </span>
            </div>

            {/* Три точки — дополнительные действия (открывает заказ) */}
            <button
              type="button"
              aria-label="Действия с заказом"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(o);
              }}
              className="-mr-1.5 flex w-6 shrink-0 items-center justify-center self-center rounded-lg py-2 text-text-light transition-colors hover:bg-background hover:text-text-secondary"
            >
              <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" aria-hidden>
                <circle cx="2" cy="2" r="1.6" />
                <circle cx="2" cy="8" r="1.6" />
                <circle cx="2" cy="14" r="1.6" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function isAttentionOrder(order: Order) {
  return order.requiresWaiterDecision || ['ready', 'rejected'].includes(order.status);
}
