import { useMemo, useState } from 'react';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/components/Spinner';

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

type Method = 'qr' | 'cash' | 'mixed';
interface SplitPayment {
  method: Method;
  cash: string; // для «Смешанная»
  qr: string;
  paid: boolean;
}

const METHODS: { value: Method; label: string }[] = [
  { value: 'qr', label: 'QR-код' },
  { value: 'cash', label: 'Наличные' },
  { value: 'mixed', label: 'Смешанная' },
];

const num = (s: string) => Number(s) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function SplitBillSheet({
  open,
  total,
  submitting,
  onClose,
  onComplete,
}: {
  open: boolean;
  total: number;
  submitting: boolean;
  onClose: () => void;
  onComplete: (totals: { cash: number; qr: number }) => void;
}) {
  const t = useT();
  const [count, setCount] = useState(2);
  const [payments, setPayments] = useState<SplitPayment[]>(() =>
    Array.from({ length: 2 }, () => ({ method: 'qr', cash: '', qr: '', paid: false })),
  );

  // Суммы платежей (в копейках, остаток — последнему).
  const amounts = useMemo(() => {
    const totalC = Math.round(total * 100);
    const base = Math.floor(totalC / count);
    return Array.from({ length: count }, (_, i) =>
      (i === count - 1 ? totalC - base * (count - 1) : base) / 100,
    );
  }, [total, count]);

  const anyPaid = payments.some((p) => p.paid);
  const paidSum = payments.reduce((s, p, i) => (p.paid ? s + amounts[i] : s), 0);
  const remaining = round2(total - paidSum);

  function changeCount(next: number) {
    if (anyPaid) return; // менять число платежей можно только пока ничего не оплачено
    const n = Math.max(2, Math.min(10, next));
    setCount(n);
    setPayments(Array.from({ length: n }, () => ({ method: 'qr', cash: '', qr: '', paid: false })));
  }

  function patch(i: number, upd: Partial<SplitPayment>) {
    setPayments((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...upd } : p)));
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
    const p = payments[i];
    if (p.method !== 'mixed') return true;
    return Math.abs(num(p.cash) + num(p.qr) - amounts[i]) < 0.01 && num(p.cash) > 0 && num(p.qr) > 0;
  }

  function payOne(i: number) {
    if (!canPay(i)) return;
    const next = payments.map((p, idx) => (idx === i ? { ...p, paid: true } : p));
    setPayments(next);
    if (next.every((p) => p.paid)) {
      let cash = 0;
      let qr = 0;
      next.forEach((p, idx) => {
        if (p.method === 'qr') qr += amounts[idx];
        else if (p.method === 'cash') cash += amounts[idx];
        else {
          cash += num(p.cash);
          qr += num(p.qr);
        }
      });
      onComplete({ cash: round2(cash), qr: round2(qr) });
    }
  }

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
            {payments.map((p, i) => (
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
                  <span className="text-[15px] font-semibold text-text-primary">{money(amounts[i])}</span>
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
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {METHODS.map((m) => (
                        <button
                          key={m.value}
                          onClick={() => patch(i, { method: m.value })}
                          className={`rounded-lg border px-2 py-1.5 text-[13px] font-medium transition-colors ${
                            p.method === m.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-border text-text-secondary hover:border-primary/40'
                          }`}
                        >
                          {t(m.label)}
                        </button>
                      ))}
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

                    <button
                      onClick={() => payOne(i)}
                      disabled={!canPay(i) || submitting}
                      className="btn-primary btn-md mt-2.5 w-full font-semibold disabled:opacity-50"
                    >
                      {t('Оплатить')} · {money(amounts[i])}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Низ: остаток к оплате */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <span className="text-sm text-text-muted">{t('Осталось к оплате')}</span>
          <span className={`text-lg font-semibold ${remaining <= 0 ? 'text-success' : 'text-text-primary'}`}>
            {submitting ? <Spinner className="h-5 w-5" /> : money(Math.max(0, remaining))}
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
