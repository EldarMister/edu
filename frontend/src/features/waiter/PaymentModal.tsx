import { useEffect, useState } from 'react';
import type { Order, PaymentMethod, Receipt } from '@/types';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { displayOrderNumber, money, orderItemDisplayName } from '@/lib/format';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { usePublicSettings, resolveQrSrc } from '@/features/settings/api';
import { beep } from '@/lib/sound';
import { usePay, fetchReceipt, useCreateReceiptPrintRequest } from './api';
import { useReceiptPrint } from './receiptPrint';
import { SplitBillSheet } from './SplitBillSheet';

const ALL_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'qr', label: 'QR-код' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
  mixed: 'Смешанная',
};

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
  const t = useT();
  const pay = usePay();
  const createPrintRequest = useCreateReceiptPrintRequest();
  const beginPrint = useReceiptPrint((s) => s.begin);
  const push = useNotifications((s) => s.push);
  const settings = usePublicSettings();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // Промежуточное окно успешной оплаты: показывается ~1.3с, затем открывается чек.
  const [showSuccess, setShowSuccess] = useState(false);
  // Суммы для смешанной оплаты (как строки из инпутов).
  const [cashInput, setCashInput] = useState('');
  const [qrInput, setQrInput] = useState('');
  // Окно «Разделение счёта».
  const [splitOpen, setSplitOpen] = useState(false);

  // Только включённые в настройках способы оплаты. «Смешанная» доступна,
  // если включены и наличные, и QR (она из них и складывается).
  const enabled = settings.data?.paymentMethods ?? (['qr', 'cash'] as PaymentMethod[]);
  const mixedAvailable = enabled.includes('qr') && enabled.includes('cash');
  const methods: { value: PaymentMethod; label: string }[] = [
    ...ALL_METHODS.filter((m) => enabled.includes(m.value)),
    ...(mixedAvailable ? [{ value: 'mixed' as PaymentMethod, label: 'Смешанная' }] : []),
  ];
  const selected: PaymentMethod =
    method && methods.some((m) => m.value === method) ? method : methods[0]?.value ?? 'qr';

  const qrImageUrl = resolveQrSrc(settings.data?.qrImageUrl);
  const qrSelected = selected === 'qr';
  const qrMissing = qrSelected && !qrImageUrl;

  // Расчёты для смешанной оплаты.
  const total = Number(order.finalAmount);
  const mixedSelected = selected === 'mixed';
  const cashNum = Number(cashInput) || 0;
  const qrNum = Number(qrInput) || 0;
  const entered = cashNum + qrNum;
  const remaining = Math.round((total - entered) * 100) / 100;
  const over = remaining < -0.01;
  const mixedValid = mixedSelected && Math.abs(remaining) < 0.01;

  // Остаток от введённой суммы (для автоподстановки во второе поле).
  const complement = (value: string) => {
    const v = value.trim();
    if (v === '') return '';
    const rest = Math.round((total - (Number(v) || 0)) * 100) / 100;
    return String(Math.max(0, rest));
  };
  // Ввод в одно поле автоматически подставляет остаток в другое (не 50/50).
  const onCashChange = (value: string) => {
    setCashInput(value);
    setQrInput(complement(value));
  };
  const onQrChange = (value: string) => {
    setQrInput(value);
    setCashInput(complement(value));
  };

  async function completePayment(
    payload:
      | { orderId: string; method: PaymentMethod }
      | { orderId: string; method: 'mixed'; cashAmount: number; qrAmount: number },
  ) {
    await pay.mutateAsync(payload);
    beep('payment');
    push({ message: t('Оплата принята'), type: 'success', at: new Date().toISOString() });
    const r = await fetchReceipt(order.id);
    setSplitOpen(false);
    setReceipt(r);
    setShowSuccess(true);
  }

  // После показа success-окна автоматически переходим к окну печати чека.
  useEffect(() => {
    if (!showSuccess) return;
    const t = setTimeout(() => setShowSuccess(false), 1300);
    return () => clearTimeout(t);
  }, [showSuccess]);

  async function onConfirm() {
    setError('');
    if (mixedSelected && !mixedValid) return;
    try {
      await completePayment(
        mixedSelected
          ? { orderId: order.id, method: 'mixed', cashAmount: cashNum, qrAmount: qrNum }
          : { orderId: order.id, method: selected },
      );
    } catch (err) {
      setError(apiError(err));
    }
  }

  // Завершение разделения счёта: все платежи оплачены → проводим оплату заказа
  // суммарными наличными/QR (как обычная/смешанная оплата) и идём к чеку.
  async function handleSplitComplete({ cash, qr }: { cash: number; qr: number }) {
    setError('');
    try {
      const payload =
        cash > 0 && qr > 0
          ? ({ orderId: order.id, method: 'mixed' as PaymentMethod, cashAmount: cash, qrAmount: qr })
          : qr > 0
            ? ({ orderId: order.id, method: 'qr' as PaymentMethod })
            : ({ orderId: order.id, method: 'cash' as PaymentMethod });
      await completePayment(payload);
    } catch (err) {
      setSplitOpen(false);
      setError(apiError(err));
    }
  }

  function close() {
    setReceipt(null);
    setShowSuccess(false);
    setError('');
    setMethod(null);
    setCashInput('');
    setQrInput('');
    setSplitOpen(false);
    onClose();
    if (receipt) onPaid();
  }

  // «Печать чека»: не печатаем сразу, а создаём запрос администратору и
  // открываем нижний лист ожидания. Сам чек распечатается после подтверждения.
  async function requestPrint() {
    if (!receipt) return;
    try {
      const request = await createPrintRequest.mutateAsync(order.id);
      beginPrint(request, receipt);
      close();
    } catch (err) {
      setError(apiError(err));
    }
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
          <h3 className="mt-4 text-lg font-semibold text-text-primary">{t('Оплата принята')}</h3>
          <p className="mt-1 text-sm text-text-muted">{t('Платёж успешно подтверждён')}</p>
          <p className="mt-3 text-2xl font-semibold text-text-primary">{money(order.finalAmount)}</p>
          <div className="mt-5 flex items-center gap-2 text-xs text-text-light">
            <Spinner className="h-3.5 w-3.5" />
            <span>{t('Переходим к чеку…')}</span>
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
        title={t('Оплата принята')}
        footer={
          <div className="flex gap-2">
            <button className="btn-secondary btn-lg flex-1" onClick={close}>
              {t('Готово')}
            </button>
            <button
              className="btn-primary btn-lg flex-1 font-semibold"
              disabled={createPrintRequest.isPending}
              onClick={requestPrint}
            >
              {createPrintRequest.isPending ? <Spinner /> : t('Печать чека')}
            </button>
          </div>
        }
      >
        <div className="rounded-xl border border-border p-4 text-sm">
          <p className="text-center text-base font-semibold">{receipt.cafeName}</p>
          <p className="mb-3 text-center text-xs text-text-muted">
            {displayOrderNumber(receipt.orderNumber)} · {t('Стол')} {receipt.tableNumber}
          </p>
          <div className="space-y-1">
            {receipt.items.map((it, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-text-secondary">
                  {orderItemDisplayName(it)} <span className="text-text-light">×{it.quantity}</span>
                </span>
                <span>{money(it.finalPrice)}</span>
              </div>
            ))}
          </div>
          {Number(receipt.serviceChargeAmount) > 0 && (
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm text-text-secondary">
              <span>{t('Обслуживание')}</span>
              <span>{money(receipt.serviceChargeAmount)}</span>
            </div>
          )}
          <div className="mt-3 flex justify-between border-t border-border pt-2 text-base font-semibold">
            <span>{t('Итого')}</span>
            <span>{money(receipt.finalAmount)}</span>
          </div>
          {receipt.payments && receipt.payments.length > 1 && (
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
              {receipt.payments.map((p, i) => (
                <div key={i} className="flex justify-between text-text-secondary">
                  <span>{t(METHOD_LABELS[p.method])}</span>
                  <span>{money(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  // Шаг 1 — выбор способа оплаты
  return (
    <>
    <Modal
      open={open}
      onClose={close}
      title={t('Оплата заказа')}
      footer={
        <div className="flex items-center gap-2.5">
          <button
            className="btn-secondary btn-lg min-w-[126px] max-w-[158px] shrink-0 basis-[34%] whitespace-nowrap border-primary bg-white px-3 text-sm font-medium text-primary"
            disabled={pay.isPending}
            onClick={() => setSplitOpen(true)}
          >
            {t('Разделить счёт')}
          </button>
          <button
            className="btn-primary btn-lg min-w-0 flex-1 font-semibold"
            disabled={pay.isPending || qrMissing || (mixedSelected && !mixedValid)}
            onClick={onConfirm}
          >
            {pay.isPending ? (
              <Spinner />
            ) : qrSelected || mixedSelected ? (
              `${t('Оплачено')} · ${money(order.finalAmount)}`
            ) : (
              `${t('Принять оплату')} · ${money(order.finalAmount)}`
            )}
          </button>
        </div>
      }
    >
      <p className="mb-1 text-sm text-text-muted">
        {t('Стол')} {order.table.number} · {displayOrderNumber(order.orderNumber)}
      </p>
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-text-secondary">{t('К оплате')}</span>
        <span className="text-2xl font-semibold">{money(order.finalAmount)}</span>
      </div>

      <p className="mb-2 text-sm font-medium text-text-secondary">{t('Способ оплаты')}</p>
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
            {t(m.label)}
          </button>
        ))}
      </div>

      {/* QR-код для оплаты */}
      {qrSelected && (
        <div className="mt-4">
          {qrImageUrl ? (
            <div className="flex flex-col items-center rounded-xl border border-border bg-white p-5">
              <p className="mb-3 text-sm text-text-secondary">{t('Покажите QR-код клиенту для оплаты')}</p>
              <img
                src={qrImageUrl}
                alt={t('QR-код для оплаты')}
                className="h-72 max-h-[56vh] w-72 max-w-full object-contain"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-center text-sm text-warning">
              {t('QR-код не загружен. Добавьте его в настройках или выберите другой способ оплаты.')}
            </div>
          )}
        </div>
      )}

      {/* Смешанная оплата: разбивка наличные + QR */}
      {mixedSelected && (
        <div className="mt-4">
          <div className="space-y-3 rounded-xl border border-border bg-background p-4">
            <label className="flex items-center justify-between gap-3">
              <span className="text-[15px] text-text-secondary">{t('Наличные')}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                className="input h-11 w-40 text-right"
                value={cashInput}
                onChange={(e) => onCashChange(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-[15px] text-text-secondary">{t('QR-код')}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                className="input h-11 w-40 text-right"
                value={qrInput}
                onChange={(e) => onQrChange(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>

          <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">{t('Итого внесено')}</span>
              <span className="font-medium text-text-primary">{money(entered)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">{t('Осталось')}</span>
              <span
                className={`font-medium ${
                  remaining === 0 ? 'text-success' : over ? 'text-danger' : 'text-text-primary'
                }`}
              >
                {money(Math.max(0, remaining))}
              </span>
            </div>
          </div>

          {over ? (
            <p className="mt-2 text-sm text-danger">{t('Сумма превышает итог заказа')}</p>
          ) : (
            <p className="mt-2 text-xs text-text-light">{t('Сумма должна совпадать с итогом заказа')}</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>

    {/* Разделение счёта — открывается поверх окна оплаты, состояние не сбрасывается */}
    <SplitBillSheet
      open={splitOpen}
      total={total}
      submitting={pay.isPending}
      onClose={() => setSplitOpen(false)}
      onComplete={handleSplitComplete}
    />
    </>
  );
}
