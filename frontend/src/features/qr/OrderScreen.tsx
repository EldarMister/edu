import { useMemo, useState } from 'react';
import { money } from '@/lib/format';
import { apiError } from '@/lib/api';
import { NumberTicker } from '@/components/NumberTicker';
import {
  useRemoveItem,
  useSubmitOrder,
  useUpdateItem,
  type QrMenu,
  type QrSession,
  type QrSubmitResult,
} from './api';
import { QrHeader, OnlineDot, QtyStepper, ConfirmModal, DishPhoto } from './ui';
import { pluralItems, pluralGuests } from './plural';

export function OrderScreen({
  token,
  menu,
  session,
  guestId,
  onBack,
  onSubmitted,
}: {
  token: string;
  menu: QrMenu;
  session: QrSession;
  guestId: string | null;
  onBack: () => void;
  onSubmitted: (r: QrSubmitResult) => void;
}) {
  const updateItem = useUpdateItem(token);
  const removeItem = useRemoveItem(token);
  const submit = useSubmitOrder(token);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const imageByDish = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const d of menu.dishes) m.set(d.id, d.imageUrl);
    return m;
  }, [menu.dishes]);

  // Группируем только гостей, у которых есть позиции в текущем заказе.
  // Старые QR-гости могут оставаться в draft-сессии после повторных открытий меню.
  const groups = useMemo(() => {
    return session.guests
      .map((g) => ({
        guest: g,
        items: session.items.filter((i) => i.guestId === g.id),
      }))
      .filter((grp) => grp.items.length > 0);
  }, [session]);
  const sharedOrder = session.activeGuestCount > 1;
  const singleItems = groups[0]?.items ?? [];

  const doSubmit = async () => {
    setErr(null);
    try {
      const res = await submit.mutateAsync();
      setConfirm(false);
      onSubmitted(res);
    } catch (e) {
      setErr(apiError(e));
      setConfirm(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <QrHeader tableNumber={menu.table.number} />

      <div className="min-h-0 flex-1 overflow-y-auto app-scrollbar-subtle px-4">
        {/* Заголовок */}
        <div className="flex items-center gap-2 pt-4">
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-background"
            aria-label="Назад в меню"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-[19px] font-bold text-text-primary">{sharedOrder ? 'Заказ' : 'Корзина'}</h1>
        </div>

        {/* Бейдж гостей */}
        {sharedOrder && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-[13px] font-medium text-text-secondary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            За столом: {pluralGuests(groups.length)}
          </div>
        )}

        {/* Группы по гостям */}
        <div className="mt-4 space-y-4 pb-4">
          {sharedOrder ? (
            groups.map(({ guest, items }, index) => (
              <div key={guest.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold text-text-primary">Гость {index + 1}</span>
                    {guest.id === guestId && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">вы</span>
                    )}
                  </div>
                  <OnlineDot on={guest.isOnline} />
                </div>
                <div>{items.map((it) => renderItem(it))}</div>
              </div>
            ))
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
              {singleItems.map((it) => renderItem(it))}
            </div>
          )}
        </div>
      </div>

      {/* Sticky: итог + отправка */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {err && <p className="mb-2 text-center text-[13px] text-danger">{err}</p>}
        <div className="mb-2.5 flex items-end justify-between">
          <div>
            <p className="text-[12px] text-text-muted">Итого к оплате</p>
            <NumberTicker value={Number(session.totalAmount)} className="text-[22px] font-bold text-text-primary" />
          </div>
          <span className="pb-1 text-[13px] text-text-muted">{pluralItems(session.itemCount)}</span>
        </div>
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={session.itemCount === 0 || submit.isPending}
          className="btn-primary btn-lg w-full rounded-lg font-bold"
        >
          {submit.isPending ? (
            'Отправляем…'
          ) : (
            <>
              <span>{sharedOrder ? 'Отправить заказ' : 'Отправить'} · </span>
              <NumberTicker value={Number(session.totalAmount)} />
            </>
          )}
        </button>
      </div>

      <ConfirmModal
        open={confirm}
        title={sharedOrder ? 'Отправить заказ?' : 'Отправить корзину?'}
        text="Все позиции общего заказа будут отправлены официанту и на кухню."
        busy={submit.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={doSubmit}
      />
    </div>
  );

  function renderItem(it: QrSession['items'][number]) {
    const own = it.guestId === guestId;
    return (
      <div key={it.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
        <DishPhoto src={it.dishId ? imageByDish.get(it.dishId) ?? null : null} name={it.name} className="h-12 w-12 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold leading-tight text-text-primary">{it.name}</p>
          {it.variantName && <p className="text-[12px] text-text-muted">Размер: {it.variantName}</p>}
          <p className="mt-0.5 text-[13px] text-text-secondary">
            {it.quantity} × {money(it.price)}
          </p>
        </div>
        {own ? (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <QtyStepper
              size="sm"
              value={it.quantity}
              onChange={(v) => updateItem.mutate({ itemId: it.id, quantity: v })}
            />
            <NumberTicker value={Number(it.lineTotal)} className="text-[13px] font-bold text-text-primary" />
            <button
              type="button"
              onClick={() => removeItem.mutate(it.id)}
              className="text-[12px] font-medium text-danger hover:underline"
            >
              Удалить
            </button>
          </div>
        ) : (
          <NumberTicker value={Number(it.lineTotal)} className="shrink-0 text-[14px] font-bold text-text-primary" />
        )}
      </div>
    );
  }
}
