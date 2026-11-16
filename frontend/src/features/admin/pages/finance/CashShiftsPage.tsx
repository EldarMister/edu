import { useId, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { QueryState } from '../warehouse/WarehouseUi';
import { EditorPage } from '../warehouse/EditorPage';
import { useEditorRoute, usePageFilters } from '../warehouse/workspace-route';
import { cashShiftKey, financeKey, type CashShift, type EntryKind, useCashShiftMutation, useCashShifts } from './api';
import { financeDateTime, financeDay, financeMoney, parseMoney } from './finance-format';
import { FinancePeriod } from './FinancePeriod';
import { printRegister } from './FinanceRegister';
import { CashOperationDialog, type CashOperation } from './CashOperationDialog';

export function FinanceTable({ headers, rows, empty = 'Нет записей', amounts = [], totals }: {
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
  empty?: ReactNode;
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
      </tr>) : empty != null && <tr><td colSpan={headers.length} className="py-10 text-center text-text-muted">{empty}</td></tr>}</tbody>
      {totals && <tfoot className="border-t border-border bg-background font-semibold"><tr>
        {totals.map((cell, index) => <td key={index} className={'px-4 py-3 ' + (amounts.includes(index) ? 'text-right tabular-nums' : '')}>{cell}</td>)}
      </tr></tfoot>}
    </table>
  </div>;
}

export function CashShiftsPage() {
  const today = financeDay();
  const [{ from, to }, setPeriod] = usePageFilters({ from: financeDay(new Date(Date.now() - 30 * 86_400_000)), to: today });
  const rangeValid = !!from && !!to && from <= to;
  const shifts = useCashShifts(rangeValid, '/admin/cash-shifts', { from, to });
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [editing, setEditing] = useState<'open' | 'close' | null>(null);
  const [printBlocked, setPrintBlocked] = useState(false);
  const current = shifts.data?.current;
  const history = (shifts.data?.history ?? []).filter((shift) => shift.id !== current?.id);
  const openDay = current && financeDay(new Date(current.openedAt));
  const rows = current && openDay && openDay >= from && openDay <= to ? [current, ...history] : history;
  const columns = ['#', 'Смена открыта', 'Смена закрыта', 'Начало смены', 'Инкассация', 'В кассе', 'Разница'];
  if (editor?.type === 'cashShiftHistory' && editor.id) {
    const shift = (current?.id === editor.id ? current : history.find(({ id }) => id === editor.id));
    return <EditorPage title={shift ? 'Кассовая смена №' + shift.number : 'Кассовая смена'} onClose={closeEditor}>
      <QueryState pending={shifts.isPending && rangeValid} error={shifts.error}>
        {shift ? <CashShiftDetails shift={shift} /> : <p>Смена не найдена в выбранном периоде.</p>}
      </QueryState>
    </EditorPage>;
  }
  const period = <FinancePeriod from={from} to={to} onApply={setPeriod} />;
  if (!rangeValid) return <><div className="poster-toolbar">{period}</div>
    <p role="alert" className="text-danger">Укажите начало и конец периода.</p></>;
  return <QueryState pending={shifts.isPending} error={shifts.error}>
    {shifts.data && <>
      <div className="finance-register">
        <div className="finance-register-toolbar">
          {(current || shifts.data.enabled) && <button type="button" className="btn-secondary btn-md"
            onClick={() => setEditing(current ? 'close' : 'open')}>
            {current ? 'Закрыть смену' : 'Открыть смену'}
          </button>}
          <div className="finance-register-tools">
          <button type="button" className="btn-secondary btn-md" disabled={!rows.length}
            onClick={() => setPrintBlocked(!printRegister('Кассовые смены', [columns, ...rows.map((shift) => [
              shift.number, financeDateTime(shift.openedAt), financeDateTime(shift.closedAt), shift.openingAmount, shift.collectionAmount,
              shift.actualAmount ?? shift.expectedAmount, shift.difference,
            ])]))}>Распечатать</button>
          {period}
          </div>
        </div>
        {printBlocked && <p role="alert" className="text-danger">Разрешите всплывающие окна и повторите печать.</p>}
        <FinanceTable headers={columns} amounts={[0, 3, 4, 5, 6]}
          rows={rows.map((shift) => ({ key: shift.id, cells: [
            shift.number,
            <button type="button" className="text-left text-primary hover:underline"
              onClick={() => openEditor({ type: 'cashShiftHistory', id: shift.id })}>
              <ShiftTime time={shift.openedAt} name={shift.openedByName} />
            </button>,
            shift.closedAt ? <ShiftTime time={shift.closedAt} name={shift.closedByName} /> : <span className="text-success">Открыта</span>,
            <>{financeMoney(shift.openingAmount)}{shift.openingDifference !== 0 &&
              <span className="block text-xs text-danger" title="Расхождение при открытии">{financeMoney(shift.openingDifference)}</span>}</>,
            financeMoney(shift.collectionAmount),
            financeMoney(shift.actualAmount ?? shift.expectedAmount),
            <span className={shift.difference ? 'text-danger' : undefined}>{financeMoney(shift.difference)}</span>,
          ] }))} empty={null} />
        {!rows.length && <div className="grid min-h-64 place-content-center gap-3 px-4 pb-16 pt-14 text-center">
          <p className="text-lg font-medium">За этот период кассовых смен нет</p>
          <p className="max-w-sm text-sm text-text-muted">{shifts.data.enabled
            ? 'Откройте смену с суммой размена, чтобы отслеживать деньги в кассе.'
            : 'Кассовые смены выключены в настройках заведения.'}</p>
        </div>}
      </div>
      {editing && (editing === 'open' || current) && <ShiftDialog current={editing === 'close' ? current! : null}
        onClose={() => setEditing(null)} onRefresh={shifts.refetch} />}
    </>}
  </QueryState>;
}

