import { useId, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { EditorPage } from '../warehouse/EditorPage';
import { DocumentField, QueryState } from '../warehouse/WarehouseUi';
import { FinanceTable } from './CashShiftsPage';
import { useFinanceWrites, useSalaryAccrual, type SalaryAccrualDetails, type SalaryPaymentRecord } from './api';
import { financeDateTime, financeMoney, parseMoney } from './finance-format';

type Action = { kind: 'edit'; accrual: SalaryAccrualDetails } | { kind: 'cancel'; accrual: SalaryAccrualDetails }
  | { kind: 'reverse'; accrual: SalaryAccrualDetails; payment: SalaryPaymentRecord };

export function SalaryAccrualCard({ id, onClose, onPay, canPay, canEdit }: {
  id: string; onClose: () => void; onPay: () => void; canPay: boolean; canEdit: boolean;
}) {
  const query = useSalaryAccrual(id);
  const [action, setAction] = useState<Action | null>(null);
  const row = query.data;
  return <EditorPage title="Начисление зарплаты" onClose={onClose}>
    <QueryState pending={query.isPending} error={query.error}>
      {row && <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{row.employeeName}</h2>
          <p className="text-sm text-text-muted">Расчётный месяц: {row.month.split('-').reverse().join('.')} · {row.supplemental ? 'Премия / доплата' : 'Основная зарплата'}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 rounded-lg border border-border p-4 text-sm">
          {[
            ['Начислено', row.voidedAt ? 0 : row.amount], ['Выплачено', row.paidAmount],
            ['К выплате', row.voidedAt ? 0 : row.amount - row.paidAmount],
          ].map(([label, amount]) => <div key={String(label)}><dt className="text-text-muted">{label}</dt>
            <dd className="mt-1 font-semibold tabular-nums">{financeMoney(Number(amount))}</dd></div>)}
        </dl>
        {row.note && <p className="whitespace-pre-wrap text-sm">{row.note}</p>}
        {row.voidedAt ? <p className="text-sm text-text-muted">Отменено {financeDateTime(row.voidedAt)}: {row.voidReason}</p>
          : <div className="flex flex-wrap gap-3">
            {canPay && row.paidAmount < row.amount && <button type="button" className="btn-primary btn-md" onClick={onPay}>Выплатить</button>}
            {canEdit && <button type="button" className="btn-secondary btn-md" onClick={() => setAction({ kind: 'edit', accrual: row })}>Исправить начисление</button>}
            {canEdit && row.paidAmount === 0 && <button type="button" className="btn-secondary btn-md" onClick={() => setAction({ kind: 'cancel', accrual: row })}>Отменить начисление</button>}
          </div>}
        <section aria-label="История выплат">
          <h3 className="mb-2 font-semibold">Выплаты и отмены</h3>
          <p className="mb-2 text-sm text-text-muted">Дата выплаты — день движения денег по счёту. Расчётный месяц начисления при этом сохраняется.</p>
          <FinanceTable headers={['Дата записи', 'Дата движения', 'Операция', 'Счёт', 'Сумма по счёту', 'Сотрудник', 'Комментарий', '']} amounts={[4]}
            rows={row.payments.map((payment) => ({ key: payment.id, cells: [
              financeDateTime(payment.createdAt), financeDateTime(payment.occurredAt), payment.reversalOf ? 'Отмена выплаты' : payment.reversedAt ? 'Выплата отменена' : 'Выплата',
              payment.accountName, financeMoney(payment.amount), payment.actorName, payment.note || '—',
              canEdit && payment.reversible ? <button type="button" className="text-primary" onClick={() => setAction({ kind: 'reverse', accrual: row, payment })}>Отменить выплату</button>
                : payment.reverseBlockedReason ? <span className="text-xs text-text-muted">{payment.reverseBlockedReason}</span> : null,
            ] }))} empty="Выплат пока нет" />
        </section>
        <section aria-label="История исправлений">
          <h3 className="mb-2 font-semibold">История начисления</h3>
          <p className="mb-2 text-sm text-text-muted">Создано {financeDateTime(row.createdAt)} · {row.createdByName}. Исправления сохраняют автора, причину и предыдущую сумму.</p>
          <FinanceTable headers={['Дата', 'Действие', 'Было', 'Стало', 'Автор', 'Причина']} amounts={[2, 3]}
            rows={row.history.map((entry) => ({ key: String(entry.revision), cells: [
              financeDateTime(entry.at), entry.type === 'cancel' ? 'Отмена начисления' : 'Исправление',
              financeMoney(entry.before.amount), entry.type === 'cancel' ? '—' : financeMoney(entry.after.amount), entry.actorName,
              <div>{entry.reason}{entry.before.note !== entry.after.note && <p className="mt-1 text-xs text-text-muted">
                Комментарий: {entry.before.note || '—'} → {entry.after.note || '—'}</p>}</div>,
            ] }))} empty="Начисление не исправляли" />
        </section>
      </div>}
    </QueryState>
    {query.isError && <button type="button" className="btn-secondary btn-md" onClick={() => void query.refetch()}>Повторить</button>}
    {canEdit && action && <SalaryActionDialog action={action} onClose={() => setAction(null)} />}
  </EditorPage>;
}

function SalaryActionDialog({ action, onClose }: { action: Action; onClose: () => void }) {
  const formId = useId();
  const busy = useRef(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(String(action.accrual.amount));
  const [note, setNote] = useState(action.accrual.note ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { editAccrual, cancelAccrual, reverseSalaryPayment } = useFinanceWrites();
  const validAmount = parseMoney(amount);
  const invalid = !reason.trim() || (action.kind === 'edit' && (validAmount == null || validAmount <= 0 || validAmount < action.accrual.paidAmount));
  const title = action.kind === 'edit' ? 'Исправить начисление' : action.kind === 'cancel' ? 'Отменить начисление' : 'Отменить ошибочную выплату';
  const close = () => { if (!busy.current) onClose(); };
  return <Modal open title={title} onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" disabled={saving} onClick={close}>Назад</button>
    <button type="submit" form={formId} className={action.kind === 'edit' ? 'btn-primary btn-md' : 'btn-danger btn-md'} disabled={saving || invalid}>
      {saving ? 'Сохранение…' : action.kind === 'edit' ? 'Сохранить исправление' : 'Подтвердить отмену'}
    </button>
  </div>}>
    <form id={formId} className="space-y-4" onSubmit={async (event) => {
      event.preventDefault();
      if (invalid || busy.current) return;
      busy.current = true;
      setSaving(true);
      setError('');
      try {
        const input = { id: action.accrual.id, revision: action.accrual.revision, requestKey, reason: reason.trim() };
        if (action.kind === 'edit') await editAccrual.mutateAsync({ ...input, amount: validAmount!, note: note.trim() });
        else if (action.kind === 'cancel') await cancelAccrual.mutateAsync(input);
        else await reverseSalaryPayment.mutateAsync({ id: action.accrual.id, paymentId: action.payment.id, reason: reason.trim() });
        onClose();
      } catch (cause) { setError(apiError(cause)); }
      finally { busy.current = false; setSaving(false); }
    }}>
      {action.kind === 'edit' ? <>
        <DocumentField label="Сумма начисления"><input className="input w-full" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></DocumentField>
        <p className="text-sm text-text-muted">Уже выплачено {financeMoney(action.accrual.paidAmount)}. Новая сумма не может быть меньше выплаты. Исправится задолженность; расчёт по ставкам и движения по счетам сохранятся.</p>
        <DocumentField label="Комментарий"><textarea className="input w-full" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></DocumentField>
      </> : <p className="text-sm text-text-muted">{action.kind === 'cancel'
        ? 'Начисление будет исключено из задолженности. Запись и история сохранятся. Деньги по счетам не перемещаются.'
        : `Отменяйте запись только если деньги сотруднику фактически не выдавали. Баланс счёта «${action.payment.accountName}» восстановится на ${financeMoney(-action.payment.amount)}, а задолженность сотруднику увеличится. В движении денег исправление относится к дате исходной выплаты.`}</p>}
      <DocumentField label="Причина исправления"><textarea className="input w-full" value={reason} maxLength={500} rows={3} required onChange={(event) => setReason(event.target.value)} /></DocumentField>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    </form>
  </Modal>;
}
