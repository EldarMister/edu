import { useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, orderItemDisplayName } from '@/lib/format';
import { clientId } from '@/lib/id';
import { useT } from '@/lib/i18n';
import type { Order } from '@/types';
import { useSplitOrder } from './api';

import { activeSplitItems, indivisibleSplitItem, splitItemSelection } from './splitBillModel';

export function SplitOrderModal({ order, onClose, onSplit }: {
  order: Order;
  onClose: () => void;
  onSplit: (source: Order, next: Order) => void;
}) {
  const t = useT();
  const split = useSplitOrder();
  const request = useRef<{ payload: string; key: string }>();
  const submitting = useRef(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const items = activeSplitItems(order.items);
  const lines = splitItemSelection(items, selected);

  function close() {
    if (!submitting.current) onClose();
  }

  function change(itemId: string, quantity?: string) {
    split.reset();
    setSelected((current) => {
      if (quantity !== undefined) return { ...current, [itemId]: quantity };
      const remaining = { ...current };
      delete remaining[itemId];
      return remaining;
    });
  }

  async function submit() {
    if (submitting.current || !lines || !order.updatedAt) return;
    const payload = JSON.stringify(lines);
    if (request.current?.payload !== payload) request.current = { payload, key: clientId() };
    submitting.current = true;
    try {
      const result = await split.mutateAsync({ orderId: order.id, items: lines, expectedUpdatedAt: order.updatedAt,
        idempotencyKey: request.current.key });
      onSplit(result.sourceOrder, result.newOrder);
    } catch {
      // The mutation preserves the selection for a retry.
    } finally {
      submitting.current = false;
    }
  }

  return <Modal open title={t('Разделить по позициям')} onClose={close} panelClassName="max-w-xl"
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={split.isPending} onClick={close}>{t('Отмена')}</button>
      <button type="submit" form="split-order-form" className="btn-primary btn-md" disabled={split.isPending || !lines}>
        {split.isPending ? <Spinner /> : t('Создать отдельный чек')}
      </button>
    </div>}>
    <form id="split-order-form" className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="text-sm text-text-secondary">
        {displayOrderNumber(order.orderNumber)}. {t('Отметьте позиции и количество для нового чека.')}
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {items.map((item) => {
          const name = orderItemDisplayName(item);
          const quantity = selected[item.id];
          return <li key={item.id} className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" disabled={split.isPending}
                checked={quantity !== undefined} onChange={(event) => change(item.id, event.target.checked ? String(item.quantity) : undefined)} />
              <span className="min-w-0">
                <span className="block break-words font-medium text-text-primary">{name}</span>
                <span className="text-sm text-text-muted">×{item.quantity} · {money(item.finalPrice)}</span>
              </span>
            </label>
            {quantity !== undefined && !indivisibleSplitItem(item) && <label className="flex shrink-0 items-center gap-2 text-sm text-text-secondary">
              {t('Перенести')}
              <input type="number" inputMode="numeric" min={1} max={item.quantity} step={1} className="input w-[4.5rem] px-2"
                aria-label={`${t('Количество')} · ${name}`} value={quantity} disabled={split.isPending} required
                onChange={(event) => change(item.id, event.target.value)} />
            </label>}
          </li>;
        })}
      </ul>
      {items.every((item) => Number(selected[item.id]) === item.quantity) && <p className="text-sm text-warning" role="status">
        {t('Оставьте хотя бы одну позицию в исходном чеке.')}
      </p>}
      {split.isError && <p className="text-sm text-danger" role="alert">{apiError(split.error)}</p>}
    </form>
  </Modal>;
}
