import type { OrderStatus, TableStatus } from '@/types';
import { ORDER_STATUS, TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';

export function OrderBadge({ status }: { status: OrderStatus }) {
  const t = useT();
  const meta = ORDER_STATUS[status];
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
      {t(meta.label)}
    </span>
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
