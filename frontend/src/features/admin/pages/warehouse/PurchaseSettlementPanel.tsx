import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { DateTimePicker } from '@/components/DatePicker';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import type { Purchase, PurchasePayment } from './api';
import { balanceMoney } from './balance-format';
import { inventoryLocalTime, inventoryTimeDisplay, inventoryTimeIso } from './inventory-time';
import { usePurchaseSettlementAccounts, usePurchaseSettlementMutations } from './purchase-settlement-api';
import { QueryState } from './WarehouseUi';

type Action = { kind: 'pay' } | { kind: 'reconcile' } | { kind: 'reverse'; payment: PurchasePayment };

export function PurchaseSettlementPanel({ purchase, openPayment = false }: { purchase: Purchase; openPayment?: boolean }) {
  const permissions = usePermissions();
  const allowed = permissions.canEditSection('finance') && permissions.canEditSection('warehouse')
    && permissions.canAction('warehouseReceive') && permissions.canAction('warehouseCosts');
  const [action, setAction] = useState<Action | null>(openPayment && allowed && (purchase.debtAmount ?? 0) > 0 ? { kind: 'pay' } : null);
  const show = purchase.status === 'completed';
  if (!show) return null;
  const unknown = purchase.paymentStatus === 'untracked';
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Оплата поставки">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Оплата</h3>
        {allowed && unknown && <button type="button" className="btn-secondary btn-sm" onClick={() => setAction({ kind: 'reconcile' })}>Сверить оплату</button>}
        {allowed && (purchase.debtAmount ?? 0) > 0 && <button type="button" className="btn-secondary btn-sm" onClick={() => setAction({ kind: 'pay' })}>Добавить платёж</button>}
      </div>
      {unknown ? <p className="text-sm text-text-muted">По этой поставке нет подтверждённых данных об оплате.</p> :
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-text-muted">Оплачено</dt><dd>{purchase.paidAmount == null ? '—' : balanceMoney(purchase.paidAmount)}</dd></div>
          <div><dt className="text-text-muted">Задолженность</dt><dd>{purchase.debtAmount == null ? '—' : balanceMoney(purchase.debtAmount)}</dd></div>
          {(purchase.creditAmount ?? 0) > 0 && <div><dt className="text-text-muted">Переплата</dt><dd>{balanceMoney(purchase.creditAmount!)}</dd></div>}
        </dl>}
      {purchase.reconciliation && <p className="text-sm text-text-muted">Подтверждено при сверке {inventoryTimeDisplay(purchase.reconciliation.createdAt)}: {balanceMoney(purchase.reconciliation.paidAmount)}. {purchase.reconciliation.description}{purchase.reconciliation.userName && ` · ${purchase.reconciliation.userName}`}</p>}
      {purchase.payments?.length ? <ul className="divide-y divide-border rounded-lg border border-border px-3">
        {purchase.payments.map((payment) => <li key={payment.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
          <div className="min-w-0 break-words">
            <div className="font-medium">{payment.accountName} · {balanceMoney(payment.amount)}</div>
            <p className="text-text-muted"><time dateTime={payment.occurredAt}>{inventoryTimeDisplay(payment.occurredAt)}</time>{payment.actorName && ` · ${payment.actorName}`}</p>
            {payment.note && <p>{payment.note}</p>}
            {payment.reversedAt && <p className="text-text-muted">Отменён {inventoryTimeDisplay(payment.reversedAt)}. {payment.reversalReason}</p>}
          </div>
          {allowed && payment.reversible && <button type="button" className="text-danger" onClick={() => setAction({ kind: 'reverse', payment })}>Отменить платёж</button>}
        </li>)}
      </ul> : null}
      {action && createPortal(<SettlementDialog purchase={purchase} action={action} onClose={() => setAction(null)} />, document.body)}
    </section>
  );
}

type Line = { id: string; accountId: string; amount: string; date: string; specifyDate: boolean; dateValid: boolean; note: string };

function newLine(amount = ''): Line {
  return { id: crypto.randomUUID(), accountId: '', amount, date: inventoryLocalTime(), specifyDate: false, dateValid: true, note: '' };
}

