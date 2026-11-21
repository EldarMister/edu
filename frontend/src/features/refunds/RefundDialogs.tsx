import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, orderItemDisplayName, paymentMethodLabel } from '@/lib/format';
import { clientId } from '@/lib/id';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import type { Order } from '@/types';
import { useCreateOrderRefund, useDecideOrderRefund, useRefundQuote, type OrderRefund, type RefundApproval, type RefundQuote } from './api';

function ConfirmationFields({ fiscal, monetary, hasItems, value, onChange, disabled }: {
  fiscal: boolean;
  monetary: boolean;
  hasItems: boolean;
  value: RefundApproval;
  onChange: (next: RefundApproval) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-3 text-sm" disabled={disabled}>
      {monetary && <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          checked={value.fundsReturned ?? false} onChange={(event) => onChange({ ...value, fundsReturned: event.target.checked })} />
        {t('Деньги возвращены гостю указанными способами')}
      </label>}
      {fiscal && <label className="grid gap-1.5">
        {t('Номер чека возврата ККМ')}
        <input className="input" value={value.fiscalRefundReference ?? ''} maxLength={120}
          onChange={(event) => onChange({ ...value, fiscalRefundReference: event.target.value })} />
        <span className="text-text-muted">{t('Проведите фискальный возврат на ККМ и укажите номер полученного чека.')}</span>
      </label>}
      {hasItems && <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          checked={value.restockGoods ?? false} onChange={(event) => onChange({ ...value, restockGoods: event.target.checked })} />
        {t('Вернуть на склад пригодные к продаже товары')}
      </label>}
    </fieldset>
  );
}

function RefundAmount({ refund }: { refund: Pick<RefundQuote, 'amount' | 'paymentParts'> }) {
  const t = useT();
  const perMethod = new Map<string, number>();
  for (const part of refund.paymentParts) {
    perMethod.set(part.method, (perMethod.get(part.method) ?? 0) + Number(part.amount));
  }
  return <div className="space-y-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
    <div className="flex justify-between gap-2 font-semibold">
      <span>{t('К возврату')}</span><span>{money(refund.amount)}</span>
    </div>
    {[...perMethod].map(([method, amount]) => <div key={method} className="flex justify-between gap-2 text-text-secondary">
      <span>{t(paymentMethodLabel(method))}</span><span>{money(amount)}</span>
    </div>)}
  </div>;
}

function canConfirm(refund: Pick<RefundQuote, 'requireFiscalReference' | 'paymentParts'>, approval: RefundApproval) {
  return (!refund.paymentParts.length || approval.fundsReturned === true)
    && (!refund.requireFiscalReference || !!approval.fiscalRefundReference?.trim());
}

