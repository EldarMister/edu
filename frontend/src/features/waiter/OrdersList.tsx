import type { Order } from '@/types';
import { OrderBadge } from '@/components/StatusBadge';
import { money, timeHM } from '@/lib/format';

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
  return (
    <div className="space-y-2.5">
      {orders.map((o) => (
        <button
          key={o.id}
          onClick={() => onOpen(o)}
          className="card flex w-full items-center justify-between p-4 text-left hover:border-primary/40"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-text-primary">{o.orderNumber}</span>
              <span className="text-sm text-text-muted">Стол {o.table.number}</span>
            </div>
            <p className="mt-1 text-xs text-text-light">
              {timeHM(o.createdAt)} · {o.items.length} поз.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <OrderBadge status={o.status} />
            <span className="text-[15px] font-semibold text-text-primary">{money(o.finalAmount)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