const shiftEntryLabel: Record<EntryKind, string> = {
  income: 'Внесение', expense: 'Расход', transfer: 'Перевод', sale: 'Выручка', refund: 'Возврат',
  salary: 'Выплата зарплаты', adjustment: 'Корректировка остатка',
};

type ShiftEntry = {
  id: string; occurredAt: string; kind: EntryKind; category: string | null; categoryId: string | null;
  note: string | null; actorName: string | null; amount: number; cash: boolean; editable: boolean;
  collection?: boolean;
  reconciliation: 'open' | 'close' | null;
};

function CashShiftDetails({ shift }: { shift: CashShift }) {
  const [editCount, setEditCount] = useState<'openingAmount' | 'actualAmount' | null>(null);
  const [operation, setOperation] = useState<'create' | CashOperation | null>(null);
  const [deleteOperation, setDeleteOperation] = useState<ShiftEntry | null>(null);
  const cache = useQueryClient();
  const endpoint = '/admin/cash-shifts/' + shift.id;
  const entries = useQuery({
    queryKey: [...cashShiftKey, 'movements', shift.id],
    queryFn: async () => (await api.get<ShiftEntry[]>(endpoint + '/movements')).data,
  });
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: cashShiftKey }), cache.invalidateQueries({ queryKey: financeKey })]);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(endpoint + '/operations/' + id),
    onSuccess: async () => { await refresh(); setDeleteOperation(null); },
  });
  const movements = entries.data?.filter((entry) => !entry.reconciliation) ?? [];
  const sum = (predicate: (entry: ShiftEntry) => boolean) =>
    Math.round(movements.reduce((total, entry) => total + (predicate(entry) ? entry.amount : 0), 0) * 100) / 100;
  const revenue = (entry: ShiftEntry) => entry.kind === 'sale' || entry.kind === 'refund';
  const otherTransfers = sum((entry) => entry.kind === 'transfer' && !entry.collection);
  const metrics = [
    { label: 'Открытие смены', amount: shift.openingAmount, key: 'openingAmount' as const },
    { label: 'Наличная выручка', amount: sum((entry) => entry.cash && revenue(entry)) },
    { label: 'Безналичная выручка', amount: sum((entry) => !entry.cash && revenue(entry)) },
    { label: 'Внесения', amount: sum((entry) => entry.kind === 'income') },
    { label: 'Расходы', amount: -sum((entry) => entry.kind === 'expense' || entry.kind === 'salary') },
    { label: 'Инкассация', amount: shift.collectionAmount },
    ...(otherTransfers ? [{ label: 'Другие переводы', amount: otherTransfers }] : []),
    { label: 'Книжный баланс', amount: shift.expectedAmount },
    { label: 'Фактический баланс', amount: shift.actualAmount, key: 'actualAmount' as const },
    { label: 'Разница', amount: shift.difference },
  ];
  return <div className="finance-register space-y-5">
    <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-border px-4 py-3 text-sm text-text-muted">
      <span>Открыта <ShiftTime time={shift.openedAt} name={shift.openedByName} /></span>
      {shift.closedAt && <span>Закрыта <ShiftTime time={shift.closedAt} name={shift.closedByName} /></span>}
    </div>
    <QueryState pending={entries.isPending} error={entries.error}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(210px,285px)_minmax(0,1fr)]">
        <dl className="divide-y divide-border px-4 text-sm">
          {metrics.map(({ label, amount, key }) => <div key={label} className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="flex flex-wrap justify-end gap-2 text-right tabular-nums">
              <span className={label === 'Разница' && amount ? 'text-danger' : undefined}>{financeMoney(amount)}</span>
              {key && amount != null && <button type="button" className="text-primary hover:underline"
                aria-label={'Изменить ' + label.toLowerCase()} onClick={() => setEditCount(key)}>Ред.</button>}
            </dd>
          </div>)}
        </dl>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 px-4 pb-2">
            <h2 className="font-semibold">Транзакции смены</h2>
            <button type="button" className="text-sm text-primary hover:underline" onClick={() => setOperation('create')}>+ Добавить транзакцию</button>
          </div>
          <FinanceTable headers={['Дата и время', 'Тип', 'Категория', 'Сотрудник', 'Комментарий', 'Сумма', '']} amounts={[5]}
        rows={(entries.data ?? []).map((entry) => ({ key: entry.id, cells: [
          financeDateTime(entry.occurredAt), entry.reconciliation === 'open' ? 'Сверка при открытии'
            : entry.reconciliation === 'close' ? 'Сверка при закрытии'
              : entry.collection ? 'Инкассация'
                : revenue(entry) ? shiftEntryLabel[entry.kind] + (entry.cash ? ' наличными' : ' безналично') : shiftEntryLabel[entry.kind],
          entry.category ?? (entry.editable ? 'Кассовые смены' : '—'), entry.actorName ?? '—', entry.note ?? '—',
          <span className={entry.kind === 'income' ? 'text-success' : entry.kind === 'expense' ? 'text-danger' : undefined}>
            {financeMoney(entry.amount)}
          </span>,
          entry.editable && <div className="flex gap-3">
            <button type="button" className="text-primary hover:underline"
              onClick={() => setOperation({ ...entry, kind: entry.kind === 'transfer' ? 'collection' : entry.kind as 'income' | 'expense' })}>Ред.</button>
            <button type="button" className="text-text-muted hover:text-danger" aria-label="Удалить транзакцию"
              onClick={() => { remove.reset(); setDeleteOperation(entry); }}>×</button>
          </div>,
        ] }))} empty="По этой смене нет операций" />
        </div>
      </div>
    </QueryState>
    {operation && <CashOperationDialog shiftId={shift.id} operation={operation === 'create' ? undefined : operation}
      onClose={() => setOperation(null)} />}
    {editCount && <CountDialog endpoint={endpoint} field={editCount} amount={shift[editCount] ?? 0}
      onClose={() => setEditCount(null)} onSuccess={refresh} />}
    {deleteOperation && <Modal open title="Удалить транзакцию?" onClose={() => { if (!remove.isPending) setDeleteOperation(null); }}
      footer={<div className="flex gap-2">
        <button type="button" className="btn-danger btn-md" disabled={remove.isPending} onClick={() => remove.mutate(deleteOperation.id)}>Удалить</button>
        <button type="button" className="btn-secondary btn-md" disabled={remove.isPending} onClick={() => setDeleteOperation(null)}>Отмена</button>
      </div>}>
      <p>Операция на {financeMoney(Math.abs(deleteOperation.amount))} будет удалена. Книжный баланс смены пересчитается.</p>
      {remove.error && <p role="alert" className="mt-2 text-danger">{apiError(remove.error)}</p>}
    </Modal>}
  </div>;
}

