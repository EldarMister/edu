import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Order, PaymentMethod, Receipt } from '@/types';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { displayOrderNumber, isSplitPayment, money, orderItemDisplayName, orderPlaceLabel, paymentMethodLabel, taxRateLabel } from '@/lib/format';
import { receiptHeader, receiptPrintSettings } from '@/lib/receipt';
import { apiError } from '@/lib/api';
import { translate, useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { usePublicSettings, resolveQrSrc } from '@/features/settings/api';
import { CashShiftForm, useCashShiftState } from '@/features/settings/CashShiftControls';
import { usePermissions } from '@/hooks/usePermissions';
import { beep } from '@/lib/sound';
import { usePay, fetchReceipt, useCreateReceiptPrintRequest } from './api';
import { useReceiptPrint } from './receiptPrint';
import { SplitBillSheet } from './SplitBillSheet';
import { useOrderReceiptPrinter } from './useOrderReceiptPrinter';
import { FullScreenPayment } from './FullScreenPayment';
import { normalizeAmount, tenderTotals, type TenderAmounts, type TenderMethod } from './paymentAmounts';
import { PaymentQrPreview } from './PaymentQrPreview';

const ALL_METHODS: { value: TenderMethod; label: string }[] = [
  { value: 'qr', label: 'QR-код' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
];
const EMPTY_AMOUNTS = { cash: '', card: '', qr: '' };

const METHOD_LABELS: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
  mixed: 'Смешанная',
};

export function PaymentModal({
  order,
  wideLayout,
  open,
  onClose,
  onPaid,
}: {
  order: Order;
  wideLayout: boolean;
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
  const { canAction } = usePermissions();
  const canPrint = canAction('printReceipts');
  const canRequestPrint = canAction('requestReceiptPrints');
  const printOrderReceipt = useOrderReceiptPrinter();
  const mayOpenCashShift = canAction('financeCashShifts');
  const cashShift = useCashShiftState(open && Number(order.finalAmount) > 0 && mayOpenCashShift);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [paymentAccepted, setPaymentAccepted] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const paying = useRef(false);
  const [printing, setPrinting] = useState(false);
  // Промежуточное окно успешной оплаты: показывается ~1.3с, затем открывается чек.
  const [showSuccess, setShowSuccess] = useState(false);
  // Анимация успеха отыграла минимальную длительность (чек уже мог не догрузиться).
  const [successDone, setSuccessDone] = useState(false);
  // Суммы для смешанной оплаты (как строки из инпутов).
  const [draft, setDraft] = useState(EMPTY_AMOUNTS);
  // Окно «Разделение счёта».
  const [splitOpen, setSplitOpen] = useState(false);

  const qrImageUrl = resolveQrSrc(settings.data?.qrImageUrl);
  const enabled = settings.data?.paymentMethods ?? (['qr', 'cash'] as PaymentMethod[]);
  const available = ALL_METHODS.filter(({ value }) => enabled.includes(value) && (value !== 'qr' || !!qrImageUrl));
  const mixedAvailable = available.length >= 2;
  const methods: { value: PaymentMethod; label: string }[] = [
    ...ALL_METHODS.filter((m) => enabled.includes(m.value)),
    ...(mixedAvailable ? [{ value: 'mixed' as PaymentMethod, label: 'Смешанная' }] : []),
  ];
  const selected: PaymentMethod =
    method && methods.some((m) => m.value === method) ? method : available[0]?.value ?? methods[0]?.value ?? 'qr';

  const qrSelected = selected === 'qr';
  const qrMissing = qrSelected && !qrImageUrl;

  // Расчёты для смешанной оплаты.
  const total = Number(order.finalAmount);
  const activeItems = order.items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');
  const allActiveItemsServed = activeItems.length > 0 && activeItems.every((item) => item.status === 'served');
  const mixedSelected = selected === 'mixed';
  const entered: TenderAmounts = { cash: 0, card: 0, qr: 0 };
  for (const { value } of available) entered[value] = Number(draft[value]) || 0;
  const { amounts, remaining, change, over } = tenderTotals(total, entered);
  const mixedValid = mixedSelected && remaining === 0 && !over && Object.values(amounts).filter((amount) => amount > 0).length >= 2;
  const canSplit = allActiveItemsServed && available.length > 0 && Math.round(total * 100) >= 2;

  function changeAmount(field: TenderMethod, value: string) {
    const next = normalizeAmount(value);
    if (next === null) return;
    const other = available.length === 2 ? available.find(({ value }) => value !== field)?.value : undefined;
    setDraft((current) => ({
      ...current,
      [field]: next,
      ...(other && { [other]: next === '' ? '' : String(Math.max(0, Math.round(total * 100) - Math.round(Number(next) * 100)) / 100) }),
    }));
  }

  async function loadReceipt() {
    setReceiptLoading(true);
    setError('');
    try {
      setReceipt(await fetchReceipt(order.id));
    } catch (err) {
      setShowSuccess(false);
      setError(apiError(err));
    } finally {
      setReceiptLoading(false);
    }
  }

  async function completePayment(
    payload:
      | { orderId: string; method: PaymentMethod }
      | { orderId: string; method: 'mixed'; cashAmount: number; qrAmount: number; cardAmount?: number }
      | { orderId: string; method: PaymentMethod; splitPayments: { method: Exclude<PaymentMethod, 'mixed'>; amount: number }[] },
  ) {
    if (paying.current || paymentAccepted) return;
    paying.current = true;
    try {
      await pay.mutateAsync(payload);
      setPaymentAccepted(true);
      beep('payment');
      push({ message: t('Оплата принята'), type: 'success', at: new Date().toISOString() });
      setSplitOpen(false);
      setSuccessDone(false);
      setShowSuccess(true);
      await loadReceipt();
    } finally {
      paying.current = false;
    }
  }

  // Минимальная длительность анимации успеха (~1.3с).
  useEffect(() => {
    if (!showSuccess) return;
    const id = setTimeout(() => setSuccessDone(true), 1300);
    return () => clearTimeout(id);
  }, [showSuccess]);

  // Переходим к чеку, когда и анимация отыграла, и чек загружен.
  useEffect(() => {
    if (showSuccess && successDone && receipt) setShowSuccess(false);
  }, [showSuccess, successDone, receipt]);

  async function onConfirm() {
    setError('');
    if (!allActiveItemsServed || !methods.length || qrMissing || (mixedSelected && !mixedValid)) return;
    try {
      await completePayment(
        mixedSelected
          ? { orderId: order.id, method: 'mixed', cashAmount: amounts.cash, qrAmount: amounts.qr, cardAmount: amounts.card }
          : { orderId: order.id, method: selected },
      );
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function confirmTender(amounts: TenderAmounts, active: TenderMethod) {
    const used = (Object.keys(amounts) as TenderMethod[]).filter((method) => amounts[method] > 0);
    setError('');
    try {
      await completePayment(used.length > 1
        ? { orderId: order.id, method: 'mixed', cashAmount: amounts.cash, qrAmount: amounts.qr, cardAmount: amounts.card }
        : { orderId: order.id, method: used[0] ?? active });
    } catch (err) {
      setError(apiError(err));
    }
  }

  // Завершение разделения счёта: все платежи оплачены → проводим оплату заказа
  // суммарными наличными/QR (как обычная/смешанная оплата) и идём к чеку.
  async function handleSplitComplete({
    payments,
  }: {
    payments: { method: Exclude<PaymentMethod, 'mixed'>; amount: number }[];
  }) {
    setError('');
    const methods = new Set(payments.map((part) => part.method));
    const method = methods.size === 1 ? payments[0].method : 'mixed';
    await completePayment({ orderId: order.id, method, splitPayments: payments });
  }

  function close() {
    setReceipt(null);
    setPaymentAccepted(false);
    setShowSuccess(false);
    setSuccessDone(false);
    setError('');
    setMethod(null);
    setDraft(EMPTY_AMOUNTS);
    setSplitOpen(false);
    if (paymentAccepted) onPaid();
    else onClose();
  }

  // «Печать чека»: не печатаем сразу, а создаём запрос администратору и
  // открываем нижний лист ожидания. Сам чек распечатается после подтверждения.
  async function requestPrint() {
    if (!receipt) return;
    if (canPrint) {
      const printWindow = window.open('', '_blank', 'width=380,height=640');
      if (!printWindow) {
        setError(t('Разрешите всплывающие окна и повторите печать.'));
        return;
      }
      setPrinting(true);
      setError('');
      try {
        await printOrderReceipt(order.id, printWindow);
        close();
      } catch (err) {
        printWindow.close();
        setError(apiError(err));
      } finally {
        setPrinting(false);
      }
      return;
    }
    if (!canRequestPrint) return;
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
    const { receiptLanguage } = receiptPrintSettings(receipt);
    const receiptLabel = (label: string) => translate(receiptLanguage, label);
    const header = receiptHeader(receipt);
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
            {(canPrint || canRequestPrint) && <button
              className="btn-primary btn-lg flex-1 font-semibold"
              disabled={createPrintRequest.isPending || printing}
              onClick={requestPrint}
            >
              {createPrintRequest.isPending || printing ? <Spinner /> : t('Печать чека')}
            </button>}
          </div>
        }
      >
        <div lang={receiptLanguage} className="rounded-xl border border-border p-4 text-sm">
          {header.cafeName && <p className="text-center text-base font-semibold">{header.cafeName}</p>}
          {header.address && <p className="text-center text-xs text-text-muted">{header.address}</p>}
          {header.phones && <p className="text-center text-xs text-text-muted">{header.phones}</p>}
          <p className="mb-3 text-center text-xs text-text-muted">
            {displayOrderNumber(receipt.orderNumber)} · {receipt.source === 'delivery' ? receiptLabel('Доставка') : `${receiptLabel('Стол')} ${receipt.tableNumber}`}
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
              <span>{receiptLabel('Обслуживание')}</span>
              <span>{money(receipt.serviceChargeAmount)}</span>
            </div>
          )}
          {Number(receipt.roundingAmount) > 0 && (
            <div className="mt-2 flex justify-between text-sm text-text-secondary">
              <span>{receiptLabel('Округление')}</span>
              <span>−{money(receipt.roundingAmount ?? 0)}</span>
            </div>
          )}
          <div className="mt-3 flex justify-between border-t border-border pt-2 text-base font-semibold">
            <span>{receiptLabel('Итого')}</span>
            <span>{money(receipt.finalAmount)}</span>
          </div>
          {receipt.taxes?.map((tax) => <div key={tax.id} className="mt-1.5 flex justify-between gap-2 text-xs text-text-muted">
            <span>{receiptLabel('В т. ч.')} {tax.name} ({taxRateLabel(tax.rate)})</span><span>{money(tax.amount)}</span>
          </div>)}
          {isSplitPayment(receipt) && receipt.payments?.length ? (
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
              <div className="flex justify-between font-medium text-text-primary">
                <span>{receiptLabel('Раздельная оплата')}</span>
                <span>{money(receipt.finalAmount)}</span>
              </div>
              {receipt.payments.map((p, i) => (
                <div key={i} className="flex justify-between text-text-secondary">
                  <span>
                    {receiptLabel('Платёж')} {i + 1} — {receiptLabel(paymentMethodLabel(p.method))}
                  </span>
                  <span>{money(p.amount)}</span>
                </div>
              ))}
            </div>
          ) : receipt.payments && receipt.payments.length > 1 ? (
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
              {receipt.payments.map((p, i) => (
                <div key={i} className="flex justify-between text-text-secondary">
                  <span>{receiptLabel(METHOD_LABELS[p.method])}</span>
                  <span>{money(p.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

  if (paymentAccepted) return <Modal open={open} title={t('Оплата принята')} onClose={close}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={close}>{t('Готово')}</button>
      <button type="button" className="btn-primary btn-md" disabled={receiptLoading} onClick={() => void loadReceipt()}>
        {receiptLoading ? <Spinner /> : t('Загрузить чек повторно')}
      </button>
    </div>}>
    <p className="text-sm text-text-secondary">{t('Не удалось загрузить чек. Оплата уже сохранена.')}</p>
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </Modal>;

  if (open && total > 0 && mayOpenCashShift && cashShift.data?.enabled && !cashShift.data.current && !pay.isPending) {
    return <CashShiftForm current={null} onClose={onClose} onComplete={() => setError('')} />;
  }

  const splitBill = <SplitBillSheet
    key={order.id}
    open={splitOpen}
    total={total}
    wideLayout={wideLayout}
    paymentMethods={available.map(({ value }) => value)}
    qrImageUrl={qrImageUrl}
    submitting={pay.isPending}
    onClose={() => setSplitOpen(false)}
    onComplete={handleSplitComplete}
  />;

  if (wideLayout) return createPortal(
    <>
      <FullScreenPayment order={order} enabled={enabled} qrImageUrl={qrImageUrl} allItemsServed={allActiveItemsServed}
        open={open} busy={pay.isPending} error={error} splitOpen={splitOpen} onClose={close}
        onSplit={() => setSplitOpen(true)} onConfirm={confirmTender} />
      {splitBill}
    </>,
    document.body,
  );

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
            disabled={pay.isPending || !canSplit}
            onClick={() => setSplitOpen(true)}
          >
            {t('Разделить счёт')}
          </button>
          <button
            className="btn-primary btn-lg min-w-0 flex-1 font-semibold"
            disabled={pay.isPending || !methods.length || qrMissing || (mixedSelected && !mixedValid) || !allActiveItemsServed}
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
        <div className="min-w-0">
          <p className="mb-1 text-sm text-text-muted">
            {orderPlaceLabel(order, t)} · {displayOrderNumber(order.orderNumber)}
          </p>
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-text-secondary">{t('К оплате')}</span>
            <span className="text-2xl font-semibold">{money(order.finalAmount)}</span>
          </div>

          {!allActiveItemsServed && (
            <div className="mb-4 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">
              {t('Нельзя принять оплату: есть неподанные блюда.')}
            </div>
          )}

          <p className="mb-2 text-sm font-medium text-text-secondary">{t('Способ оплаты')}</p>
          <div className={`grid gap-2 ${methods.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {methods.map((m) => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                className={`rounded-xl border px-2 py-3 text-[15px] font-medium transition-colors lg:px-4 ${
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

          {mixedSelected && (
            <div className="mt-4">
              <div className="space-y-3 rounded-xl border border-border bg-background p-4">
                {available.map(({ value, label }) => <label key={value} className="flex items-center justify-between gap-3">
                  <span className="text-[15px] text-text-secondary">{t(label)}</span>
                  <input
                    inputMode="decimal"
                    className="input h-11 w-40 text-right"
                    value={draft[value]}
                    onChange={(event) => changeAmount(value, event.target.value)}
                    placeholder="0"
                  />
                </label>)}
              </div>
              <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
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
                {!over && change > 0 && <div className="flex justify-between">
                  <span className="text-text-muted">{t('Сдача')}</span><span>{money(change)}</span>
                </div>}
              </div>
              {entered.qr > 0 && qrImageUrl && <PaymentQrPreview url={qrImageUrl} />}

              {over ? (
                <p className="mt-2 text-sm text-danger">{t('Сумма превышает итог заказа')}</p>
              ) : (
                <p className="mt-2 text-xs text-text-light">{t('Сумма должна совпадать с итогом заказа')}</p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </div>
    </Modal>
    {splitBill}
    </>
  );
}
