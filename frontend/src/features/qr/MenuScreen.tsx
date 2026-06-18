import { useMemo, useState } from 'react';
import { money } from '@/lib/format';
import { NumberTicker } from '@/components/NumberTicker';
import type { QrDish, QrMenu, QrSession } from './api';
import { QrHeader, DishPhoto } from './ui';
import { pluralItems } from './plural';

export function MenuScreen({
  menu,
  session,
  onOpenDish,
  onOpenOrder,
}: {
  menu: QrMenu;
  session: QrSession | undefined;
  onOpenDish: (dish: QrDish) => void;
  onOpenOrder: () => void;
}) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  // QR-меню v1: обычные доступные блюда (сеты исключаем — их состав настраивается в зале).
  const dishes = useMemo(
    () => menu.dishes.filter((d) => !d.isSet && d.isAvailable),
    [menu.dishes],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dishes.filter(
      (d) =>
        (!categoryId || d.categoryId === categoryId) &&
        (!q || d.name.toLowerCase().includes(q)),
    );
  }, [dishes, categoryId, search]);

  const itemCount = session?.itemCount ?? 0;
  const activeGuestCount = session?.activeGuestCount ?? 0;
  const sharedOrder = activeGuestCount > 1;

  return (
    <div className="flex h-full flex-col">
      <QrHeader tableNumber={menu.table.number} />

      <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar-subtle">
        {/* Поиск */}
        <div className="px-4 pt-4">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-light"
              width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              className="input pl-10"
              placeholder="Поиск по меню"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Категории */}
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          <CategoryChip label="Все" active={categoryId === null} onClick={() => setCategoryId(null)} />
          {menu.categories.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.name}
              active={categoryId === c.id}
              onClick={() => setCategoryId(c.id)}
            />
          ))}
        </div>

        {/* Карточки блюд */}
        {filtered.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-text-muted">Ничего не найдено</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            {filtered.map((d) => (
              <DishCard key={d.id} dish={d} onClick={() => onOpenDish(d)} />
            ))}
          </div>
        )}

        {/* Дисклеймер о фото */}
        <p className="px-4 pb-3 pt-1 text-center text-[11px] leading-4 text-text-light">
          Фото блюд могут незначительно отличаться от реального вида.
          <br />
          Тамак-аштардын сүрөттөрү чыныгы көрүнүштөн бир аз айырмаланышы мүмкүн.
        </p>

        {/* Запас под sticky-панель */}
        <div className="h-24" />
      </div>

      {/* Sticky: общий заказ (только если есть позиции) */}
      {itemCount > 0 && (
        <div className="shrink-0 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onOpenOrder}
            className="flex w-full items-center gap-3 rounded-lg bg-primary px-4 py-3 text-left text-white transition-colors hover:bg-primary-hover"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 11V7a4 4 0 0 0-8 0v4M5 9h14l-1 11H6L5 9z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold leading-tight">{sharedOrder ? 'Общий заказ' : 'Корзина'}</span>
              <span className="flex items-center gap-1 text-[13px] text-white/85">
                <span>{pluralItems(itemCount)} ·</span>
                <NumberTicker value={Number(session?.totalAmount ?? 0)} />
              </span>
            </span>
            <span className="rounded-lg bg-white/15 px-3 py-1.5 text-[14px] font-bold">{sharedOrder ? 'Заказ' : 'Открыть'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-xl px-4 py-2 text-[14px] font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'bg-card text-text-secondary border border-border hover:bg-background'
      }`}
    >
      {label}
    </button>
  );
}

function DishCard({ dish, onClick }: { dish: QrDish; onClick: () => void }) {
  const fromPrice = dish.variants.length > 0
    ? Math.min(...dish.variants.map((v) => Number(v.price)))
    : Number(dish.price);
  const prefix = dish.variants.length > 0 ? 'от ' : '';
  return (
    <button
      type="button"
      onClick={onClick}
      className="card flex flex-col overflow-hidden p-0 text-left transition-shadow hover:shadow-soft"
    >
      <DishPhoto src={dish.imageUrl} name={dish.name} className="aspect-[4/3] w-full" />
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <h3 className="text-[14px] font-semibold leading-tight text-text-primary line-clamp-2">{dish.name}</h3>
        {dish.description && (
          <p className="mt-1 text-[12px] leading-tight text-text-muted line-clamp-2">{dish.description}</p>
        )}
        <p className="mt-2 text-[14px] font-semibold text-text-primary">
          {prefix}
          {money(fromPrice)}
        </p>
      </div>
    </button>
  );
}
