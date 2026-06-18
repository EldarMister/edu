import { useMemo, useState } from 'react';
import { money } from '@/lib/format';
import { apiError } from '@/lib/api';
import { NumberTicker } from '@/components/NumberTicker';
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
    <div className="flex max-h-[88vh] flex-col rounded-t-3xl bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar-subtle px-5 pt-3">
        <div className="flex gap-4">
          <DishPhoto src={dish.imageUrl} name={dish.name} className="h-28 w-28 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="text-[18px] font-bold leading-tight text-text-primary">{dish.name}</h2>
            {dish.description && (
              <p className="mt-2 text-[13px] leading-5 text-text-secondary line-clamp-3">{dish.description}</p>
            )}
            <p className="mt-3 text-[14px] font-bold text-text-primary">от {money(fromPrice)}</p>
          </div>
        </div>

        {/* Размер / вариант */}
        {hasVariants && (
          <div className="mt-4">
            <p className="mb-2 text-[13px] font-bold text-text-primary">Размер</p>
            <div className="space-y-2">
              {dish.variants.map((v) => {
                const active = v.id === variantId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVariantId(v.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      active ? 'border-primary bg-white shadow-[0_0_0_1px_rgba(37,99,235,0.18)]' : 'border-border bg-white hover:bg-background'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          active ? 'border-primary' : 'border-border'
                        }`}
                      >
                        {active && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      <span className="truncate text-[13px] font-medium text-text-primary">{v.name}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium text-text-primary">{money(v.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-border bg-white px-3 py-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            disabled
            aria-disabled="true"
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-text-primary">Добавки</span>
              <span className="mt-0.5 block text-[12px] font-medium text-text-muted">Не выбрано</span>
            </span>
            <svg className="shrink-0 text-text-primary" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        {/* Количество */}
        <div className="mt-5 flex items-center justify-between">
          <span className="text-[13px] font-bold text-text-primary">Количество</span>
          <QtyStepper value={qty} onChange={setQty} />
        </div>

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      </div>

      {/* Кнопка добавить */}
      <div className="shrink-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={submit} disabled={add.isPending} className="btn-primary btn-lg w-full rounded-lg font-bold">
          {add.isPending ? (
            'Добавляем…'
          ) : (
            <>
              <span>Добавить · </span>
              <NumberTicker value={unitPrice * qty} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
