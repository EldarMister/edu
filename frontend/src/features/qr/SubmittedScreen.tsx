import { useMemo } from 'react';
import { displayOrderNumber, money } from '@/lib/format';
import type { QrMenu, QrSessionItem } from './api';
import { EduMenuLogo, DishPhoto } from './ui';
import { pluralItems } from './plural';

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
  items,
  totalAmount,
  itemCount,
  menu,
  onBackToMenu,
}: {
  orderNumber: string;
  tableNumber: number;
  status: string;
  items: QrSessionItem[];
  totalAmount: string;
  itemCount: number;
  menu: QrMenu;
  onBackToMenu: () => void;
}) {
  const current = stepIndex(status);

  const imageByDish = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const d of menu.dishes) m.set(d.id, d.imageUrl);
    return m;
  }, [menu.dishes]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
        <EduMenuLogo />
        <span className="rounded-full bg-background px-3 py-1 text-[13px] font-semibold text-text-secondary">
          Стол {tableNumber}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar-subtle px-4 pb-4">
        <h1 className="pt-4 text-[19px] font-bold text-text-primary">Мои заказы</h1>

        {/* Подтверждение + номер */}
        <div className="mt-3 flex flex-col items-center text-center">
          <div className="animate-check-pop flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2 className="mt-3 text-[18px] font-bold text-text-primary">Заказ отправлен</h2>
          <p className="text-[14px] text-text-secondary">Ваш общий заказ принят</p>
          <p className="mt-3 text-[13px] text-text-muted">Номер заказа</p>
          <p className="text-[26px] font-bold text-primary">{displayOrderNumber(orderNumber)}</p>
        </div>

        {/* Статус заказа */}
        <div className="mt-5 rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 text-[13px] font-semibold text-text-muted">Статус заказа</p>
          <div className="space-y-3">
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
                  {active && <span className="ml-auto inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Состав заказа */}
        {items.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
            <p className="px-4 pt-4 text-[13px] font-semibold text-text-muted">Состав заказа</p>
            <div className="mt-2">
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                  <DishPhoto
                    src={it.dishId ? imageByDish.get(it.dishId) ?? null : null}
                    name={it.name}
                    className="h-12 w-12 shrink-0 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold leading-tight text-text-primary">{it.name}</p>
                    {it.variantName && <p className="mt-0.5 text-[12px] text-text-muted">Размер: {it.variantName}</p>}
                    <p className="mt-0.5 text-[13px] text-text-secondary">
                      {it.quantity} × {money(it.price)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[15px] font-bold text-text-primary">{money(it.lineTotal)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Низ: итог + возврат в меню */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {items.length > 0 && (
          <div className="mb-2.5 flex items-end justify-between">
            <div>
              <p className="text-[12px] text-text-muted">Итого к оплате</p>
              <p className="text-[22px] font-bold text-text-primary">{money(totalAmount)}</p>
            </div>
            <span className="pb-1 text-[13px] text-text-muted">{pluralItems(itemCount)}</span>
          </div>
        )}
        <button type="button" onClick={onBackToMenu} className="btn-primary btn-lg w-full rounded-lg font-bold">
          Вернуться в меню
        </button>
      </div>
    </div>
  );
}
