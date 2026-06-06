import { useState } from 'react';
import type { Order, PaymentMethod, Receipt } from '@/types';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { displayOrderNumber, money } from '@/lib/format';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { usePublicSettings } from '@/features/settings/api';
import { usePay, fetchReceipt } from './api';
import { printReceipt } from './printReceipt';

const ALL_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'qr', label: 'QR-код' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
];

export function PaymentModal({
  order,
  open,
  onClose,
  onPaid,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
}) {
  const pay = usePay();
  const push = useNotifications((s) => s.push);
  const settings = usePublicSettings();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // Только включённые в настройках способы оплаты.
  const enabled = settings.data?.paymentMethods ?? (['qr', 'cash'] as PaymentMethod[]);
  const methods = ALL_METHODS.filter((m) => enabled.includes(m.value));
  const selected: PaymentMethod =
    method && enabled.includes(method) ? method : methods[0]?.value ?? 'qr';

  async function onConfirm() {
    setError('');
    try {
      await pay.mutateAsync({ orderId: order.id, method: selected });
      push({ message: 'Оплата принята', type: 'success', at: new Date().toISOString() });
      const r = await fetchReceipt(order.id);
      setReceipt(r);
    } catch (err) {
      setError(apiError(err));
    }
  }

  function close() {
    setReceipt(null);
    setError('');
    setMethod(null);
    onClose();
    if (receipt) onPaid();
  }

  // Шаг 2 — чек после успешной оплаты
  if (receipt) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="Оплата принята"
        footer={
          <div className="flex gap-2">
            <button className="btn-secondary btn-lg flex-1" onClick={close}>
              Готово
            </button>
            <button className="btn-primary btn-lg flex-1 font-semibold" onClick={() => printReceipt(receipt)}>
              Печать чека
            </button>
          </div>
        }
      >
        <div className="rounded-xl border border-border p-4 text-sm">
          <p className="text-center text-base font-semibold">{receipt.cafeName}</p>
          <p className="mb-3 text-center text-xs text-text-muted">
            {displayOrderNumber(receipt.orderNumber)} · Стол {receipt.tableNumber}
          </p>
          <div className="space-y-1">
            {receipt.items.map((it, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-text-secondary">
                  {it.dishNameSnapshot} <span className="text-text-light">×{it.quantity}</span>
                </span>
                <span>{money(it.finalPrice)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Итого</span>
            <span>{money(receipt.finalAmount)}</span>
          </div>
        </div>
      </Modal>
    );
  }

  // Шаг 1 — выбор способа оплаты
  return (
    <Modal
      open={open}
      onClose={close}
      title="Оплата заказа"
      footer={
        <button
          className="btn-primary btn-lg w-full font-semibold"
          disabled={pay.isPending}
          onClick={onConfirm}
        >
          {pay.isPending ? <Spinner /> : `Принять оплату · ${money(order.finalAmount)}`}
        </button>
      }
    >
      <p className="mb-1 text-sm text-text-muted">
        Стол {order.table.number} · {displayOrderNumber(order.orderNumber)}
      </p>
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-text-secondary">К оплате</span>
        <span className="text-2xl font-semibold">{money(order.finalAmount)}</span>
      </div>

      <p className="mb-2 text-sm font-medium text-text-secondary">Способ оплаты</p>
      <div className={`grid gap-2 ${methods.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {methods.map((m) => (
          <button
            key={m.value}
            onClick={() => setMethod(m.value)}
            className={`rounded-xl border px-4 py-3 text-[15px] font-medium transition-colors ${
              selected === m.value
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border text-text-secondary hover:border-primary/40'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
