import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { Order } from '@/types';
import { usePendingRefunds, useRefundHistory, type OrderRefund } from './api';
import { OrderRefundForm, ReviewOrderRefund } from './RefundDialogs';

const labels = {
  pending: 'Ожидает подтверждения',
  approved: 'Возврат оформлен',
  rejected: 'Заявка на возврат отклонена',
} as const;

export function OrderRefunds({ order, mode }: { order: Order; mode: 'request' | 'manage' }) {
  const t = useT();
  const history = useRefundHistory(order.id);
  const [formOpen, setFormOpen] = useState(false);
  const [review, setReview] = useState<OrderRefund>();
  const pending = history.data?.find((refund) => refund.status === 'pending');
  const refundable = order.paymentStatus !== 'refunded' && order.paymentStatus !== 'cancelled';
  return <section className="space-y-2 rounded-xl border border-border px-3 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">{t('Возвраты')}</h4>
      {refundable && history.isSuccess && !pending && <button type="button" className="btn-secondary btn-md" onClick={() => setFormOpen(true)}>
        {t(mode === 'request' ? 'Запросить возврат' : 'Оформить возврат')}
      </button>}
      {pending && mode === 'manage' && <button type="button" className="btn-primary btn-md" onClick={() => setReview(pending)}>
        {t('Рассмотреть заявку')}
      </button>}
    </div>
    {history.isPending && <Spinner className="h-4 w-4" />}
    {history.error && <div className="flex flex-wrap items-center gap-2 text-sm">
      <p role="alert" className="text-danger">{apiError(history.error)}</p>
      <button type="button" className="btn-secondary btn-md" onClick={() => void history.refetch()}>{t('Повторить')}</button>
    </div>}
    {history.data?.map((refund) => <article key={refund.id} className="border-t border-border pt-2 text-sm">
      <div className="flex justify-between gap-2 font-medium">
        <span className={refund.status === 'pending' ? 'text-warning' : undefined}>{t(labels[refund.status])}</span>
        <span className="whitespace-nowrap">{money(refund.amount)}</span>
      </div>
      <p className="text-text-muted">{t(refund.itemId ? 'Возврат позиции' : 'Возврат остатка заказа')}
        {refund.itemId && refund.items[0] && ' · ' + refund.items[0].quantity + ' × ' + refund.items[0].name}</p>
      <p className="break-words">{refund.reason}</p>
      {refund.decidedByName && <p className="text-text-muted">{refund.decidedByName}{refund.decidedAt && ' · ' + timeHM(refund.decidedAt)}</p>}
      {refund.fiscalRefundReference && <p className="text-text-muted">{t('Номер чека возврата ККМ')} · {refund.fiscalRefundReference}</p>}
    </article>)}
    {formOpen && <OrderRefundForm order={order} mode={mode} onClose={() => setFormOpen(false)} />}
    {review && <ReviewOrderRefund refund={review} onClose={() => setReview(undefined)} onDone={() => setReview(undefined)} />}
  </section>;
}

export function RefundQueueButton() {
  const t = useT();
  const pending = usePendingRefunds(true);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<OrderRefund>();
  const requests = pending.data ?? [];
  return <>
    <button type="button" className="btn-secondary btn-md" onClick={() => setOpen(true)}>
      {t('Заявки на возврат')}
      {requests.length > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-white">{requests.length}</span>}
    </button>
    <Modal open={open} suspended={!!review} title={t('Заявки на возврат')} onClose={() => setOpen(false)} panelClassName="max-w-2xl">
      {pending.isPending && <Spinner className="mx-auto h-5 w-5" />}
      {pending.error && <div className="space-y-2 text-sm">
        <p role="alert" className="text-danger">{apiError(pending.error)}</p>
        <button type="button" className="btn-secondary btn-md" onClick={() => void pending.refetch()}>{t('Повторить')}</button>
      </div>}
      {pending.isSuccess && !requests.length && <p className="py-6 text-center text-sm text-text-muted">{t('Ожидающих заявок на возврат нет')}</p>}
      <ul className="divide-y divide-border">
        {requests.map((refund) => <li key={refund.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold">{t('Заказ')} {displayOrderNumber(refund.orderNumber)} · {money(refund.amount)}</p>
            <p className="text-text-muted">{refund.requestedByName} · {t(refund.itemId ? 'Возврат позиции' : 'Возврат остатка заказа')} · {timeHM(refund.createdAt)}</p>
            <p className="break-words">{refund.reason}</p>
          </div>
          <button type="button" className="btn-primary btn-md" onClick={() => setReview(refund)}>{t('Рассмотреть заявку')}</button>
        </li>)}
      </ul>
    </Modal>
    {review && <ReviewOrderRefund refund={review} onClose={() => setReview(undefined)} onDone={() => setReview(undefined)} />}
  </>;
}
