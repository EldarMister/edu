import { useId, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CashShiftForm, useCashShiftAccess } from '@/features/settings/CashShiftControls';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { IconPrinter } from '../../components/icons';
import { QueryState } from '../warehouse/WarehouseUi';
import { EditorPage } from '../warehouse/EditorPage';
import { useEditorRoute, usePageFilters } from '../warehouse/workspace-route';
import { cashShiftKey, financeKey, type CashShift, type EntryKind, useCashShifts } from './api';
import { financeDateTime, financeDay, financeMoney, parseMoney } from './finance-format';
import { FinancePeriod } from './FinancePeriod';
import { printRegister } from './FinanceRegister';
import { CashOperationDialog, type CashOperation } from './CashOperationDialog';
import './cash-shifts.css';

export function FinanceTable({ headers, rows, empty = 'Нет записей', amounts = [], totals }: {
  headers: string[];
  rows: { key: string; cells: ReactNode[]; deleted?: boolean; className?: string; onClick?: () => void }[];
  empty?: ReactNode;
  amounts?: number[];
  totals?: ReactNode[];
}) {
  return <div className="relative min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label="Таблица отчёта">
    <table className="poster-register-table w-full min-w-max text-left">
      <thead><tr>{headers.map((label, index) => <th key={index} scope="col" className={amounts.includes(index) ? 'text-right' : undefined}>
        {label || <span className="sr-only">Действия</span>}
      </th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(({ key, cells, deleted, className, onClick }) => <tr key={key} className={className} onClick={onClick}>
        {cells.map((cell, index) => <td key={index} className={amounts.includes(index) ? 'text-right tabular-nums' : undefined}>
          {deleted && index < cells.length - 1 ? <s className="text-text-muted">{cell}</s> : cell}
        </td>)}
      </tr>) : empty != null && <tr><td colSpan={headers.length} className="py-10 text-center text-text-muted">{empty}</td></tr>}</tbody>
      {totals && <tfoot className="border-t border-border bg-background font-semibold"><tr>
        {totals.map((cell, index) => <td key={index} className={'px-4 py-3 ' + (amounts.includes(index) ? 'text-right tabular-nums' : '')}>{cell}</td>)}
      </tr></tfoot>}
    </table>
  </div>;
}

const journalTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek',
});

function ShiftJournalTime({ time }: { time: string }) {
  return <time dateTime={time} title={financeDateTime(time)}>{journalTime.format(new Date(time))}</time>;
}

function signedCashAmount(amount: number | null) {
  return (amount != null && amount > 0 ? '+' : '') + financeMoney(amount);
}

function OpeningCount({ shift }: { shift: CashShift }) {
  return <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
    <span>{financeMoney(shift.openingAmount)}</span>
    {shift.openingDifference !== 0 && <span className="rounded-md bg-danger/10 px-1.5 font-medium text-danger"
      title={`Книжный остаток при открытии ${financeMoney(shift.openingExpectedAmount)}`}>
      <span className="sr-only">Разница при открытии </span>{signedCashAmount(shift.openingDifference)}
    </span>}
  </div>;
}

