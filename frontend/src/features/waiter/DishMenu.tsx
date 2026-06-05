import { useMemo, useState } from 'react';
import type { CartLine, Category, Dish, TableItem } from '@/types';
import { money, dishUnitPrice } from '@/lib/format';
import { cartTotals } from './cart';

export function DishMenu({
  categories,
  dishes,
  table,
  cartLines,
  onAdd,
  disabled,
}: {
  categories: Category[];
  dishes: Dish[];
  table: TableItem | null;
  cartLines: CartLine[];
  onAdd: (dish: Dish) => void;
  disabled?: boolean;
}) {
  const [activeCat, setActiveCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const totals = useMemo(() => cartTotals(cartLines), [cartLines]);

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
      <div className="mb-3 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2">
        {table ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-medium text-text-primary">Стол {table.number}</span>
            {totals.count > 0 && (
              <span className="text-xs text-text-secondary">
                Корзина: {totals.count} {dishWord(totals.count)} · {money(totals.final)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm text-text-muted">Выберите стол для заказа</span>
        )}
      </div>

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
          return (
            <button
              key={d.id}
              disabled={disabled || !d.isAvailable}
              onClick={() => onAdd(d)}
              className="flex h-[88px] flex-col rounded-xl border border-border bg-white px-3 py-2.5 text-left transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="line-clamp-2 text-[15px] font-medium leading-tight text-text-primary">
                {d.name}
              </span>
              {d.description && (
                <span className="mt-0.5 line-clamp-1 text-xs text-text-muted">{d.description}</span>
              )}
              <span className="mt-auto pt-2 text-[15px] font-semibold text-text-primary">
                {money(finalUnit)}
                {hasDiscount && (
                  <span className="ml-1.5 text-xs font-normal text-text-light line-through">
                    {money(d.price)}
                  </span>
                )}
              </span>
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

function dishWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'блюдо';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'блюда';
  return 'блюд';
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
