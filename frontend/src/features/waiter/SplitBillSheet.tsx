import { useEffect, useMemo, useRef, useState } from 'react';
import { apiError } from '@/lib/api';
import type { PaymentMethod } from '@/types';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';
import { Select } from '@/components/Select';

/**
 * Разделение счёта: делим сумму заказа на N платежей, каждый оплачивается
 * отдельно своим способом (QR / Наличные / Смешанная). Когда все платежи
 * оплачены — отдаём наверх суммарные наличные/QR, заказ помечается оплаченным.
 *
 * Лист всегда смонтирован (пока активна оплата) и анимируется через `open` —
 * так состояние не сбрасывается при возврате к окну оплаты.
 */
const SHEET_MS = 300;
const SHEET_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

type Method = PaymentMethod;
type SplitPaymentPart = { method: Exclude<Method, 'mixed'>; amount: number };
interface SplitPayment {
  method: Method;
  cash: string; // для «Смешанная»
  qr: string;
  paid: boolean;
}

const METHODS: { value: Method; label: string }[] = [
  { value: 'qr', label: 'QR-код' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'mixed', label: 'Смешанная' },
];

const num = (s: string) => Number(s) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

function splitAmounts(total: number, count: number): string[] {
  const totalC = Math.round(total * 100);
  const base = Math.floor(totalC / count);
  return Array.from({ length: count }, (_, i) =>
    String((i === count - 1 ? totalC - base * (count - 1) : base) / 100),
  );
}

