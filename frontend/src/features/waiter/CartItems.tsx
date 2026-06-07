import type { CartLine } from '@/types';
import { dishUnitPrice } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { NumberTicker } from '@/components/NumberTicker';

/**
 * Компактный список блюд корзины: название · «−» кол-во «+» · цена,
 * с тонкими разделителями. Используется и в мобильном bottom sheet,
 * и в desktop-панели заказа, чтобы вид был одинаковым.
 */
export function CartLinesList({
  lines,
  inc,
  dec,
  priceWidth = 'w-[68px]',
}: {
  lines: CartLine[];
  inc: (dishId: string) => void;
  dec: (dishId: string) => void;
  /** Ширина колонки цены (на desktop чуть шире). */
  priceWidth?: string;
}) {
  const t = useT();
  return (
    <div className="divide-y divide-border">
      {lines.map((l) => {
        const unit = dishUnitPrice(l.dish.price, l.dish.discountType, l.dish.discountValue);
        return (
          <div key={l.dish.id} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">{l.dish.name}</span>
            <div className="flex shrink-0 items-center gap-2.5">
              <RoundBtn variant="dec" onClick={() => dec(l.dish.id)} label={t('Уменьшить количество')} />
              <span className="w-5 text-center text-[15px] font-medium text-text-primary">{l.quantity}</span>
              <RoundBtn variant="inc" onClick={() => inc(l.dish.id)} label={t('Увеличить количество')} />
            </div>
            <NumberTicker
              value={unit * l.quantity}
              className={`${priceWidth} shrink-0 justify-end text-[15px] font-semibold text-text-primary`}
            />
          </div>
        );
      })}
    </div>
  );
}

export function RoundBtn({
  variant,
  onClick,
  label,
}: {
  variant: 'inc' | 'dec';
  onClick: () => void;
  label: string;
}) {
  const isDec = variant === 'dec';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-full border bg-white transition-colors ${
        isDec
          ? 'border-red-400 text-red-500 hover:bg-red-50'
          : 'border-primary text-primary hover:bg-primary/5'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        {!isDec && <path d="M7 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
