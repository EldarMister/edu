import type { ReactNode, RefObject } from 'react';
import type { Order } from '@/types';
import { OrderStatusBadges } from '@/components/StatusBadge';
import { Spinner } from '@/components/Spinner';
import { WorkspacePending } from './WorkspacePending';
import { usePermissions } from '@/hooks/usePermissions';
import { displayOrderNumber, money, orderPlaceLabel, paymentCell } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { IconEdit, IconX } from './icons';

/** Заказ можно отменить, пока он не оплачен/не отменён/не отклонён. */
const CANCELLABLE = new Set([
  'draft', 'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready',
  'picked_up', 'served', 'waiting_payment', 'partially_rejected',
]);
const businessDateTime = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', dateStyle: 'short', timeStyle: 'short' });

const orderColumns = {
  number: { label: '№ заказа', width: 92, className: 'font-medium text-text-primary' },
  date: { label: 'Дата и время', width: 156, className: 'whitespace-nowrap' },
  table: { label: 'Стол', width: 122 },
  waiter: { label: 'Официант', width: 128 },
  amount: { label: 'Сумма', width: 104, className: 'text-right font-medium text-text-primary' },
  status: { label: 'Статус заказа', width: 198, className: 'order-status-cell pl-4' },
  payment: { label: 'Способ оплаты', width: 164 },
  comment: { label: 'Комментарий', width: 220 },
  actions: { label: 'Действия', width: 100, className: 'px-1 text-center' },
} satisfies Record<string, { label: string; width: number; className?: string }>;

type OrderColumn = keyof typeof orderColumns;
export const availableOrderColumns = Object.keys(orderColumns) as OrderColumn[];
export const defaultOrderColumns: OrderColumn[] = availableOrderColumns.filter((key) => key !== 'comment');
export function orderColumnLabel(column: OrderColumn) {
  return orderColumns[column].label;
}
export function orderTableWidth(columns: OrderColumn[]) {
  return columns.reduce((sum, key) => sum + orderColumns[key].width, 0);
}

type Props = {
  items: Order[];
  byClose?: boolean;
  isLoading: boolean;
  error: string | null;
  columns: OrderColumn[];
  loadMoreRef: RefObject<HTMLDivElement>;
  isFetchingNextPage: boolean;
  hasNextPage: boolean | undefined;
  onOpen: (order: Order) => void;
  onEdit?: (order: Order) => void;
  onCancel?: (order: Order) => void;
};

export function OrdersTable({ items, byClose = false, isLoading, error, columns, loadMoreRef, isFetchingNextPage, hasNextPage, onOpen, onEdit, onCancel }: Props) {
  const tr = useT();
  const { canEditSection, canOwnerOperation } = usePermissions();
  const editable = canEditSection('orders');
  const minWidth = orderTableWidth(columns);

  function renderRow(order: Order) {
    const date = byClose ? order.closedAt : order.createdAt;
    const cells: Record<OrderColumn, ReactNode> = {
      number: <button type="button" className="rounded-sm text-left hover:text-primary hover:underline focus-visible:outline-primary">
        {displayOrderNumber(order.orderNumber)}
      </button>,
      date: date ? businessDateTime.format(new Date(date)) : '—',
      table: order.source === 'delivery' || order.source === 'pickup'
        ? <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{tr(order.source === 'pickup' ? 'Самовывоз' : 'Доставка')}</span>
        : orderPlaceLabel(order, tr),
      waiter: order.waiter?.name ?? (order.source === 'delivery' ? tr('Онлайн-заказ') : 'QR menu'),
      amount: money(order.finalAmount),
      status: <OrderStatusBadges order={order} size="sm" className="flex flex-wrap items-center gap-1" />,
      payment: paymentCell(order, tr),
      comment: order.comment ? <span className="block truncate" title={order.comment}>{order.comment}</span> : '—',
      actions: <div className="flex items-center justify-center gap-1">
        {editable && onEdit && order.status !== 'paid' && <OrderRowAction label={tr('Изменить статус')} onClick={() => onEdit(order)}><IconEdit className="h-4 w-4" /></OrderRowAction>}
        {editable && onCancel && canOwnerOperation('cancelOrders') && CANCELLABLE.has(order.status) && <OrderRowAction label={tr('Отменить')} danger onClick={() => onCancel(order)}><IconX className="h-4 w-4" /></OrderRowAction>}
      </div>,
    };
    return (
      <tr key={order.id} className="orders-table-row" onClick={() => onOpen(order)}>
        {columns.map((key) => <Td key={key} className={orderColumnClass(key)}>{cells[key]}</Td>)}
      </tr>
    );
  }

  return (
    <div className="orders-table-card">
      {isLoading ? (
        <WorkspacePending />
      ) : error ? (
        <div className="px-4 py-12 text-center">
          <p className="font-medium text-danger">{tr('Не удалось загрузить заказы')}</p>
          <p className="mt-1 text-sm text-text-muted">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-text-muted">{tr('Заказы не найдены')}</p>
      ) : (
        <>
          <table className="orders-table" aria-label={tr('Заказы')}>
            <colgroup>
              {columns.map((key) => <col key={key} style={{ width: (orderColumns[key].width / minWidth) * 100 + '%' }} />)}
            </colgroup>
            <thead><tr>
              {columns.map((key) => <Th key={key} className={orderColumnClass(key)}>{tr(key === 'date' && byClose ? 'Дата закрытия' : orderColumnLabel(key))}</Th>)}
            </tr></thead>
            <tbody>{items.map(renderRow)}</tbody>
          </table>
          <div ref={loadMoreRef} />
          {isFetchingNextPage && <div className="flex justify-center py-3 text-primary"><Spinner className="h-5 w-5" /></div>}
          {!hasNextPage && <p className="py-3 text-center text-xs text-text-light">{tr('Все заказы загружены')}</p>}
        </>
      )}
    </div>
  );
}

function orderColumnClass(key: OrderColumn) {
  const column = orderColumns[key];
  return 'className' in column ? column.className : '';
}

function OrderRowAction({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={danger ? 'orders-row-action orders-row-action-danger' : 'row-action-icon'}
      title={label}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
    >
      {children}
    </button>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th scope="col" className={`px-3 py-2.5 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
