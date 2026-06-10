import { useState } from 'react';
import type { CartLine } from '@/types';
import { useT } from '@/lib/i18n';
import { NumberTicker } from '@/components/NumberTicker';
import { cartLineKey, cartLineName, cartLineUnitPrice, cartSetChanged } from './cart';

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
  inc: (lineKey: string) => void;
  dec: (lineKey: string) => void;
  /** Ширина колонки цены (на desktop чуть шире). */
  priceWidth?: string;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="divide-y divide-border">
      {lines.map((l) => {
        const key = cartLineKey(l);
        const unit = cartLineUnitPrice(l);
        const isSet = !!l.set;
        const changed = isSet && cartSetChanged(l);
        const open = expanded[key];
        return (
          <div key={key} className="py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => isSet && setExpanded((e) => ({ ...e, [key]: !e[key] }))}
                className="min-w-0 flex-1 text-left"
                disabled={!isSet}
              >
                <span className="block truncate text-[15px] text-text-primary">{cartLineName(l)}</span>
                {isSet && (
                  <span className="text-xs text-text-muted">
                    {changed ? t('Состав изменён') : `${l.set!.components.length} ${t('блюд')}`}
                    <span className="ml-1 text-primary">{open ? '▴' : '▾'}</span>
                  </span>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-2.5">
                <RoundBtn variant="dec" onClick={() => dec(key)} label={t('Уменьшить количество')} />
                <span className="w-5 text-center text-[15px] font-medium text-text-primary">{l.quantity}</span>
                <RoundBtn variant="inc" onClick={() => inc(key)} label={t('Увеличить количество')} />
              </div>
              <NumberTicker
                value={unit * l.quantity}
                className={`${priceWidth} shrink-0 justify-end text-[15px] font-semibold text-text-primary`}
              />
            </div>
            {isSet && open && (
              <ul className="mt-1.5 space-y-0.5 pl-1 text-[13px]">
                {l.set!.components.map((c) => (
                  <li key={c.componentId} className="text-text-secondary">
                    {c.action === 'removed' ? (
                      <span className="text-text-light line-through">{c.originalName}</span>
                    ) : c.action === 'replaced' ? (
                      <span>
                        <span className="text-text-light line-through">{c.originalName}</span>
                        <span className="text-primary"> → {c.finalName}</span>
                      </span>
                    ) : (
                      <span>{c.originalName}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
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
