import { displayOrderNumber } from '@/lib/format';
import { EduMenuLogo } from './ui';

const STEPS = ['Принят', 'Готовится', 'Готов', 'Подан'] as const;

/** Индекс текущего шага по статусу заказа из POS. */
function stepIndex(status: string): number {
  switch (status) {
    case 'sent_to_kitchen':
    case 'accepted_by_kitchen':
      return 0;
    case 'cooking':
      return 1;
    case 'ready':
      return 2;
    case 'served':
    case 'picked_up':
    case 'paid':
      return 3;
    default:
      return 0;
  }
}

export function SubmittedScreen({
  orderNumber,
  tableNumber,
  status,
  onBackToMenu,
}: {
  orderNumber: string;
  tableNumber: number;
  status: string;
  onBackToMenu: () => void;
}) {
  const current = stepIndex(status);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
        <EduMenuLogo />
        <span className="rounded-full bg-background px-3 py-1 text-[13px] font-semibold text-text-secondary">
          Стол {tableNumber}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar-subtle px-6">
        <div className="mx-auto flex max-w-sm flex-col items-center pt-10 text-center">
          <div className="animate-check-pop flex h-20 w-20 items-center justify-center rounded-full bg-success/10 text-success">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="mt-4 text-[22px] font-bold text-text-primary">Заказ отправлен</h1>
          <p className="mt-1 text-[15px] text-text-secondary">Ваш общий заказ принят</p>

          <div className="mt-6 w-full rounded-2xl border border-border bg-card p-5">
            <p className="text-[13px] text-text-muted">Номер заказа</p>
            <p className="text-[26px] font-bold text-primary">{displayOrderNumber(orderNumber)}</p>
            <p className="mt-1 text-[13px] text-text-muted">Стол {tableNumber}</p>

            <div className="mt-5 space-y-3 text-left">
              {STEPS.map((label, i) => {
                const done = i < current;
                const active = i === current;
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        done
                          ? 'bg-success text-white'
                          : active
                            ? 'bg-primary text-white'
                            : 'bg-background text-text-light'
                      }`}
                    >
                      {done ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : (
                        <span className="text-[12px] font-semibold">{i + 1}</span>
                      )}
                    </span>
                    <span
                      className={`text-[15px] ${
                        active ? 'font-semibold text-text-primary' : done ? 'text-text-secondary' : 'text-text-muted'
                      }`}
                    >
                      {label}
                    </span>
                    {active && (
                      <span className="ml-auto inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onBackToMenu} className="btn-secondary btn-lg w-full">
          Вернуться в меню
        </button>
      </div>
    </div>
  );
}
