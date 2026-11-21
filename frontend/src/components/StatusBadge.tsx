import type { Order, OrderStatus, TableStatus } from '@/types';
import { ORDER_STATUS, TABLE_STATUS, orderStationStatuses } from '@/lib/status';
import { useT } from '@/lib/i18n';
import { usePreparationStations } from '@/features/kitchen/stations';

export function OrderBadge({ status, source, size = 'md' }: { status: OrderStatus; source?: Order['source']; size?: 'sm' | 'md' }) {
  const t = useT();
  const meta = ORDER_STATUS[status];
  const deliveryStatus = source === 'delivery' && (status === 'ready' ? 'Готов к выдаче'
    : status === 'picked_up' ? 'В пути' : status === 'served' ? 'Доставлен' : null);
  const sizeCls = size === 'sm' ? 'rounded-md px-2 py-0.5 text-[11px]' : 'rounded-lg px-2.5 py-1 text-xs';
  return (
    <span className={`inline-flex items-center whitespace-nowrap font-medium ${sizeCls} ${meta.badge}`}>
      {t(deliveryStatus || meta.label)}
    </span>
  );
}

/**
 * Общий статус заказа или отдельные статусы станций.
 */
export function OrderStatusBadges({
  order,
  size = 'md',
  className = 'flex flex-wrap items-center justify-end gap-1',
}: {
  order: Order;
  size?: 'sm' | 'md';
  /** Раскладка контейнера чипов. На узких карточках передают вертикальный стек. */
  className?: string;
}) {
  const t = useT();
  const chips = orderStationStatuses(order);
  const stations = usePreparationStations(chips.some((chip) => chip.station !== 'kitchen' && chip.station !== 'bar'));
  const sizeCls = size === 'sm' ? 'rounded-md px-2 py-0.5 text-[11px]' : 'rounded-lg px-2.5 py-1 text-xs';
  if (order.paymentStatus === 'refunded' || Number(order.refundedAmount ?? 0) > 0) {
    return <span className={`inline-flex whitespace-nowrap font-medium bg-warning/10 text-warning ${sizeCls}`}>
      {t(order.paymentStatus === 'refunded' ? 'Возвращён' : 'Частичный возврат')}
    </span>;
  }
  if (chips.length === 0) return <OrderBadge status={order.status} source={order.source} size={size} />;
  return (
    <div className={className}>
      {chips.map((c) => (
        <span
          key={c.station}
          className={`inline-flex shrink-0 items-center whitespace-nowrap font-medium ${sizeCls} ${c.badge}`}
        >
          {t(stations.data?.find((station) => station.id === c.station)?.name ?? c.stationLabel)}: {t(c.label)}
        </span>
      ))}
    </div>
  );
}

export function TableBadge({ status }: { status: TableStatus }) {
  const t = useT();
  const meta = TABLE_STATUS[status];
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
      {t(meta.label)}
    </span>
  );
}
