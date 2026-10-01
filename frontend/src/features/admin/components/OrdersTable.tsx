import type { RefObject } from 'react';
import type { Order } from '@/types';
import { OrderStatusBadges } from '@/components/StatusBadge';
import { Spinner } from '@/components/Spinner';
import { displayOrderNumber, hallSuffix, money, paymentCell, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { IconEdit, IconX } from './icons';

/** Заказ можно отменить, пока он не оплачен/не отменён/не отклонён. */
const CANCELLABLE = new Set([
  'draft', 'sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready',
  'picked_up', 'served', 'waiting_payment', 'partially_rejected',
]);

type Props = {
  items: Order[];
  isLoading: boolean;
  error: string | null;
  scrollRef: RefObject<HTMLDivElement>;
  loadMoreRef: RefObject<HTMLDivElement>;
  isFetchingNextPage: boolean;
  hasNextPage: boolean | undefined;
  onOpen: (order: Order) => void;
  onEdit: (order: Order) => void;
  onCancel: (order: Order) => void;
};

export function OrdersTable({ items, isLoading, error, scrollRef, loadMoreRef, isFetchingNextPage, hasNextPage, onOpen, onEdit, onCancel }: Props) {
  const tr = useT();
  return (
    <div className="orders-table-card">
      {isLoading ? (
        <div className="flex justify-center py-12 text-primary"><Spinner className="h-6 w-6" /></div>
      ) : error ? (
        <div className="px-4 py-12 text-center">
          <p className="font-medium text-danger">{tr('Не удалось загрузить заказы')}</p>
          <p className="mt-1 text-sm text-text-muted">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-text-muted">{tr('Заказы не найдены')}</p>
      ) : (
        <div ref={scrollRef} className="orders-table-scroll menu-scrollbar">
          <table className="orders-table">
            <colgroup>
              <col className="w-[8%]" /><col className="w-[14%]" /><col className="w-[10%]" /><col className="w-[11%]" />
              <col className="w-[9%]" /><col className="w-[19%]" /><col className="w-[21%]" /><col className="w-[8%]" />
            </colgroup>
            <thead><tr>
              <Th>{tr('№ заказа')}</Th>
              <Th>{tr('Дата и время')}</Th>
              <Th>{tr('Стол')}</Th>
              <Th>{tr('Официант')}</Th>
              <Th className="text-right">{tr('Сумма')}</Th>
              <Th className="pl-4">{tr('Статус заказа')}</Th>
              <Th>{tr('Способ оплаты')}</Th>
              <Th className="px-1 text-center">{tr('Действия')}</Th>
            </tr></thead>
            <tbody>
              {items.map((order) => (
                <tr
                  key={order.id}
                  className="orders-table-row"
                  tabIndex={0}
                  role="button"
                  onClick={() => onOpen(order)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpen(order);
                    }
                  }}
                >
                  <Td className="font-medium text-text-primary">{displayOrderNumber(order.orderNumber)}</Td>
                  <Td className="whitespace-nowrap text-text-secondary">{new Date(order.createdAt).toLocaleDateString('ru-RU')} {timeHM(order.createdAt)}</Td>
                  <Td className="text-text-secondary">{order.source === 'delivery' ? '—' : <>{tr('Стол')} {order.table.number}{hallSuffix(order.table)}</>}</Td>
                  <Td className="text-text-secondary">
                    {order.source === 'delivery' ? <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{tr('Доставка')}</span> : order.waiter?.name ?? 'QR menu'}
                  </Td>
                  <Td className="text-right font-medium text-text-primary">{money(order.finalAmount)}</Td>
                  <Td className="order-status-cell pl-4"><OrderStatusBadges order={order} size="sm" className="flex flex-nowrap items-center justify-start gap-1" /></Td>
                  <Td className="whitespace-nowrap text-text-secondary">{paymentCell(order)}</Td>
                  <Td className="px-1">
                    <div className="flex items-center justify-center gap-1">
                      <OrderRowAction label={tr('Изменить статус')} onClick={() => onEdit(order)}><IconEdit className="h-4 w-4" /></OrderRowAction>
                      {CANCELLABLE.has(order.status) && <OrderRowAction label={tr('Отменить')} danger onClick={() => onCancel(order)}><IconX className="h-4 w-4" /></OrderRowAction>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={loadMoreRef} />
          {isFetchingNextPage && <div className="flex justify-center py-3 text-primary"><Spinner className="h-5 w-5" /></div>}
          {!hasNextPage && <p className="py-3 text-center text-xs text-text-light">{tr('Все заказы загружены')}</p>}
        </div>
      )}
    </div>
  );
}

function OrderRowAction({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`orders-row-action ${danger ? 'orders-row-action-danger' : ''}`}
      title={label}
      aria-label={label}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
    >
      {children}
    </button>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
