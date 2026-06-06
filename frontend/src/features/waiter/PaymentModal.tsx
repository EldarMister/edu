import { useEffect, useState } from 'react';
import type { Order, PaymentMethod, Receipt } from '@/types';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { displayOrderNumber, money } from '@/lib/format';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { usePublicSettings, resolveQrSrc } from '@/features/settings/api';
import { beep } from '@/lib/sound';
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
  // Промежуточное окно успешной оплаты: показывается ~1.3с, затем открывается чек.
  const [showSuccess, setShowSuccess] = useState(false);

  // Только включённые в настройках способы оплаты.
  const enabled = settings.data?.paymentMethods ?? (['qr', 'cash'] as PaymentMethod[]);
  const methods = ALL_METHODS.filter((m) => enabled.includes(m.value));
  const selected: PaymentMethod =
    method && enabled.includes(method) ? method : methods[0]?.value ?? 'qr';

  const qrImageUrl = resolveQrSrc(settings.data?.qrImageUrl);
  const qrSelected = selected === 'qr';
  const qrMissing = qrSelected && !qrImageUrl;

  // После показа success-окна автоматически переходим к окну печати чека.
  useEffect(() => {
    if (!showSuccess) return;
    const t = setTimeout(() => setShowSuccess(false), 1300);
    return () => clearTimeout(t);
  }, [showSuccess]);

  async function onConfirm() {
    setError('');
    try {
      await pay.mutateAsync({ orderId: order.id, method: selected });
      beep('payment');
      push({ message: 'Оплата принята', type: 'success', at: new Date().toISOString() });
      const r = await fetchReceipt(order.id);
      setReceipt(r);
      setShowSuccess(true);
    } catch (err) {
      setError(apiError(err));
    }
  }

  function close() {
    setReceipt(null);
    setShowSuccess(false);
    setError('');
    setMethod(null);
    onClose();
    if (receipt) onPaid();
  }

  // Промежуточный шаг — анимированное подтверждение оплаты
  if (showSuccess) {
    return (
      <div className="modal-backdrop z-50 flex items-center justify-center p-4">
        <div className="animate-card-pop relative z-10 flex w-full max-w-[300px] flex-col items-center rounded-2xl bg-white px-6 py-8 text-center shadow-soft">
          <div className="animate-check-pop flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">Оплата принята</h3>
          <p className="mt-1 text-sm text-text-muted">Платёж успешно подтверждён</p>
          <p className="mt-3 text-2xl font-semibold text-text-primary">{money(order.finalAmount)}</p>
          <div className="mt-5 flex items-center gap-2 text-xs text-text-light">
            <Spinner className="h-3.5 w-3.5" />
            <span>Переходим к чеку…</span>
          </div>
        </div>
      </div>
    );
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
          disabled={pay.isPending || qrMissing}
          onClick={onConfirm}
        >
          {pay.isPending ? (
            <Spinner />
          ) : qrSelected ? (
            `Оплачено · ${money(order.finalAmount)}`
          ) : (
            `Принять оплату · ${money(order.finalAmount)}`
          )}
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

      {/* QR-код для оплаты */}
      {qrSelected && (
        <div className="mt-4">
          {qrImageUrl ? (
            <div className="flex flex-col items-center rounded-xl border border-border bg-white p-4">
              <p className="mb-3 text-sm text-text-secondary">Покажите QR-код клиенту для оплаты</p>
              <img
                src={qrImageUrl}
                alt="QR-код для оплаты"
                className="h-56 w-56 object-contain"
              />
              <p className="mt-3 text-center text-xs text-text-muted">
                После оплаты клиентом нажмите «Оплачено»
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-center text-sm text-warning">
              QR-код не загружен. Добавьте его в настройках или выберите другой способ оплаты.
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
