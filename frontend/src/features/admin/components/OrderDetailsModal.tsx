import { Modal } from '@/components/Modal';
import { OrderBadge } from '@/components/StatusBadge';
import type { Order, OrderItemStatus } from '@/types';
import { displayOrderNumber, money, orderItemDisplayName, paymentMethodLabel, timeHM } from '@/lib/format';

const ITEM_STATUS: Record<OrderItemStatus, string> = {
  new: 'Новое',
  accepted: 'Принято',
  cooking: 'Готовится',
  ready: 'Готово',
  rejected: 'Отказано',
  served: 'Подано',
  cancelled: 'Отменено',
};

export function OrderDetailsModal({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  if (!order) return null;

  const date = new Date(order.createdAt);

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={`Заказ ${displayOrderNumber(order.orderNumber)}`}
      panelClassName="max-w-2xl"
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Info label="Статус" value={<OrderBadge status={order.status} />} />
          <Info label="Дата и время" value={`${date.toLocaleDateString('ru-RU')} ${timeHM(order.createdAt)}`} />
          <Info label="Стол" value={`Стол ${order.table.number}`} />
          <Info label="Официант" value={order.waiter.name} />
          <Info label="Сумма" value={money(order.finalAmount)} strong />
          <Info label="Скидка" value={money(order.discountAmount)} />
          <Info label="Способ оплаты" value={paymentMethodLabel(order.paymentMethod)} />
        </div>

        {order.comment && (
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Комментарий</p>
            <p className="mt-1 text-sm text-text-primary">{order.comment}</p>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-semibold text-text-primary">Блюда</h4>
            <span className="text-sm text-text-muted">{order.items.length} поз.</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            {order.items.map((item) => (
              <div key={item.id} className="border-b border-border px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">
                      {item.quantity}× {orderItemDisplayName(item)}
                    </p>
                    {item.comment && <p className="mt-1 text-sm text-warning">{item.comment}</p>}
                    {item.rejectReason && <p className="mt-1 text-sm text-danger">Отказ: {item.rejectReason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-text-primary">{money(item.finalPrice)}</p>
                    <p className="mt-1 text-xs text-text-muted">{ITEM_STATUS[item.status]}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-2 border-t border-border pt-4 text-sm">
          <Total label="Итого" value={money(order.totalAmount)} />
          <Total label="Скидка" value={money(order.discountAmount)} />
          {Number(order.serviceChargeAmount) > 0 && (
            <Total label="Обслуживание" value={money(order.serviceChargeAmount)} />
          )}
          <Total label="К оплате" value={money(order.finalAmount)} strong />
        </div>
      </div>
    </Modal>
  );
}

function Info({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <div className={`mt-1 text-sm ${strong ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
        {value}
      </div>
    </div>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'text-base font-semibold text-text-primary' : 'text-text-secondary'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
