import { useMemo, useState } from 'react';
import { money } from '@/lib/format';
import { apiError } from '@/lib/api';
import { useAddItem, type QrDish } from './api';
import { BottomSheet, DishPhoto, QtyStepper } from './ui';

export function ProductSheet({
  token,
  dish,
  onClose,
}: {
  token: string;
  dish: QrDish | null;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={!!dish} onClose={onClose}>
      {dish && <ProductSheetBody token={token} dish={dish} onClose={onClose} />}
    </BottomSheet>
  );
}

function ProductSheetBody({ token, dish, onClose }: { token: string; dish: QrDish; onClose: () => void }) {
  const hasVariants = dish.variants.length > 0;
  const [variantId, setVariantId] = useState<string | null>(hasVariants ? dish.variants[0].id : null);
  const [qty, setQty] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const add = useAddItem(token);

  const unitPrice = useMemo(() => {
    if (hasVariants) {
      const v = dish.variants.find((x) => x.id === variantId) ?? dish.variants[0];
      return Number(v.price);
    }
    return Number(dish.price);
  }, [dish, hasVariants, variantId]);

  const fromPrice = hasVariants
    ? Math.min(...dish.variants.map((v) => Number(v.price)))
    : Number(dish.price);

  const submit = async () => {
    setErr(null);
    try {
      await add.mutateAsync({ dishId: dish.id, variantId: variantId ?? undefined, quantity: qty });
      onClose();
    } catch (e) {
      setErr(apiError(e));
    }
  };

  return (
    <div className="flex max-h-[88vh] flex-col">
      {/* Фото + крестик */}
      <div className="relative">
        <DishPhoto src={dish.imageUrl} name={dish.name} className="h-52 w-full rounded-t-3xl" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-text-secondary shadow-card"
          aria-label="Закрыть"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar-subtle px-5 pt-4">
        <h2 className="text-[19px] font-semibold text-text-primary">{dish.name}</h2>
        {dish.description && <p className="mt-1 text-sm leading-5 text-text-secondary">{dish.description}</p>}
        <p className="mt-2 text-sm text-text-muted">
          от <span className="font-semibold text-text-primary">{money(fromPrice)}</span>
        </p>

        {/* Размер / вариант */}
        {hasVariants && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-text-secondary">Размер</p>
            <div className="space-y-2">
              {dish.variants.map((v) => {
                const active = v.id === variantId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVariantId(v.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition-colors ${
                      active ? 'border-primary bg-primary/5' : 'border-border hover:bg-background'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                          active ? 'border-primary' : 'border-border'
                        }`}
                      >
                        {active && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                      </span>
                      <span className="text-[15px] text-text-primary">{v.name}</span>
                    </span>
                    <span className="text-[15px] font-medium text-text-secondary">{money(v.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Количество */}
        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm font-medium text-text-secondary">Количество</span>
          <QtyStepper value={qty} onChange={setQty} />
        </div>

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      </div>

      {/* Кнопка добавить */}
      <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={submit} disabled={add.isPending} className="btn-primary btn-lg w-full">
          {add.isPending ? 'Добавляем…' : `Добавить · ${money(unitPrice * qty)}`}
        </button>
      </div>
    </div>
  );
}
