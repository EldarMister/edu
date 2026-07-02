import { useMemo, useState } from 'react';
import type { Category, CartSetComponent, Dish, DishVariant } from '@/types';
import { money, dishUnitPrice, minDishUnitPrice, variantNamesLine } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { SetPickerSheet, SetConfigSheet, defaultSetComponents } from './SetSheets';
import { VariantPickerSheet } from './VariantPickerSheet';

export function DishMenu({
  categories,
  dishes,
  quantities,
  lineCounts,
  onAdd,
  onAddSet,
  onDec,
  disabled,
  tableSlot,
}: {
  categories: Category[];
  dishes: Dish[];
  /** Количество каждого блюда в текущей корзине (dishId → qty). */
  quantities: Record<string, number>;
  /** Число разных строк корзины у блюда (dishId → count): 1 — можно показать «минус». */
  lineCounts?: Record<string, number>;
  onAdd: (dish: Dish, variant?: DishVariant) => void;
  onAddSet: (set: Dish, components: CartSetComponent[]) => void;
  onDec: (dish: Dish) => void;
  disabled?: boolean;
  /** Селект выбранного стола, который показывается справа от поиска (экран меню). */
  tableSlot?: React.ReactNode;
}) {
  const t = useT();
  const [activeCat, setActiveCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [variantDish, setVariantDish] = useState<Dish | null>(null);
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [configSet, setConfigSet] = useState<Dish | null>(null);

  // Сеты не показываем как обычные карточки — они открываются через лист «Сеты».
  const sets = useMemo(() => dishes.filter((d) => d.isSet), [dishes]);
  const setsCategoryIds = useMemo(() => new Set(sets.map((s) => s.categoryId)), [sets]);
  const menuDishes = useMemo(() => dishes.filter((d) => !d.isSet), [dishes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = menuDishes.filter((d) => {
      const byCat = activeCat === 'all' || d.categoryId === activeCat;
      const byQ = !q || d.name.toLowerCase().includes(q);
      return byCat && byQ;
    });

    return [
      ...matching.filter((d) => d.isAvailable),
      ...matching.filter((d) => !d.isAvailable),
    ];
  }, [menuDishes, activeCat, search]);

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
        {categories.map((c) => {
          const isSetsCat = setsCategoryIds.has(c.id);
          return (
            <CatTab
              key={c.id}
              active={!isSetsCat && activeCat === c.id}
              disabled={isSetsCat && disabled}
              onClick={() => (isSetsCat ? setSetPickerOpen(true) : setActiveCat(c.id))}
            >
              {c.name}
            </CatTab>
          );
        })}
      </div>

      {/* Блюда */}
      <div className="no-scrollbar grid flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto lg:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] 2xl:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        {filtered.map((d) => {
          const hasVariants = d.variants.length > 0;
          const hasDiscount = !hasVariants && d.discountType !== 'none' && Number(d.discountValue) > 0;
          const finalUnit = hasVariants ? minDishUnitPrice(d) : dishUnitPrice(d.price, d.discountType, d.discountValue);
          const qty = quantities[d.id] ?? 0;
          const active = qty > 0;
          // «Минус» доступен, когда уменьшение однозначно: обычное блюдо или
          // в корзине ровно один выбранный размер. Несколько размеров — счётчик.
          const canDecrement = !hasVariants || (lineCounts?.[d.id] ?? 0) === 1;
          const isOutOfStock = d.trackInventory && (hasVariants
            ? d.variants.every((v) => typeof v.stock === 'number' && v.stock <= 0)
            : typeof d.stock === 'number' && d.stock <= 0);
          const isDishDisabled = disabled || !d.isAvailable || isOutOfStock;
          return (
            <button
              key={d.id}
              disabled={isDishDisabled}
              onClick={() => {
                if (hasVariants) setVariantDish(d);
                else onAdd(d);
              }}
              className={`relative flex h-[100px] flex-col rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-white hover:border-primary/40'
              }`}
            >
              {!d.isAvailable ? (
                <span className="absolute right-2 top-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
                  {t('Недоступно')}
                </span>
              ) : isOutOfStock ? (
                <span className="absolute right-2 top-2 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-600">
                  {t('Нет в наличии')}
                </span>
              ) : null}
              <span
                className={`line-clamp-2 text-[15px] font-medium leading-snug text-text-primary ${
                  (!d.isAvailable || isOutOfStock) ? 'pr-20' : ''
                }`}
              >
                {d.name}
              </span>
              {hasVariants ? (
                <span className="mt-0.5 line-clamp-1 text-xs text-text-muted">{variantNamesLine(d.variants)}</span>
              ) : d.description ? (
                <span className="mt-0.5 line-clamp-1 text-xs text-text-muted">{d.description}</span>
              ) : null}
              <div className="mt-auto flex items-end justify-between pt-2">
                <span className="text-[15px] font-semibold text-text-primary">
                  {hasVariants ? `${t('от')} ${money(finalUnit)}` : money(finalUnit)}
                  {hasDiscount && (
                    <span className="ml-1.5 text-xs font-normal text-text-light line-through">
                      {money(d.price)}
                    </span>
                  )}
                </span>
                {active && canDecrement && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t('Уменьшить количество')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDec(d);
                    }}
                    className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border border-red-400 bg-white px-2.5 text-[14px] font-semibold text-red-500 transition-colors hover:bg-red-50"
                  >
                    {qty}
                  </span>
                )}
                {active && !canDecrement && (
                  <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 px-2 text-[13px] font-semibold text-primary">
                    {qty}
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

      <VariantPickerSheet
        dish={variantDish}
        onClose={() => setVariantDish(null)}
        onAdd={(variant) => {
          if (!variantDish) return;
          onAdd(variantDish, variant);
          setVariantDish(null);
        }}
      />

      <SetPickerSheet
        open={setPickerOpen}
        sets={sets}
        onClose={() => setSetPickerOpen(false)}
        onPick={(set) => {
          onAddSet(set, defaultSetComponents(set));
          setSetPickerOpen(false);
        }}
        onConfigure={(set) => {
          setSetPickerOpen(false);
          setConfigSet(set);
        }}
      />

      <SetConfigSheet
        open={!!configSet}
        set={configSet}
        menuDishes={menuDishes}
        categories={categories}
        onClose={() => setConfigSet(null)}
        onAdd={(components) => {
          if (!configSet) return;
          onAddSet(configSet, components);
          setConfigSet(null);
        }}
      />

    </div>
  );
}

function CatTab({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
        active ? 'bg-primary text-white' : 'bg-white text-text-secondary border border-border hover:bg-background'
      }`}
    >
      {children}
    </button>
  );
}
