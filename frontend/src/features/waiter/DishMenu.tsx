import { useMemo, useState } from 'react';
import type { Category, Dish } from '@/types';
import { money, dishUnitPrice } from '@/lib/format';

export function DishMenu({
  categories,
  dishes,
  quantities,
  onAdd,
  onDec,
  disabled,
}: {
  categories: Category[];
  dishes: Dish[];
  /** Количество каждого блюда в текущей корзине (dishId → qty). */
  quantities: Record<string, number>;
  onAdd: (dish: Dish) => void;
  onDec: (dish: Dish) => void;
  disabled?: boolean;
}) {
  const [activeCat, setActiveCat] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dishes.filter((d) => {
      const byCat = activeCat === 'all' || d.categoryId === activeCat;
      const byQ = !q || d.name.toLowerCase().includes(q);
      return byCat && byQ;
    });
  }, [dishes, activeCat, search]);

  return (
    <div className="flex h-full flex-col">
      {/* Поиск */}
      <input
        className="input mb-3"
        placeholder="Поиск блюда"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Категории */}
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
        <CatTab active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
          Все
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
              className={`relative flex min-h-[108px] flex-col rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-white hover:border-primary/40'
              }`}
            >
              <span className="line-clamp-2 text-[15px] font-medium leading-snug text-text-primary">
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
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold leading-none text-white">
                      {qty}
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label="Уменьшить количество"
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
          <p className="col-span-full py-8 text-center text-sm text-text-muted">Ничего не найдено</p>
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
