import { useId, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { QueryState } from '../warehouse/WarehouseUi';
import { type CashShift, useCashShiftMutation, useCashShifts } from './api';
import { financeDateTime, financeMoney, parseMoney } from './finance-format';

export function FinanceTable({ headers, rows, empty = 'Нет записей', amounts = [], totals }: {
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
  empty?: string;
  amounts?: number[];
  totals?: ReactNode[];
}) {
  return <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Таблица отчёта">
    <table className="poster-register-table w-full min-w-max text-left">
      <thead><tr>{headers.map((label, index) => <th key={index} scope="col" className={amounts.includes(index) ? 'text-right' : undefined}>
        {label || <span className="sr-only">Действия</span>}
      </th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(({ key, cells }) => <tr key={key}>
        {cells.map((cell, index) => <td key={index} className={amounts.includes(index) ? 'text-right tabular-nums' : undefined}>{cell}</td>)}
      </tr>) : <tr><td colSpan={headers.length} className="py-10 text-center text-text-muted">{empty}</td></tr>}</tbody>
      {totals && <tfoot className="border-t border-border bg-background font-semibold"><tr>
        {totals.map((cell, index) => <td key={index} className={'px-4 py-3 ' + (amounts.includes(index) ? 'text-right tabular-nums' : '')}>{cell}</td>)}
      </tr></tfoot>}
    </table>
  </div>;
}

export function CashShiftsPage() {
  const shifts = useCashShifts();
  const [editing, setEditing] = useState<'open' | CashShift | null>(null);
  const current = shifts.data?.current;
  const history = (shifts.data?.history ?? []).filter((shift) => shift.id !== current?.id);
  const rows = current ? [current, ...history] : history;
  return <QueryState pending={shifts.isPending} error={shifts.error}>
    {shifts.data && <>
      <WorkspaceHeaderCount count={rows.length} />
      <div className="poster-toolbar">
        <span className="text-text-secondary">{current ? 'Кассовая смена открыта'
          : shifts.data.enabled ? 'Кассовая смена закрыта' : 'Кассовые смены выключены в настройках'}</span>
        {(current || shifts.data.enabled) && <button type="button" className="btn-primary btn-md ml-auto"
          onClick={() => setEditing(current ?? 'open')}>
          {current ? 'Закрыть смену' : 'Открыть смену'}
        </button>}
      </div>
      <FinanceTable headers={['Открыта', 'Закрыта', 'Остаток при открытии', 'По учёту', 'Фактически', 'Расхождение']} amounts={[2, 3, 4, 5]}
        rows={rows.map((shift) => ({ key: shift.id, cells: [
          <ShiftTime time={shift.openedAt} name={shift.openedByName} />,
          <ShiftTime time={shift.closedAt} name={shift.closedByName} />, financeMoney(shift.openingAmount),
          financeMoney(shift.expectedAmount), financeMoney(shift.actualAmount),
          <span className={shift.difference ? 'text-danger' : undefined}>{financeMoney(shift.difference)}</span>,
        ] }))} empty="Кассовых смен пока нет" />
      {editing && <ShiftDialog current={editing === 'open' ? null : editing} onClose={() => setEditing(null)} onRefresh={shifts.refetch} />}
    </>}
  </QueryState>;
}

function ShiftTime({ time, name }: { time?: string | null; name?: string | null }) {
  return <>{financeDateTime(time)}{name && <p className="text-sm text-text-muted">{name}</p>}</>;
}

function ShiftDialog({ current, onClose, onRefresh }: { current: CashShift | null; onClose: () => void; onRefresh: () => unknown }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const form = useId();
  const mutation = useCashShiftMutation(current ? 'close' : 'open');
  const validAmount = parseMoney(amount);
  const difference = validAmount != null && current ? Math.round((validAmount - current.expectedAmount) * 100) / 100 : null;
  const action = current ? 'Закрыть смену' : 'Открыть смену';
  const close = () => { if (!busy.current) onClose(); };
  return <Modal open title={action} onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" onClick={close} disabled={mutation.isPending}>Отмена</button>
    <button type="submit" className="btn-primary btn-md" form={form} disabled={validAmount == null || validAmount < 0 || mutation.isPending}>{action}</button>
  </div>}>
    <form id={form} className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      if (busy.current || validAmount == null || validAmount < 0) return;
      busy.current = true;
      setError('');
      try {
        await mutation.mutateAsync({ amount: validAmount, shiftId: current?.id, expectedAmount: current?.expectedAmount });
        onClose();
      } catch (cause) {
        setError(apiError(cause));
        void onRefresh();
      } finally {
        busy.current = false;
      }
    }}>
      {current && <p>По учёту <strong>{financeMoney(current.expectedAmount)}</strong></p>}
      <label className="grid gap-1.5">{current ? 'Фактически в кассе' : 'Наличные при открытии'}
        <input className="input w-full" value={amount} onChange={(event) => setAmount(event.target.value)}
          autoFocus inputMode="decimal" placeholder="0,00" disabled={mutation.isPending} maxLength={17} />
      </label>
      {difference != null && difference !== 0 && <p className="text-text-secondary">Расхождение {financeMoney(difference)} отразится в транзакциях.</p>}
      {error && <><p role="alert" className="text-danger">{error}</p><p className="text-text-secondary">Если сумма по учёту изменилась, закройте окно и сверьте остаток ещё раз.</p></>}
    </form>
  </Modal>;
}
