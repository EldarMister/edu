import { useEffect, useRef, useState } from 'react';
import type { Dish, DishVariant } from '@/types';
import { dishUnitPrice, money } from '@/lib/format';
import { useT } from '@/lib/i18n';

const VARIANT_SHEET_MS = 520;
const VARIANT_SHEET_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function VariantPickerSheet({
  dish,
  onClose,
  onAdd,
  actionLabel,
  zIndexClass = 'z-[70]',
}: {
  dish: Dish | null;
  onClose: () => void;
  onAdd: (variant: DishVariant) => void;
  actionLabel?: string;
  zIndexClass?: string;
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
    <div className={`fixed inset-0 ${zIndexClass}`}>
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
            {actionLabel ?? t('Добавить')}
          </button>
        </div>
      </div>
    </div>
  );
}
