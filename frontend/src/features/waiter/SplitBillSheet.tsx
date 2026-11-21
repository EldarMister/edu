import { useEffect, useMemo, useRef, useState } from 'react';
import { SheetHandle } from '@/components/SheetHandle';
import { useDialogEscape } from '@/components/useDialogEscape';
import { apiError } from '@/lib/api';
import type { PaymentMethod } from '@/types';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';
import { Select } from '@/components/Select';
import { normalizeAmount, type TenderMethod } from './paymentAmounts';
import { PaymentQrPreview } from './PaymentQrPreview';

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
  tenders: Record<TenderMethod, string>;
  paid: boolean;
}
const EMPTY_TENDERS = { cash: '', card: '', qr: '' };

const METHODS: { value: Method; label: string }[] = [
  { value: 'qr', label: 'QR-код' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'mixed', label: 'Смешанная' },
];

const num = (s: string) => Number(s) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (value: number) => Math.round(value * 100);

function splitAmounts(total: number, count: number): string[] {
  const totalC = cents(total);
  const base = Math.floor(totalC / count);
  return Array.from({ length: count }, (_, i) =>
    String((base + Number(i < totalC % count)) / 100),
  );
}

export function SplitBillSheet({
  open,
  total,
  wideLayout = false,
  paymentMethods,
  qrImageUrl,
  submitting,
  onClose,
  onComplete,
}: {
  open: boolean;
  total: number;
  wideLayout?: boolean;
  paymentMethods: PaymentMethod[];
  qrImageUrl: string | null;
  submitting: boolean;
  onClose: () => void;
  onComplete: (totals: { payments: SplitPaymentPart[] }) => Promise<void>;
}) {
  const t = useT();
  const tenders = METHODS.flatMap(({ value, label }) => value !== 'mixed' && paymentMethods.includes(value) ? [{ value, label }] : []);
  const allowed = (method: Method) => method === 'mixed' ? tenders.length >= 2 : paymentMethods.includes(method);
  const available = METHODS.filter((method) => allowed(method.value));
  const defaultMethod = paymentMethods.includes('cash') ? 'cash' : available[0]?.value ?? 'qr';
  const inFlight = useRef(false);
  const lastTotal = useRef(total);
  const panel = useRef<HTMLDivElement>(null);
  const [completionError, setCompletionError] = useState('');
  const [count, setCount] = useState(2);
  const [completing, setCompleting] = useState(false);
  const [payments, setPayments] = useState<SplitPayment[]>(() =>
    Array.from({ length: 2 }, () => ({ method: defaultMethod, tenders: EMPTY_TENDERS, paid: false })),
  );
  const [amountInputs, setAmountInputs] = useState<string[]>(() => splitAmounts(total, 2));

  const amounts = useMemo(() => amountInputs.map((value) => round2(num(value))), [amountInputs]);
  const assignedValid = amounts.every((amount) => amount >= 0.01)
    && amounts.reduce((sum, amount) => sum + cents(amount), 0) === cents(total);
  const maxShares = Math.min(10, cents(total));

  const anyPaid = payments.some((p) => p.paid);
  const invalidPaidMethod = payments.some((p) => p.paid && (!allowed(p.method)
    || p.method === 'mixed' && (Object.keys(p.tenders) as TenderMethod[]).some((method) => !allowed(method) && num(p.tenders[method]) > 0)));
  const paidSum = payments.reduce((s, p, i) => (p.paid ? s + amounts[i] : s), 0);
  const remaining = round2(total - paidSum);

  useEffect(() => {
    if (anyPaid || lastTotal.current === total) return;
    lastTotal.current = total;
    setAmountInputs(splitAmounts(total, count));
  }, [anyPaid, count, total]);

  function changeCount(next: number) {
    if (anyPaid) return; // менять число платежей можно только пока ничего не оплачено
    const n = Math.max(2, Math.min(maxShares, next));
    setCount(n);
    setPayments(Array.from({ length: n }, () => ({ method: defaultMethod, tenders: EMPTY_TENDERS, paid: false })));
    setAmountInputs(splitAmounts(total, n));
  }

  function patch(i: number, upd: Partial<SplitPayment>) {
    setPayments((prev) => prev.map((p, idx) => (idx === i ? {
      ...p,
      ...(!allowed(p.method) && { tenders: EMPTY_TENDERS }),
      ...upd,
    } : p)));
  }

  function onAmountChange(i: number, value: string) {
    if (payments[i]?.paid) return;
    const clean = normalizeAmount(value);
    if (clean === null) return;
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

  function changeTender(index: number, method: TenderMethod, value: string) {
    const clean = normalizeAmount(value);
    if (clean === null) return;
    const other = tenders.length === 2 ? tenders.find(({ value }) => value !== method)?.value : undefined;
    patch(index, { tenders: {
      ...paymentAt(index).tenders,
      [method]: clean,
      ...(other && { [other]: clean === '' ? '' : String(Math.max(0, cents(amounts[index]) - cents(num(clean))) / 100) }),
    } });
  }

  function mixedParts(payment: SplitPayment) {
    return tenders.flatMap(({ value }) => {
      const amount = num(payment.tenders[value]);
      return amount > 0 ? [{ method: value, amount }] : [];
    });
  }

  function canPay(i: number): boolean {
    const p = paymentAt(i);
    if (p.paid || invalidPaidMethod || !allowed(p.method) || amounts[i] <= 0 || !assignedValid) return false;
    if (p.method !== 'mixed') return true;
    const parts = mixedParts(p);
    return parts.length >= 2 && parts.reduce((sum, { amount }) => sum + cents(amount), 0) === cents(amounts[i]);
  }

  function paymentAt(i: number) {
    const payment = payments[i];
    return payment.paid || allowed(payment.method) ? payment : { ...payment, method: defaultMethod, tenders: EMPTY_TENDERS };
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
          splitParts.push(...mixedParts(p));
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
  const close = () => { if (!busy) onClose(); };
  useDialogEscape(panel, open, close);
  useEffect(() => {
    if (wideLayout && open) panel.current?.focus({ preventScroll: true });
  }, [open, wideLayout]);
  if (wideLayout && !open) return null;

  return (
    <div className={`fixed inset-0 z-[60] ${wideLayout ? 'flex items-center justify-center p-4' : ''} ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* Затемнение */}
      <div
        className="absolute inset-0 bg-black/40"
        style={{ transition: `opacity ${SHEET_MS}ms ease`, opacity: open ? 1 : 0 }}
        onClick={close}
      />

      {/* Лист */}
      <div
        ref={panel}
        tabIndex={wideLayout ? -1 : undefined}
        className={wideLayout
          ? 'relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-soft outline-none'
          : 'terminal-dialog absolute inset-x-0 bottom-0 mx-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-soft sm:bottom-4 sm:rounded-2xl md:max-w-xl [--terminal-dialog-closed-offset:110%]'}
        data-visible={open}
        data-modal-panel={open || undefined}
        style={{
          transition: `transform ${SHEET_MS}ms ${SHEET_EASE}`,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        role="dialog"
        aria-modal={open}
        aria-label={t('Разделение счёта')}
      >
        {!wideLayout && <SheetHandle panel={panel} onClose={close} enabled={open && !busy} className="md:hidden" />}
        {/* Шапка */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold text-text-primary">{t('Разделение счёта')}</h3>
          <button onClick={close} disabled={busy} className="text-text-light hover:text-text-secondary" aria-label={t('Назад')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {completionError && <p role="alert" className="mb-2 text-sm text-danger">{completionError}</p>}
          {invalidPaidMethod && <p role="alert" className="mb-2 text-sm text-danger">{t('Способ оплаты отмеченного платежа отключён')}</p>}
          {!available.length && <p role="alert" className="mb-2 text-sm text-danger">{t('Нет доступных способов оплаты')}</p>}
          <p className="mb-3 text-sm text-text-muted">{t('Заказ закроется после оплаты всех частей.')}</p>
          {/* Сумма + счётчик платежей */}
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-text-muted">{t('Сумма к оплате')}</p>
              <p className="text-xl font-semibold text-text-primary">{money(total)}</p>
            </div>
            <div className="flex items-center gap-3">
              <CounterBtn label="−" onClick={() => changeCount(count - 1)} disabled={anyPaid || count <= 2} />
              <span className="w-5 text-center text-lg font-semibold text-text-primary">{count}</span>
              <CounterBtn label="+" onClick={() => changeCount(count + 1)} disabled={anyPaid || count >= maxShares} />
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
                        type="text"
                        inputMode="decimal"
                        className="h-9 w-28 rounded-lg border border-border bg-white px-2 text-right text-[15px] font-semibold text-text-primary outline-none transition-colors focus:border-primary"
                        value={amountInputs[i] ?? ''}
                        disabled={busy}
                        onChange={(e) => onAmountChange(i, e.target.value)}
                      />
                      <span className="text-[15px] font-semibold text-text-primary">с</span>
                    </label>
                  )}
                </div>

                {p.paid ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm font-medium text-success">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {t('Оплачен')} · {t(METHODS.find((m) => m.value === p.method)!.label)}
                    <button type="button" className="ml-auto py-1 text-sm text-primary" disabled={busy}
                      onClick={() => { patch(i, { paid: false }); setCompletionError(''); }}>{t('Снять отметку')}</button>
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

                    {p.method === 'mixed' && <div className="mt-2 grid grid-cols-2 gap-2">
                      {tenders.map(({ value, label }) => <label key={value} className="text-xs text-text-muted">
                        {t(label)}
                        <input type="text" inputMode="decimal" className="input mt-1 h-9 text-right text-sm"
                          value={p.tenders[value]} disabled={busy} onChange={(event) => changeTender(i, value, event.target.value)} placeholder="0" />
                      </label>)}
                    </div>}
                    {qrImageUrl && (p.method === 'qr' || p.method === 'mixed' && num(p.tenders.qr) > 0)
                      && <PaymentQrPreview url={qrImageUrl} />}
                  </>
                )}
              </div>
              );
            })}
          </div>
          {!assignedValid && <p role="alert" className="mt-2 text-sm text-danger">
            {t('Укажите положительные суммы всех платежей. Вместе они должны составлять сумму заказа.')}
          </p>}
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
