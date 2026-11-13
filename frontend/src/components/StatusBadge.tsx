import type { Order, OrderStatus, TableStatus } from '@/types';
import { ORDER_STATUS, TABLE_STATUS, orderStationStatuses } from '@/lib/status';
import { useT } from '@/lib/i18n';
import { usePreparationStations } from '@/features/kitchen/stations';

export function OrderBadge({ status, size = 'md' }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  const t = useT();
  const meta = ORDER_STATUS[status];
  const sizeCls = size === 'sm' ? 'rounded-md px-2 py-0.5 text-[11px]' : 'rounded-lg px-2.5 py-1 text-xs';
  return (
    <span className={`inline-flex items-center whitespace-nowrap font-medium ${sizeCls} ${meta.badge}`}>
      {t(meta.label)}
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
  if (chips.length === 0) return <OrderBadge status={order.status} size={size} />;
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
