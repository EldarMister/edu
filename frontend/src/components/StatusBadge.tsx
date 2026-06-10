import type { OrderStatus, TableStatus } from '@/types';
import { ORDER_STATUS, TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';

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

export function TableBadge({ status }: { status: TableStatus }) {
  const t = useT();
  const meta = TABLE_STATUS[status];
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
      {t(meta.label)}
    </span>
  );
}
