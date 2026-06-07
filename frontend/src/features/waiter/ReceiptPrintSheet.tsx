import { useEffect, useState } from 'react';
import { displayOrderNumber, money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useReceiptPrint } from './receiptPrint';

const SHEET_MS = 380;
const SHEET_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Нижний лист «Печать чека» у официанта. Не на весь экран — открывается снизу
 * поверх текущего экрана. Состояния: ожидание / распечатан / отклонён.
 */
export function ReceiptPrintSheet() {
  const t = useT();
  const { request, receipt, status, sheetOpen, closeSheet, dismiss } = useReceiptPrint();
  const open = !!request && sheetOpen;

  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setRender(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setVisible(false);
    const id = setTimeout(() => setRender(false), SHEET_MS);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && primaryClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status]);

  if (!render || !request) return null;

  // Закрытие крестиком/оверлеем: в ожидании — «продолжить работу» (запрос
  // остаётся), в финальных состояниях — полный сброс.
  function primaryClose() {
    if (status === 'pending') closeSheet();
    else dismiss();
  }

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-black/40"
        style={{ transition: `opacity ${SHEET_MS}ms ease`, opacity: visible ? 1 : 0 }}
        onClick={primaryClose}
        aria-hidden
      />

      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-soft"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${SHEET_MS}ms ${SHEET_EASE}`,
        }}
        role="dialog"
        aria-label={t('Печать чека')}
      >
        {/* Шапка */}
        <div className="relative shrink-0 px-4 pb-1 pt-2.5">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">{t('Печать чека')}</h2>
            <button
              onClick={primaryClose}
              aria-label={t('Закрыть')}
              className="-mr-1 rounded-lg p-1 text-text-light hover:text-text-secondary"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {status === 'pending' && <WaitingState />}
          {status === 'printed' && <PrintedState />}
          {status === 'rejected' && <RejectedState />}
        </div>

        {/* Кнопка действия */}
        <div className="shrink-0 px-4 pb-4 pt-1">
          {status === 'pending' && (
            <button className="btn-secondary btn-lg w-full font-semibold" onClick={closeSheet}>
              {t('Продолжить работу')}
            </button>
          )}
          {status === 'printed' && (
            <button className="btn-primary btn-lg w-full font-semibold" onClick={dismiss}>
              {t('Готово')}
            </button>
          )}
          {status === 'rejected' && (
            <button className="btn-secondary btn-lg w-full font-semibold" onClick={dismiss}>
              {t('Продолжить работу')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  function WaitingState() {
    return (
      <div className="flex flex-col items-center text-center">
        <PrinterAnimation />
        <p className="mt-2 max-w-[280px] text-sm text-text-secondary">
          {t('Ожидаем подтверждение печати чека администратором')}
        </p>
        {receipt && <OrderCard />}
      </div>
    );
  }

  function PrintedState() {
    return (
      <div className="flex flex-col items-center py-4 text-center">
        <div className="animate-check-pop flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h3 className="mt-4 text-xl font-semibold text-text-primary">{t('Ваш чек распечатан')}</h3>
        <p className="mt-1 text-sm text-text-muted">{t('Заберите чек')}</p>
      </div>
    );
  }

  function RejectedState() {
    return (
      <div className="flex flex-col items-center py-4 text-center">
        <div className="animate-check-pop flex h-20 w-20 items-center justify-center rounded-full bg-danger/10">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </div>
        <h3 className="mt-4 text-xl font-semibold text-text-primary">{t('Печать чека отклонена')}</h3>
        <p className="mt-1 text-sm text-text-muted">{t('Администратором')}</p>
      </div>
    );
  }

  function OrderCard() {
    if (!receipt) return null;
    return (
      <div className="mt-4 w-full rounded-xl border border-border p-3 text-left text-sm">
        <div className="flex items-center justify-between font-medium text-text-primary">
          <span>{displayOrderNumber(receipt.orderNumber)}</span>
          <span className="text-text-muted">
            {t('Стол')} {receipt.tableNumber}
          </span>
        </div>
        <div className="mt-2 space-y-1">
          {receipt.items.map((it, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="min-w-0 truncate text-text-secondary">
                {it.dishNameSnapshot} <span className="text-text-light">×{it.quantity}</span>
              </span>
              <span className="shrink-0">{money(it.finalPrice)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-[15px] font-semibold text-text-primary">
          <span>{t('Итого')}</span>
          <span>{money(receipt.finalAmount)}</span>
        </div>
      </div>
    );
  }
}

/** Минималистичная анимация печати: чек непрерывно выезжает из принтера. */
function PrinterAnimation() {
  return (
    <div className="relative mx-auto mt-1 h-[104px] w-28 select-none" aria-hidden>
      {/* Лист в лотке подачи (сверху) */}
      <div className="absolute left-1/2 top-0 h-3 w-12 -translate-x-1/2 rounded-t-md border border-b-0 border-slate-200 bg-slate-50" />

      {/* Выезжающий из щели чек (его верх скрыт корпусом принтера) */}
      <div className="absolute left-1/2 top-[42px] w-[60px] -translate-x-1/2">
        <div className="animate-receipt-feed rounded-b-md border border-t-0 border-slate-200 bg-white px-2 pb-2 pt-1 shadow-sm">
          <div className="space-y-[5px]">
            <div className="h-[3px] w-full rounded bg-slate-200" />
            <div className="h-[3px] w-2/3 rounded bg-slate-200" />
            <div className="h-[3px] w-5/6 rounded bg-slate-200" />
          </div>
        </div>
      </div>

      {/* Корпус принтера */}
      <div className="absolute left-1/2 top-3 z-10 h-10 w-24 -translate-x-1/2 rounded-xl border border-slate-200 bg-slate-100 shadow-sm">
        {/* Щель выдачи */}
        <div className="absolute bottom-1.5 left-1/2 h-1 w-16 -translate-x-1/2 rounded-full bg-slate-300" />
        {/* Синий индикатор */}
        <div className="absolute right-2.5 top-2.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      </div>
    </div>
  );
}
