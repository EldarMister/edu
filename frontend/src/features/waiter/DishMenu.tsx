import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, CartSetComponent, Dish, DishVariant } from '@/types';
import { money, dishUnitPrice, minDishUnitPrice, variantNamesLine } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { SetPickerSheet, SetConfigSheet, defaultSetComponents } from './SetSheets';

const VARIANT_SHEET_MS = 520;
const VARIANT_SHEET_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function DishMenu({
  categories,
  dishes,
  quantities,
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
      <div className="no-scrollbar grid flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto lg:grid-cols-3">
        {filtered.map((d) => {
          const hasVariants = d.variants.length > 0;
          const hasDiscount = !hasVariants && d.discountType !== 'none' && Number(d.discountValue) > 0;
          const finalUnit = hasVariants ? minDishUnitPrice(d) : dishUnitPrice(d.price, d.discountType, d.discountValue);
          const qty = quantities[d.id] ?? 0;
          const active = qty > 0;
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
                {active && !hasVariants && (
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
                {active && hasVariants && (
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

      {setPickerOpen && (
        <SetPickerSheet
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
      )}

      {configSet && (
        <SetConfigSheet
          set={configSet}
          menuDishes={menuDishes}
          onClose={() => setConfigSet(null)}
          onAdd={(components) => {
            onAddSet(configSet, components);
            setConfigSet(null);
          }}
        />
      )}
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

function VariantPickerSheet({
  dish,
  onClose,
  onAdd,
}: {
  dish: Dish | null;
  onClose: () => void;
  onAdd: (variant: DishVariant) => void;
}) {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renderDish, setRenderDish] = useState<Dish | null>(dish);
  const [visible, setVisible] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const dragRef = useRef(0);

  useEffect(() => {
    if (dish) {
      setRenderDish(dish);
      setSelectedId(null);
      setDrag(0);
      dragRef.current = 0;
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
    const id = setTimeout(() => {
      setRenderDish(null);
      setDrag(0);
      dragRef.current = 0;
    }, VARIANT_SHEET_MS);
    return () => clearTimeout(id);
  }, [dish]);

  if (!renderDish) return null;

  const selectedVariant = renderDish.variants.find((variant) => variant.id === selectedId) ?? null;
  const sheetTransform = visible ? `translateY(${drag}px)` : 'translateY(100%)';

  function onPointerDown(e: React.PointerEvent) {
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (startY.current === null) return;
    const dy = e.clientY - startY.current;
    const nextDrag = dy > 0 ? dy : 0;
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (startY.current === null) return;
    startY.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    if (dragRef.current > 110) onClose();
    else requestAnimationFrame(() => {
      dragRef.current = 0;
      setDrag(0);
    });
  }

  return (
    <div className="fixed inset-0 z-[70]">
      <div
        className="absolute inset-0 bg-black/40"
        style={{ transition: `opacity ${VARIANT_SHEET_MS}ms ease`, opacity: visible ? 1 : 0 }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[82vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-soft"
        style={{
          transform: sheetTransform,
          transition: dragging ? 'none' : `transform ${VARIANT_SHEET_MS}ms ${VARIANT_SHEET_EASE}`,
        }}
        role="dialog"
        aria-label={t('Выбор варианта')}
      >
        <div
          className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300" />
          <h2 className="text-xl font-semibold text-text-primary">{renderDish.name}</h2>
          <p className="mt-3 text-[15px] font-medium text-text-secondary">{t('Выберите размер')}</p>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 pt-1" role="radiogroup">
          {renderDish.variants.map((variant) => {
            const selected = variant.id === selectedId;
            const price = dishUnitPrice(variant.price, renderDish.discountType, renderDish.discountValue);
            const isOutOfStock = renderDish.trackInventory && typeof variant.stock === 'number' && variant.stock <= 0;
            return (
              <button
                key={variant.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={isOutOfStock}
                onClick={() => !isOutOfStock && setSelectedId(variant.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected ? 'border-primary bg-primary/5' : 'border-border bg-white hover:border-primary/40'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-primary' : 'border-slate-400'
                  }`}
                  aria-hidden
                >
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 flex-1 text-[16px] font-medium text-text-primary">
                  {variant.name}
                  {isOutOfStock && <span className="ml-2 text-xs font-medium text-red-500">{t('Нет в наличии')}</span>}
                </span>
                <span className="shrink-0 text-[16px] font-semibold text-text-primary">{money(price)}</span>
              </button>
            );
          })}
        </div>

        <div className="shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
          <button
            type="button"
            className="btn-primary h-12 w-full rounded-lg font-semibold disabled:opacity-50"
            disabled={!selectedVariant}
            onClick={() => selectedVariant && onAdd(selectedVariant)}
          >
            {t('Добавить')}
          </button>
        </div>
      </div>
    </div>
  );
}