function CountDialog({ endpoint, field, amount, onClose, onSuccess }: {
  endpoint: string;
  field: 'openingAmount' | 'actualAmount';
  amount: number;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}) {
  const [value, setValue] = useState(String(amount));
  const formId = useId();
  const parsed = parseMoney(value);
  const save = useMutation({
    mutationFn: () => api.patch(endpoint + '/counts', { [field]: parsed }),
    onSuccess: async () => { await onSuccess(); onClose(); },
  });
  const title = field === 'openingAmount' ? 'Открытие смены' : 'Фактический баланс';
  const disabled = parsed == null || parsed < 0 || save.isPending;
  return <Modal open title={title} onClose={() => { if (!save.isPending) onClose(); }}
    footer={<button form={formId} type="submit" className="btn-primary btn-md" disabled={disabled}>Сохранить</button>}>
    <form id={formId} onSubmit={(event) => { event.preventDefault(); if (!disabled) save.mutate(); }}>
      <label className="grid gap-2">Наличные в кассе
        <input autoFocus className="input" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      {save.error && <p role="alert" className="mt-2 text-danger">{apiError(save.error)}</p>}
    </form>
  </Modal>;
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
      {current && <p>Книжный баланс <strong>{financeMoney(current.expectedAmount)}</strong></p>}
      <label className="grid gap-1.5">{current ? 'Наличные, оставленные в кассе' : 'Остаток в кассе'}
        <input className="input w-full" value={amount} onChange={(event) => setAmount(event.target.value)}
          autoFocus inputMode="decimal" placeholder="0,00" disabled={mutation.isPending} maxLength={17} />
      </label>
      {difference != null && difference !== 0 && <p className="text-text-secondary">Расхождение {financeMoney(difference)} отразится в транзакциях.</p>}
      {error && <><p role="alert" className="text-danger">{error}</p><p className="text-text-secondary">Если сумма по учёту изменилась, закройте окно и сверьте остаток ещё раз.</p></>}
    </form>
  </Modal>;
}
