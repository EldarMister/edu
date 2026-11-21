import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { displayOrderNumber, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useDecideItemCancellation, useItemCancellationQueue, type ItemCancellationRequest } from './item-cancellations';

export function ItemCancellationQueuePage() {
  const t = useT();
  const queue = useItemCancellationQueue();
  const [review, setReview] = useState<ItemCancellationRequest>();
  return <section className="rounded-xl border border-border bg-white px-4 py-2">
    {queue.isPending && <Spinner className="mx-auto h-5 w-5" />}
    {queue.error && <div className="space-y-2 text-sm">
      <p role="alert" className="text-danger">{apiError(queue.error)}</p>
      <button type="button" className="btn-secondary btn-md" onClick={() => void queue.refetch()}>{t('Повторить')}</button>
    </div>}
    {queue.isSuccess && !queue.data.length && <p className="py-6 text-center text-sm text-text-muted">{t('Ожидающих заявок на отмену блюд нет')}</p>}
    <ul className="divide-y divide-border">
      {queue.data?.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
        <div className="min-w-0">
          <p className="break-words font-semibold">{request.quantity} × {request.itemName}</p>
          <p className="text-text-muted">{t('Заказ')} {displayOrderNumber(request.order.orderNumber)} · {request.requestedByName} · {timeHM(request.createdAt)}</p>
          <p className="break-words">{request.reason}</p>
        </div>
        <button type="button" className="btn-primary btn-md" onClick={() => setReview(request)}>{t('Рассмотреть заявку')}</button>
      </li>)}
    </ul>
    {review && <ReviewCancellation key={review.id} request={review} onClose={() => setReview(undefined)} />}
  </section>;
}

function ReviewCancellation({ request, onClose }: { request: ItemCancellationRequest; onClose: () => void }) {
  const t = useT();
  const decision = useDecideItemCancellation(request);
  return <Modal open title={t('Заявка на отмену блюда')} onClose={decision.isPending ? () => undefined : onClose}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={decision.isPending}
        onClick={() => decision.mutate('reject', { onSuccess: onClose })}>{t('Отклонить')}</button>
      <button type="button" className="btn-danger btn-md" disabled={decision.isPending}
        onClick={() => decision.mutate('approve', { onSuccess: onClose })}>{t('Подтвердить отмену')}</button>
    </div>}>
    <p className="font-medium">{t('Заказ')} {displayOrderNumber(request.order.orderNumber)} · {request.quantity} × {request.itemName}</p>
    <p className="mt-2 break-words text-sm text-text-secondary">{request.reason}</p>
    {decision.isError && <p role="alert" className="mt-2 text-sm text-danger">{apiError(decision.error)}</p>}
  </Modal>;
}