export function OrderRefundForm({ order, mode, onClose }: { order: Order; mode: 'request' | 'manage'; onClose: () => void }) {
  const t = useT();
  const push = useNotifications((state) => state.push);
  const [requestId, refreshRequestId] = useState(clientId);
  const [reason, setReason] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [approvalDraft, setApprovalDraft] = useState<{ version: string; value: RefundApproval }>();
  const eligible = order.items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled'
    && item.quantity > (item.refundedQuantity ?? 0));
  const selected = eligible.find((item) => item.id === itemId);
  const maxQuantity = selected ? selected.quantity - (selected.refundedQuantity ?? 0) : 0;
  const enteredQuantity = Number(quantity);
  const validSelection = !itemId || !!selected && Number.isInteger(enteredQuantity) && enteredQuantity >= 1 && enteredQuantity <= maxQuantity;
  const selection = itemId ? { itemId, quantity: enteredQuantity } : {};
  const quote = useRefundQuote(order.id, selection, validSelection);
  const refund = quote.data;
  const mutation = useCreateOrderRefund(order.id, mode);
  const requesting = mode === 'request';
  const approval = approvalDraft && approvalDraft.version === refund?.version ? approvalDraft.value : {};
  const label = t(requesting ? 'Запросить возврат' : 'Оформить возврат');
  const canSubmit = validSelection && !mutation.isPending && !!reason.trim() && !!refund
    && !quote.isError && !quote.isFetching && (requesting || canConfirm(refund, approval));
  const close = () => { if (!mutation.isPending) onClose(); };

  function changeSelection(value: string) {
    setItemId(value);
    setQuantity('1');
    setApprovalDraft(undefined);
    refreshRequestId(clientId());
    mutation.reset();
  }

  async function submit() {
    if (!canSubmit || !refund) return;
    try {
      await mutation.mutateAsync({ ...selection, reason: reason.trim(), requestId, quoteVersion: refund.version,
        approval: requesting ? undefined : approval });
      push({ message: t(requesting ? 'Заявка на возврат отправлена' : 'Возврат оформлен'), at: new Date().toISOString(), type: 'success' });
      onClose();
    } catch {
      // Keep the draft and show the API error inside the dialog.
    }
  }

  return <Modal open title={label} onClose={close} panelClassName="max-w-lg"
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={mutation.isPending} className="btn-secondary btn-md" onClick={close}>{t('Отмена')}</button>
      <button type="button" disabled={!canSubmit} className="btn-primary btn-md" onClick={() => void submit()}>
        {mutation.isPending ? t('Сохраняем…') : label}
      </button>
    </div>}>
    <div className="space-y-4">
      <fieldset disabled={mutation.isPending} className="min-w-0 space-y-3 text-sm">
        <div className="grid gap-1.5">
          <span>{t('Что вернуть')}</span>
          <Select ariaLabel={t('Что вернуть')} value={itemId} onChange={changeSelection}
            options={[{ value: '', label: t('Весь остаток заказа') }, ...eligible.map((item) => ({
              value: item.id, label: orderItemDisplayName(item),
            }))]} />
        </div>
        {itemId && <label className="grid gap-1.5">
          {t('Количество для возврата')}
          <input className="input" type="number" min={1} max={maxQuantity} step={1} value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
              setApprovalDraft(undefined);
              refreshRequestId(clientId());
              mutation.reset();
            }} />
          <span className="text-text-muted">{t('Доступно для возврата')} · {maxQuantity}</span>
        </label>}
        <label className="grid gap-1.5">
          {t('Причина возврата')}
          <textarea className="input min-h-20 py-2" value={reason} maxLength={300} required
            onChange={(event) => setReason(event.target.value)} />
        </label>
      </fieldset>
      {validSelection && quote.isFetching && <p role="status" className="text-sm text-text-muted">{t('Рассчитываем сумму возврата…')}</p>}
      {validSelection && quote.error && <p role="alert" className="text-sm text-danger">{apiError(quote.error)}</p>}
      {validSelection && refund && !quote.error && <RefundAmount refund={refund} />}
      {!requesting && validSelection && refund && !quote.error && <ConfirmationFields
        fiscal={refund.requireFiscalReference} monetary={!!refund.paymentParts.length} hasItems={!!refund.items.length}
        value={approval} onChange={(value) => setApprovalDraft({ version: refund.version, value })}
        disabled={mutation.isPending || quote.isFetching} />}
      {mutation.isError && <p role="alert" className="text-sm text-danger">{apiError(mutation.error)}</p>}
    </div>
  </Modal>;
}

export function ReviewOrderRefund({ refund, onClose, onDone }: { refund: OrderRefund; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const push = useNotifications((state) => state.push);
  const [approval, setApproval] = useState<RefundApproval>({});
  const mutation = useDecideOrderRefund(refund.id);
  const close = () => { if (!mutation.isPending) onClose(); };

  async function decide(decision: 'approve' | 'reject') {
    try {
      await mutation.mutateAsync({ decision, approval: decision === 'approve' ? approval : undefined });
      push({ message: t(decision === 'approve' ? 'Возврат оформлен' : 'Заявка на возврат отклонена'),
        at: new Date().toISOString(), type: 'success' });
      onDone();
    } catch {
      // Leave the request open if the decision could not be saved.
    }
  }

  return <Modal open title={t('Заявка на возврат') + ' · ' + displayOrderNumber(refund.orderNumber)} onClose={close}
    panelClassName="max-w-lg"
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={mutation.isPending} className="btn-secondary btn-md" onClick={close}>{t('Назад')}</button>
      <button type="button" className="btn-secondary btn-md text-danger" disabled={mutation.isPending} onClick={() => void decide('reject')}>{t('Отклонить')}</button>
      <button type="button" className="btn-primary btn-md" disabled={mutation.isPending || !canConfirm(refund, approval)}
        onClick={() => void decide('approve')}>{t('Подтвердить возврат')}</button>
    </div>}>
    <div className="space-y-3">
      <p className="text-sm text-text-muted">{refund.requestedByName} · {refund.source === 'delivery' ? t('Доставка') : t('Стол') + ' ' + refund.tableNumber}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{refund.reason}</p>
      <p className="text-sm font-medium">{t(refund.itemId ? 'Возврат позиции' : 'Возврат остатка заказа')}</p>
      {!!refund.items.length && <ul className="space-y-1 text-sm text-text-secondary">
        {refund.items.map((item) => <li key={item.itemId}>{item.quantity} × {item.name}</li>)}
      </ul>}
      <RefundAmount refund={refund} />
      <ConfirmationFields fiscal={refund.requireFiscalReference} monetary={!!refund.paymentParts.length}
        hasItems={!!refund.items.length} value={approval} onChange={setApproval} disabled={mutation.isPending} />
      {mutation.isError && <p role="alert" className="text-sm text-danger">{apiError(mutation.error)}</p>}
    </div>
  </Modal>;
}