export function CashShiftsPage() {
  const isOwner = useAuth((state) => state.user?.role === 'OWNER');
  const { canManage } = useCashShiftAccess();
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
        {shift ? <CashShiftDetails shift={shift} canManage={canManage} /> : <p>Смена не найдена в выбранном периоде.</p>}
      </QueryState>
    </EditorPage>;
  }
  const period = <FinancePeriod from={from} to={to} onApply={setPeriod} />;
  if (!rangeValid) return <><div className="poster-toolbar">{period}</div>
    <p role="alert" className="text-danger">Укажите начало и конец периода.</p></>;
  return <QueryState pending={shifts.isPending} error={shifts.error}>
    {shifts.data && <>
      <section className="finance-register cash-shift-history min-w-0">
        <div className="finance-register-toolbar print:hidden">
          {canManage && !current && shifts.data.enabled && <button type="button" className="btn-secondary btn-md"
            onClick={() => setEditing('open')}>Открыть смену</button>}
          <div className="finance-register-tools">
            <button type="button" className="btn-secondary btn-md inline-flex items-center gap-2" disabled={!rows.length}
              onClick={() => setPrintBlocked(!printRegister('Кассовые смены', [
                [...columns.slice(0, 4), 'Книжный остаток при открытии', 'Разница при открытии', ...columns.slice(4)], ...rows.map((shift) => [
                String(shift.number), financeDateTime(shift.openedAt), shift.closedAt ? financeDateTime(shift.closedAt) : 'Не закрыта',
                shift.openingAmount, shift.openingExpectedAmount, shift.openingDifference, shift.collectionAmount, shift.actualAmount, shift.difference,
              ])]))}><IconPrinter className="h-4 w-4" aria-hidden="true" />Распечатать</button>
            {period}
          </div>
        </div>
        {current && <div className="cash-shift-history-notice print:hidden">
          <div>
            <p className="font-semibold">Кассовая смена открыта</p>
            <p className="mt-1 text-sm text-text-secondary">В конце работы пересчитайте наличные и закройте смену.</p>
          </div>
          {canManage && <button type="button" className="btn-secondary btn-md" onClick={() => setEditing('close')}>Закрыть смену</button>}
        </div>}
        {!current && !shifts.data.enabled && <div className="cash-shift-history-notice print:hidden">
          <p className="text-sm text-text-secondary">Кассовые смены выключены. Продажи доступны без открытия смены.</p>
          {isOwner && <Link className="text-sm text-primary hover:underline" to="?section=settings#cash-shift-settings">Включить в настройках</Link>}
        </div>}
        {printBlocked && <p role="alert" className="text-danger">Разрешите всплывающие окна и повторите печать.</p>}
        <FinanceTable headers={columns} amounts={[0, 3, 4, 5, 6]}
          rows={rows.map((shift) => {
            const difference = shift.difference ?? 0;
            const status = !shift.closedAt || difference > 0 ? 'warning' : difference < 0 ? 'short' : '';
            return { key: shift.id, className: 'cash-shift-history-row ' + (status ? 'cash-shift-history-row--' + status : ''),
              onClick: () => openEditor({ type: 'cashShiftHistory', id: shift.id }), cells: [
                shift.number,
                <button type="button" className="text-left hover:underline" aria-label={'Открыть кассовую смену №' + shift.number}>
                  <ShiftJournalTime time={shift.openedAt} />
                </button>,
                shift.closedAt ? <ShiftJournalTime time={shift.closedAt} /> : <span className="font-medium">Не закрыта</span>,
                <OpeningCount shift={shift} />,
                financeMoney(shift.collectionAmount),
                financeMoney(shift.actualAmount),
                <span className={difference < 0 ? 'font-semibold text-danger' : difference > 0 ? 'font-semibold' : undefined}>
                  {signedCashAmount(shift.difference)}
                </span>,
              ] };
          })} empty="За этот период кассовых смен нет" />
      </section>
      {canManage && editing && (editing === 'open' || current) && <CashShiftForm current={editing === 'close' ? current! : null}
        onClose={() => setEditing(null)} endpoint="/admin/cash-shifts" />}
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
  deletedAt?: string;
  deletedByName?: string | null;
  reconciliation: 'open' | 'close' | null;
};

type CashShiftDetail = {
  movements: ShiftEntry[];
  summary: {
    openingAmount: number;
    openingExpectedAmount: number;
    openingDifference: number;
    cashSales: number;
    cashRefunds: number;
    noncashSales: number;
    noncashRefunds: number;
    deposits: number;
    expenses: number;
    collections: number;
    otherTransfers: number;
    adjustments: number;
    expectedAmount: number;
    actualAmount: number | null;
    difference: number | null;
  };
};

