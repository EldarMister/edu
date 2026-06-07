import { useMemo, useState } from 'react';
import type { Category, Dish } from '@/types';
import { money, dishUnitPrice } from '@/lib/format';
import { useT } from '@/lib/i18n';

export function DishMenu({
  categories,
  dishes,
  quantities,
  onAdd,
  onDec,
  disabled,
  tableSlot,
}: {
  categories: Category[];
  dishes: Dish[];
  /** Количество каждого блюда в текущей корзине (dishId → qty). */
  quantities: Record<string, number>;
  onAdd: (dish: Dish) => void;
  onDec: (dish: Dish) => void;
  disabled?: boolean;
  /** Селект выбранного стола, который показывается справа от поиска (экран меню). */
  tableSlot?: React.ReactNode;
}) {
  const t = useT();
  const [activeCat, setActiveCat] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = dishes.filter((d) => {
      const byCat = activeCat === 'all' || d.categoryId === activeCat;
      const byQ = !q || d.name.toLowerCase().includes(q);
      return byCat && byQ;
    });

    return [
      ...matching.filter((d) => d.isAvailable),
      ...matching.filter((d) => !d.isAvailable),
    ];
  }, [dishes, activeCat, search]);

  return (
    <div className="flex h-full flex-col">
      {/* Поиск + выбранный стол в одну строку */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-light">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" />
            </svg>
          </span>
          <input
            className="input pl-9"
            placeholder={t('Поиск блюда')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {tableSlot}
      </div>

      {/* Категории */}
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
        <CatTab active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
          {t('Все')}
        </CatTab>
        {categories.map((c) => (
          <CatTab key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
            {c.name}
          </CatTab>
        ))}
      </div>

      {/* Блюда */}
      <div className="no-scrollbar grid flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto lg:grid-cols-3">
        {filtered.map((d) => {
          const hasDiscount = d.discountType !== 'none' && Number(d.discountValue) > 0;
          const finalUnit = dishUnitPrice(d.price, d.discountType, d.discountValue);
          const qty = quantities[d.id] ?? 0;
          const active = qty > 0;
          return (
            <button
              key={d.id}
              disabled={disabled || !d.isAvailable}
              onClick={() => onAdd(d)}
              className={`relative flex h-[100px] flex-col rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-white hover:border-primary/40'
              }`}
            >
              {!d.isAvailable && (
                <span className="absolute right-2 top-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
                  {t('Недоступно')}
                </span>
              )}
              <span
                className={`line-clamp-2 text-[15px] font-medium leading-snug text-text-primary ${
                  !d.isAvailable ? 'pr-20' : ''
                }`}
              >
                {d.name}
              </span>
              {d.description && (
                <span className="mt-0.5 line-clamp-1 text-xs text-text-muted">{d.description}</span>
              )}
              <div className="mt-auto flex items-end justify-between pt-2">
                <span className="text-[15px] font-semibold text-text-primary">
                  {money(finalUnit)}
                  {hasDiscount && (
                    <span className="ml-1.5 text-xs font-normal text-text-light line-through">
                      {money(d.price)}
                    </span>
                  )}
                </span>
                {active && (
                  <span className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[15px] font-medium text-text-primary">{qty}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={t('Уменьшить количество')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDec(d);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-red-400 bg-white text-red-500 transition-colors hover:bg-red-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-text-muted">{t('Ничего не найдено')}</p>
        )}
      </div>
    </div>
  );
}

function CatTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'bg-white text-text-secondary border border-border hover:bg-background'
      }`}
    >
      {children}
    </button>
  );
}