export function SplitBillSheet({
  open,
  total,
  paymentMethods,
  submitting,
  onClose,
  onComplete,
}: {
  open: boolean;
  total: number;
  paymentMethods: PaymentMethod[];
  submitting: boolean;
  onClose: () => void;
  onComplete: (totals: { payments: SplitPaymentPart[] }) => Promise<void>;
}) {
  const t = useT();
  const allowed = (method: Method) => method === 'mixed'
    ? paymentMethods.includes('cash') && paymentMethods.includes('qr')
    : paymentMethods.includes(method);
  const available = METHODS.filter((method) => allowed(method.value));
  const defaultMethod = available[0]?.value ?? 'qr';
  const inFlight = useRef(false);
  const [completionError, setCompletionError] = useState('');
  const [count, setCount] = useState(2);
  const [completing, setCompleting] = useState(false);
  const [payments, setPayments] = useState<SplitPayment[]>(() =>
    Array.from({ length: 2 }, () => ({ method: defaultMethod, cash: '', qr: '', paid: false })),
  );
  const [amountInputs, setAmountInputs] = useState<string[]>(() => splitAmounts(total, 2));

  const amounts = useMemo(() => amountInputs.map((value) => round2(num(value))), [amountInputs]);
  const assignedSum = round2(amounts.reduce((sum, amount) => sum + amount, 0));
  const assignedValid = Math.abs(assignedSum - total) < 0.01;

  const anyPaid = payments.some((p) => p.paid);
  const invalidPaidMethod = payments.some((p) => p.paid && !allowed(p.method));
  const paidSum = payments.reduce((s, p, i) => (p.paid ? s + amounts[i] : s), 0);
  const remaining = round2(total - paidSum);

  useEffect(() => {
    if (anyPaid) return;
    setAmountInputs(splitAmounts(total, count));
  }, [anyPaid, count, total]);

  function changeCount(next: number) {
    if (anyPaid) return; // менять число платежей можно только пока ничего не оплачено
    const n = Math.max(2, Math.min(10, next));
    setCount(n);
    setPayments(Array.from({ length: n }, () => ({ method: defaultMethod, cash: '', qr: '', paid: false })));
    setAmountInputs(splitAmounts(total, n));
  }

  function patch(i: number, upd: Partial<SplitPayment>) {
    setPayments((prev) => prev.map((p, idx) => (idx === i ? {
      ...p,
      ...(!allowed(p.method) && { cash: '', qr: '' }),
      ...upd,
    } : p)));
  }

  function onAmountChange(i: number, value: string) {
    if (payments[i]?.paid) return;
    const clean = value.replace(',', '.');
    setAmountInputs((prev) => {
      const next = [...prev];
      next[i] = clean;
      const adjustIndex =
        [...payments.keys()].find((idx) => idx !== i && !payments[idx].paid && idx > i) ??
        [...payments.keys()].reverse().find((idx) => idx !== i && !payments[idx].paid);
      if (adjustIndex !== undefined) {
        const others = next.reduce((sum, amount, idx) => (idx === adjustIndex ? sum : sum + num(amount)), 0);
        next[adjustIndex] = String(Math.max(0, round2(total - others)));
      }
      return next;
    });
  }

  // Ввод одной части «Смешанной» автоподставляет остаток до суммы платежа.
  function onMixedCash(i: number, value: string) {
    const rest = round2(amounts[i] - num(value));
    patch(i, { cash: value, qr: value.trim() === '' ? '' : String(Math.max(0, rest)) });
  }
  function onMixedQr(i: number, value: string) {
    const rest = round2(amounts[i] - num(value));
    patch(i, { qr: value, cash: value.trim() === '' ? '' : String(Math.max(0, rest)) });
  }

  function canPay(i: number): boolean {
    const p = paymentAt(i);
    if (p.paid || invalidPaidMethod || !allowed(p.method) || amounts[i] <= 0 || !assignedValid) return false;
    if (p.method !== 'mixed') return true;
    return Math.abs(num(p.cash) + num(p.qr) - amounts[i]) < 0.01 && num(p.cash) > 0 && num(p.qr) > 0;
  }

  function paymentAt(i: number) {
    const payment = payments[i];
    return payment.paid || allowed(payment.method) ? payment : { ...payment, method: defaultMethod, cash: '', qr: '' };
  }

  async function payOne(i: number) {
    if (!canPay(i) || inFlight.current || submitting) return;
    setCompletionError('');
    const next = payments.map((p, idx) => (idx === i ? { ...paymentAt(i), paid: true } : p));
    setPayments(next);
    if (next.every((p) => p.paid)) {
      const splitParts: SplitPaymentPart[] = [];
      next.forEach((p, idx) => {
        const amount = amounts[idx];
        if (p.method !== 'mixed') {
          splitParts.push({ method: p.method, amount });
        } else {
          const cashPart = round2(num(p.cash));
          const qrPart = round2(num(p.qr));
          if (cashPart > 0) splitParts.push({ method: 'cash', amount: cashPart });
          if (qrPart > 0) splitParts.push({ method: 'qr', amount: qrPart });
        }
      });
      inFlight.current = true;
      setCompleting(true);
      try {
        await onComplete({ payments: splitParts });
      } catch (error) {
        setPayments(next.map((part, index) => index === i ? { ...part, paid: false } : part));
        setCompletionError(apiError(error));
      } finally {
        inFlight.current = false;
        setCompleting(false);
      }
    }
  }

  const busy = submitting || completing;

  return (
    <div className={`fixed inset-0 z-[60] ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* Затемнение */}
      <div
        className="absolute inset-0 bg-black/40"
        style={{ transition: `opacity ${SHEET_MS}ms ease`, opacity: open ? 1 : 0 }}
        onClick={onClose}
      />

      {/* Лист */}
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-soft sm:bottom-4 sm:rounded-2xl"
        style={{
          transform: open ? 'translateY(0)' : 'translateY(110%)',
          transition: `transform ${SHEET_MS}ms ${SHEET_EASE}`,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        role="dialog"
        aria-label={t('Разделение счёта')}
      >
        {/* Шапка */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold text-text-primary">{t('Разделение счёта')}</h3>
          <button onClick={onClose} className="text-text-light hover:text-text-secondary" aria-label={t('Назад')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {completionError && <p role="alert" className="mb-2 text-sm text-danger">{completionError}</p>}
          {invalidPaidMethod && <p role="alert" className="mb-2 text-sm text-danger">{t('Способ оплаты отмеченного платежа отключён')}</p>}
          {!available.length && <p role="alert" className="mb-2 text-sm text-danger">{t('Нет доступных способов оплаты')}</p>}
          {/* Сумма + счётчик платежей */}
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-text-muted">{t('Сумма к оплате')}</p>
              <p className="text-xl font-semibold text-text-primary">{money(total)}</p>
            </div>
            <div className="flex items-center gap-3">
              <CounterBtn label="−" onClick={() => changeCount(count - 1)} disabled={anyPaid || count <= 2} />
              <span className="w-5 text-center text-lg font-semibold text-text-primary">{count}</span>
              <CounterBtn label="+" onClick={() => changeCount(count + 1)} disabled={anyPaid || count >= 10} />
            </div>
          </div>

          {/* Платежи */}
          <div className="space-y-2.5">
            {payments.map((_, i) => {
              const p = paymentAt(i);
              return (
              <div
                key={i}
                className={`rounded-xl border p-3 transition-colors ${
                  p.paid ? 'border-success/40 bg-success/5' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium text-text-primary">
                    {t('Платёж')} {i + 1}
                  </span>
                  {p.paid ? (
                    <span className="text-[15px] font-semibold text-text-primary">{money(amounts[i])}</span>
                  ) : (
                    <label className="flex items-center gap-1">
                      <span className="sr-only">{t('Сумма платежа')}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        className="h-9 w-28 rounded-lg border border-border bg-white px-2 text-right text-[15px] font-semibold text-text-primary outline-none transition-colors focus:border-primary"
                        value={amountInputs[i] ?? ''}
                        onChange={(e) => onAmountChange(i, e.target.value)}
                      />
                      <span className="text-[15px] font-semibold text-text-primary">с</span>
                    </label>
                  )}
                </div>

                {p.paid ? (
                  <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-success">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {t('Оплачен')} · {t(METHODS.find((m) => m.value === p.method)!.label)}
                  </div>
                ) : (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <Select
                        value={p.method}
                        onChange={(value) => patch(i, { method: value as Method })}
                        options={available.map((m) => ({ value: m.value, label: t(m.label) }))}
                        disabled={busy || !available.length}
                        className="h-12 min-w-[118px] shrink-0 basis-[36%] rounded-lg px-3 text-sm font-medium"
                      />
                      <button
                        onClick={() => payOne(i)}
                        disabled={!canPay(i) || busy}
                        className="btn-primary btn-md h-12 min-w-0 flex-1 font-semibold disabled:opacity-50"
                      >
                        {busy && i === payments.findIndex((p) => !p.paid) ? <Spinner /> : `${t('Оплатить')} · ${money(amounts[i])}`}
                      </button>
                    </div>

                    {p.method === 'mixed' && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-xs text-text-muted">
                          {t('Наличные')}
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            className="input mt-1 h-9 text-right text-sm"
                            value={p.cash}
                            onChange={(e) => onMixedCash(i, e.target.value)}
                            placeholder="0"
                          />
                        </label>
                        <label className="text-xs text-text-muted">
                          {t('QR-код')}
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            className="input mt-1 h-9 text-right text-sm"
                            value={p.qr}
                            onChange={(e) => onMixedQr(i, e.target.value)}
                            placeholder="0"
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}
              </div>
              );
            })}
          </div>
        </div>

        {/* Низ: остаток к оплате */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <span className="text-sm text-text-muted">{t('Осталось к оплате')}</span>
          <span className={`text-lg font-semibold ${remaining <= 0 ? 'text-success' : 'text-text-primary'}`}>
            {busy ? <Spinner className="h-5 w-5" /> : money(Math.max(0, remaining))}
          </span>
        </div>
      </div>
    </div>
  );
}

function CounterBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-lg font-semibold text-text-secondary transition-colors hover:border-primary/40 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