function CashShiftDetails({ shift, canManage }: { shift: CashShift; canManage: boolean }) {
  const [editCount, setEditCount] = useState<'openingAmount' | 'actualAmount' | null>(null);
  const [operation, setOperation] = useState<'create' | CashOperation | null>(null);
  const [deleteOperation, setDeleteOperation] = useState<ShiftEntry | null>(null);
  const cache = useQueryClient();
  const endpoint = '/admin/cash-shifts/' + shift.id;
  const entries = useQuery({
    queryKey: [...cashShiftKey, 'details', shift.id],
    queryFn: async () => (await api.get<CashShiftDetail>(endpoint + '/details')).data,
  });
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: cashShiftKey }), cache.invalidateQueries({ queryKey: financeKey })]);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(endpoint + '/operations/' + id),
    onSuccess: async () => { await refresh(); setDeleteOperation(null); },
  });
  const revenue = (entry: ShiftEntry) => entry.kind === 'sale' || entry.kind === 'refund';
  const summary = entries.data?.summary;
  const metrics = summary ? [
    { label: 'Книжный остаток при открытии', amount: summary.openingExpectedAmount },
    { label: 'Открытие смены', amount: summary.openingAmount, key: 'openingAmount' as const },
    { label: 'Разница при открытии', amount: summary.openingDifference, difference: true },
    { label: 'Продажи наличными', amount: summary.cashSales },
    { label: 'Возвраты наличными', amount: summary.cashRefunds },
    { label: 'Безналичные продажи', amount: summary.noncashSales },
    { label: 'Безналичные возвраты', amount: summary.noncashRefunds },
    { label: 'Внесения', amount: summary.deposits },
    { label: 'Расходы', amount: summary.expenses },
    { label: 'Инкассация', amount: summary.collections },
    ...(summary.otherTransfers ? [{ label: 'Другие переводы', amount: summary.otherTransfers }] : []),
    ...(summary.adjustments ? [{ label: 'Корректировки', amount: summary.adjustments }] : []),
    { label: 'Книжный баланс', amount: summary.expectedAmount },
    { label: 'Фактический баланс', amount: summary.actualAmount, key: 'actualAmount' as const },
    { label: 'Разница при закрытии', amount: summary.difference, difference: true },
  ] : [];
  return <div className="finance-register space-y-5">
    <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-border px-4 py-3 text-sm text-text-muted">
      <span>Открыта <ShiftTime time={shift.openedAt} name={shift.openedByName} /></span>
      {shift.closedAt && <span>Закрыта <ShiftTime time={shift.closedAt} name={shift.closedByName} /></span>}
      {shift.closingComment && <p className="w-full whitespace-pre-wrap break-words">Комментарий при закрытии: <span className="text-text-primary">{shift.closingComment}</span></p>}
    </div>
    <QueryState pending={entries.isPending} error={entries.error}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(210px,285px)_minmax(0,1fr)]">
        <dl className="divide-y divide-border px-4 text-sm">
          {metrics.map(({ label, amount, key, difference }) => <div key={label} className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="flex flex-wrap justify-end gap-2 text-right tabular-nums">
              <span className={'whitespace-nowrap' + (difference && amount ? ' text-danger' : '')}>
                {difference ? signedCashAmount(amount) : financeMoney(amount)}
              </span>
              {canManage && key && amount != null && <button type="button" className="text-primary hover:underline"
                aria-label={'Изменить ' + label.toLowerCase()} onClick={() => setEditCount(key)}>Ред.</button>}
            </dd>
          </div>)}
        </dl>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 px-4 pb-2">
            <h2 className="font-semibold">Транзакции смены</h2>
            {canManage && <button type="button" className="text-sm text-primary hover:underline" onClick={() => setOperation('create')}>+ Добавить транзакцию</button>}
          </div>
          <FinanceTable headers={['Дата и время', 'Тип', 'Категория', 'Сотрудник', 'Комментарий', 'Сумма', '']} amounts={[5]}
        rows={(entries.data?.movements ?? []).map((entry) => ({ key: entry.id, deleted: !!entry.deletedAt, cells: [
          financeDateTime(entry.occurredAt), entry.reconciliation === 'open' ? 'Сверка при открытии'
            : entry.reconciliation === 'close' ? 'Сверка при закрытии'
              : entry.collection ? 'Инкассация'
                : revenue(entry) ? shiftEntryLabel[entry.kind] + (entry.cash ? ' наличными' : ' безналично') : shiftEntryLabel[entry.kind],
          entry.category ?? (entry.editable ? 'Кассовые смены' : '—'), entry.actorName ?? '—', entry.note ?? '—',
          <span className={entry.deletedAt ? undefined : entry.kind === 'income' ? 'text-success' : entry.kind === 'expense' ? 'text-danger' : undefined}>
            {financeMoney(entry.amount)}
          </span>,
          entry.deletedAt ? <div className="text-xs text-text-muted">
            <p>{entry.deletedByName ? 'Удалена · ' + entry.deletedByName : 'Удалена'}</p>
            <time dateTime={entry.deletedAt}>{financeDateTime(entry.deletedAt)}</time>
          </div> : canManage && entry.editable && <div className="flex gap-3">
            <button type="button" className="text-primary hover:underline"
              onClick={() => setOperation({ ...entry, kind: entry.kind === 'transfer' ? 'collection' : entry.kind as 'income' | 'expense' })}>Ред.</button>
            <button type="button" className="text-text-muted hover:text-danger" aria-label="Удалить транзакцию"
              onClick={() => { remove.reset(); setDeleteOperation(entry); }}>×</button>
          </div>,
        ] }))} empty="По этой смене нет операций" />
        </div>
      </div>
    </QueryState>
    {canManage && operation && <CashOperationDialog shiftId={shift.id} operation={operation === 'create' ? undefined : operation}
      onClose={() => setOperation(null)} />}
    {canManage && editCount && summary && <CountDialog endpoint={endpoint} field={editCount} amount={summary[editCount] ?? 0}
      onClose={() => setEditCount(null)} onSuccess={refresh} />}
    {canManage && deleteOperation && <Modal open title="Удалить транзакцию?" onClose={() => { if (!remove.isPending) setDeleteOperation(null); }}
      footer={<div className="flex gap-2">
        <button type="button" className="btn-danger btn-md" disabled={remove.isPending} onClick={() => remove.mutate(deleteOperation.id)}>Удалить</button>
        <button type="button" className="btn-secondary btn-md" disabled={remove.isPending} onClick={() => setDeleteOperation(null)}>Отмена</button>
      </div>}>
      <p>Операция на {financeMoney(Math.abs(deleteOperation.amount))} останется в истории смены с отметкой об удалении. Книжный баланс пересчитается.</p>
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
  const submitted = useRef(false);
  const formId = useId();
  const parsed = parseMoney(value);
  const dirty = value !== String(amount);
  const { markSaved } = useEditorDirty(dirty);
  const save = useMutation({
    mutationFn: () => api.patch(endpoint + '/counts', { [field]: parsed }),
    onSuccess: async () => { await onSuccess(); markSaved(); onClose(); },
    onSettled: () => { submitted.current = false; },
  });
  const title = field === 'openingAmount' ? 'Открытие смены' : 'Фактический баланс';
  const disabled = parsed == null || parsed < 0 || save.isPending;
  const close = () => {
    if (!submitted.current && (!dirty || window.confirm('Закрыть форму без сохранения?'))) onClose();
  };
  return <Modal open manageFocus title={title} onClose={close}
    footer={<div className="flex gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={close} disabled={save.isPending}>Отмена</button>
      <button form={formId} type="submit" className="btn-primary btn-md" disabled={disabled}>Сохранить</button>
    </div>}>
    <form id={formId} onSubmit={(event) => {
      event.preventDefault();
      if (disabled || submitted.current) return;
      submitted.current = true;
      save.mutate();
    }}>
      <label className="grid gap-2">Наличные в кассе
        <input data-dialog-initial-focus className="input" inputMode="decimal" disabled={save.isPending}
          value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      {save.error && <p role="alert" className="mt-2 text-danger">{apiError(save.error)}</p>}
    </form>
  </Modal>;
}

function ShiftTime({ time, name }: { time?: string | null; name?: string | null }) {
  return <>{financeDateTime(time)}{name && <p className="text-sm text-text-muted">{name}</p>}</>;
}