function SettlementDialog({ purchase, action, onClose }: { purchase: Purchase; action: Action; onClose: () => void }) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState(() => [newLine(String(purchase.debtAmount ?? ''))]);
  const [paid, setPaid] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const { markSaved } = useEditorDirty(dirty);
  const query = usePurchaseSettlementAccounts(action.kind === 'pay');
  const mutations = usePurchaseSettlementMutations(purchase.id);
  const push = useNotifications((state) => state.push);
  const pending = mutations.pay.isPending || mutations.reconcile.isPending || mutations.reverse.isPending;
  const accounts = query.data ?? [];
  const controlsReady = action.kind !== 'pay' || accounts.length > 0;
  const total = lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0) / 100;

  useEffect(() => {
    const previous = document.activeElement;
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (controlsReady) form.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
  }, [controlsReady]);

  function close() {
    if (pending || dirty && !window.confirm('Закрыть форму и отменить изменения?')) return;
    markSaved();
    onClose();
  }
  function update(id: string, patch: Partial<Line>) {
    setDirty(true);
    setLines((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  function updateDateValidity(id: string, dateValid: boolean) {
    setLines((current) => current.some((row) => row.id === id && row.dateValid !== dateValid)
      ? current.map((row) => row.id === id ? { ...row, dateValid } : row)
      : current);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError('');
    try {
      if (action.kind === 'pay') {
        if (!accounts.length || lines.some((line) => Number(line.amount) <= 0 || line.specifyDate && (!line.dateValid || !inventoryTimeIso(line.date)))) {
          setError('Проверьте счёт, сумму и дату каждого платежа.');
          return;
        }
        if (total > (purchase.debtAmount ?? 0)) {
          setError('Сумма платежей превышает задолженность.');
          return;
        }
        await mutations.pay.mutateAsync({ requestKey, payments: lines.map((line) => ({
          accountId: line.accountId || accounts[0].id, amount: Number(line.amount),
          occurredAt: line.specifyDate ? inventoryTimeIso(line.date) : undefined, note: line.note.trim(),
        })) });
      } else if (action.kind === 'reconcile') {
        await mutations.reconcile.mutateAsync({ paidAmount: Number(paid), reason: reason.trim() });
      } else {
        await mutations.reverse.mutateAsync({ paymentId: action.payment.id, reason: reason.trim() });
      }
      push({ type: 'success', at: new Date().toISOString(), message: action.kind === 'pay' ? 'Платёж сохранён' : action.kind === 'reconcile' ? 'Оплата сверена' : 'Платёж отменён' });
      markSaved();
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    }
  }

  return <Modal open title={action.kind === 'pay' ? 'Оплата поставки' : action.kind === 'reconcile' ? 'Сверка оплаты' : 'Отмена платежа'}
    onClose={close} panelClassName={action.kind === 'pay' ? 'max-w-lg' : 'max-w-md'}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-sm" onClick={close} disabled={pending}>Закрыть</button>
      <button type="submit" form={formId} className="btn-primary btn-sm" disabled={pending || action.kind === 'pay' && !accounts.length}>
        {pending ? 'Сохранение…' : action.kind === 'reverse' ? 'Отменить платёж' : 'Сохранить'}
      </button>
    </div>}>
    <form ref={form} id={formId} onSubmit={submit} className="space-y-4 text-sm">
      {action.kind === 'pay' ? <>
        <p>Задолженность: <strong>{balanceMoney(purchase.debtAmount ?? 0)}</strong></p>
        <QueryState pending={query.isPending} error={query.error}>
          {!accounts.length && <p>Доступных счетов нет.</p>}
          {accounts.length > 0 && lines.map((line, index) => <fieldset key={line.id} disabled={pending} className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs text-text-muted">Платёж {index + 1}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select ariaLabel={`Счёт ${index + 1}`} value={line.accountId || accounts[0].id} disabled={pending}
                options={accounts.map(({ id, name }) => ({ value: id, label: name }))} onChange={(accountId) => update(line.id, { accountId })} />
              <input type="number" required step="0.01" min="0.01" inputMode="decimal" className="input w-full" aria-label={`Сумма платежа ${index + 1}`}
                placeholder="Сумма, сом" value={line.amount} onChange={(event) => update(line.id, { amount: event.target.value })} />
            </div>
            <input className="input w-full" maxLength={500} aria-label={`Комментарий к платежу ${index + 1}`} placeholder="Комментарий"
              value={line.note} onChange={(event) => update(line.id, { note: event.target.value })} />
            <label className="flex items-center gap-2"><input type="checkbox" checked={line.specifyDate}
              onChange={(event) => update(line.id, { specifyDate: event.target.checked })} /> Указать дату и время оплаты</label>
            {line.specifyDate && <DateTimePicker required value={line.date} aria-label={`Дата платежа ${index + 1}, Бишкек`}
              max={inventoryLocalTime()} onChange={(date) => update(line.id, { date })}
              onValidityChange={(dateValid) => updateDateValidity(line.id, dateValid)} />}
            {lines.length > 1 && <button type="button" className="text-danger" onClick={() => {
              setDirty(true);
              setLines((current) => current.filter(({ id }) => id !== line.id));
            }}>Убрать строку</button>}
          </fieldset>)}
          {accounts.length > 0 && <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="text-primary" disabled={pending || lines.length >= 20} onClick={() => {
              setDirty(true);
              setLines((current) => [...current, newLine()]);
            }}>Добавить счёт</button>
            <strong>Всего {balanceMoney(total)}</strong>
          </div>}
        </QueryState>
      </> : <>
        {action.kind === 'reconcile' ? <>
          <p>Укажите, сколько уже оплатили по документам. Сверка фиксирует историю оплаты без движения денег по счетам.</p>
          <label className="block space-y-1"><span>Подтверждённая сумма, сом</span><input className="input w-full" type="number"
            min="0" max={purchase.totalAmount} step="0.01" inputMode="decimal" required disabled={pending} value={paid}
            onChange={(event) => { setDirty(true); setPaid(event.target.value); }} /></label>
        </> : <p>{action.payment.accountName} · {balanceMoney(action.payment.amount)}</p>}
        <label className="block space-y-1"><span>{action.kind === 'reverse' ? 'Причина отмены' : 'Основание сверки'}</span>
          <textarea className="input min-h-20 w-full" required maxLength={500} disabled={pending} value={reason}
            onChange={(event) => { setDirty(true); setReason(event.target.value); }} />
        </label>
      </>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>
  </Modal>;
}
