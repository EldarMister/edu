import { useId, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { DatePicker } from '@/components/DatePicker';
import { useQuery } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { QueryState } from '../warehouse/WarehouseUi';
import { EditorPage } from '../warehouse/EditorPage';
import { useEditorRoute, usePageFilter } from '../warehouse/workspace-route';
import { cashShiftKey, type CashShift, type EntryKind, useCashShiftMutation, useCashShifts } from './api';
import { financeDateTime, financeDay, financeMoney, parseMoney } from './finance-format';

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
  const today = financeDay();
  const [from, setFrom] = usePageFilter('from', financeDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = usePageFilter('to', today);
  const rangeValid = !!from && !!to && from <= to;
  const shifts = useCashShifts(rangeValid, '/admin/cash-shifts', { from, to });
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [editing, setEditing] = useState<'open' | CashShift | null>(null);
  const current = shifts.data?.current;
  const history = (shifts.data?.history ?? []).filter((shift) => shift.id !== current?.id);
  const rows = current ? [current, ...history] : history;
  if (editor?.type === 'cashShiftHistory' && editor.id) {
    const shift = rows.find(({ id }) => id === editor.id);
    return <EditorPage title="Кассовая смена" onClose={closeEditor}>
      <QueryState pending={shifts.isPending && rangeValid} error={shifts.error}>
        {shift ? <CashShiftDetails shift={shift} /> : <p>Смена не найдена в выбранном периоде.</p>}
      </QueryState>
    </EditorPage>;
  }
  const period = <>
    <DatePicker aria-label="С даты" className="input w-36" value={from} max={to} onChange={setFrom} />
    <DatePicker aria-label="По дату" className="input w-36" value={to} min={from} max={today} onChange={setTo} />
  </>;
  if (!rangeValid) return <><div className="poster-toolbar">{period}</div>
    <p role="alert" className="text-danger">Укажите начало и конец периода.</p></>;
  return <QueryState pending={shifts.isPending} error={shifts.error}>
    {shifts.data && <>
      <WorkspaceHeaderCount count={rows.length} />
      <div className="poster-toolbar">
        {period}
        <span className="text-text-secondary">{current ? 'Кассовая смена открыта'
          : shifts.data.enabled ? 'Кассовая смена закрыта' : 'Кассовые смены выключены в настройках'}</span>
        {(current || shifts.data.enabled) && <button type="button" className="btn-primary btn-md ml-auto"
          onClick={() => setEditing(current ?? 'open')}>
          {current ? 'Закрыть смену' : 'Открыть смену'}
        </button>}
      </div>
      <FinanceTable headers={['Смена открыта', 'Смена закрыта', 'Начало смены', 'Инкассация', 'По учёту', 'В кассе', 'Разница']} amounts={[2, 3, 4, 5, 6]}
        rows={rows.map((shift) => ({ key: shift.id, cells: [
          <button type="button" className="text-left text-primary"
            onClick={() => openEditor({ type: 'cashShiftHistory', id: shift.id })}>
            <ShiftTime time={shift.openedAt} name={shift.openedByName} />
          </button>,
          <ShiftTime time={shift.closedAt} name={shift.closedByName} />, financeMoney(shift.openingAmount),
          financeMoney(shift.collectionAmount),
          financeMoney(shift.expectedAmount), financeMoney(shift.actualAmount),
          <span className={shift.difference ? 'text-danger' : undefined}>{financeMoney(shift.difference)}</span>,
        ] }))} empty="Кассовых смен пока нет" />
      {editing && <ShiftDialog current={editing === 'open' ? null : editing} onClose={() => setEditing(null)} onRefresh={shifts.refetch} />}
    </>}
  </QueryState>;
}

const shiftEntryLabel: Record<EntryKind, string> = {
  income: 'Внесение', expense: 'Расход', transfer: 'Перевод', sale: 'Выручка', refund: 'Возврат',
  salary: 'Выплата зарплаты', adjustment: 'Корректировка остатка',
};

function CashShiftDetails({ shift }: { shift: CashShift }) {
  const entries = useQuery({
    queryKey: [...cashShiftKey, 'movements', shift.id],
    queryFn: async () => (await api.get<{
      id: string; occurredAt: string; kind: EntryKind; category: string | null; note: string | null; amount: number;
      reconciliation: 'open' | 'close' | null;
    }[]>('/admin/cash-shifts/' + shift.id + '/movements')).data,
  });
  return <div className="space-y-4">
    <dl className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-3">
      {([
        ['Смена открыта', financeDateTime(shift.openedAt)], ['Смена закрыта', financeDateTime(shift.closedAt)],
        ['Начало смены', financeMoney(shift.openingAmount)], ['По учёту', financeMoney(shift.expectedAmount)],
        ['В кассе', financeMoney(shift.actualAmount)], ['Разница', financeMoney(shift.difference)],
      ] as const).map(([label, value]) => <div key={label}>
        <dt className="text-sm text-text-muted">{label}</dt><dd>{value}</dd>
      </div>)}
    </dl>
    <QueryState pending={entries.isPending} error={entries.error}>
      <FinanceTable headers={['Дата', 'Операция', 'Категория', 'Комментарий', 'Сумма']} amounts={[4]}
        rows={(entries.data ?? []).map((entry) => ({ key: entry.id, cells: [
          financeDateTime(entry.occurredAt), entry.reconciliation === 'open' ? 'Сверка при открытии'
            : entry.reconciliation === 'close' ? 'Сверка при закрытии' : shiftEntryLabel[entry.kind],
          entry.category ?? '—', entry.note ?? '—', financeMoney(entry.amount),
        ] }))} empty="По этой смене нет операций" />
    </QueryState>
  </div>;
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
