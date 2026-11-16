import { Select } from '@/components/Select';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { QueryState } from '../warehouse/WarehouseUi';
import { usePageFilter, type EditorRoute } from '../warehouse/workspace-route';
import type { PayrollStaffRow, usePayroll } from './api';
import { FinanceTable } from './CashShiftsPage';
import { financeDateTime, financeMoney } from './finance-format';
import { FinanceRegister } from './FinanceRegister';
import { FinancePeriod } from './FinancePeriod';

const columns = [
  { key: 'employee', label: 'Сотрудник', width: '24%' },
  { key: 'position', label: 'Должность', width: '28%' },
  { key: 'hours', label: 'Часы', numeric: true },
  { key: 'shifts', label: 'Смены', numeric: true },
  { key: 'total', label: 'Итого', numeric: true, money: true },
  { key: 'hourlyPay', label: 'За часы', numeric: true, money: true },
  { key: 'shiftPay', label: 'За смены', numeric: true, money: true },
  { key: 'monthlyPay', label: 'По месячной ставке', numeric: true, money: true },
  { key: 'personalCommission', label: '% от личных продаж', numeric: true, money: true },
  { key: 'shiftCommission', label: '% от продаж за смену', numeric: true, money: true },
  { key: 'accrued', label: 'Начислено', numeric: true, money: true },
  { key: 'paid', label: 'Выплачено', numeric: true, money: true },
  { key: 'due', label: 'К выплате', numeric: true, money: true },
] as const;
type Column = typeof columns[number];
const defaultColumns = ['employee', 'position', 'hours', 'shifts', 'total'];
const numericFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function reportValue(row: PayrollStaffRow, key: Column['key']) {
  if (key === 'employee') return row.name;
  if (key === 'total') return row.estimate;
  return row[key];
}

function renderCell(value: string | number | null, column: Column) {
  if (typeof value !== 'number') return { value, display: value || '—' };
  return { value, display: 'money' in column ? financeMoney(value) : numericFormat.format(value) };
}

export function PayrollRegister({ report, from, to, changePeriod, search, changeSearch, position, changePosition,
  historyId, changeHistory, canAccrue, canPay, openEditor }: {
  report: ReturnType<typeof usePayroll>; from: string; to: string; changePeriod: (next: { from: string; to: string }) => void;
  search: string; changeSearch: (search: string) => void; position: string; changePosition: (position: string) => void;
  historyId: string | null; changeHistory: (id: string | null) => void; canAccrue: boolean; canPay: boolean;
  openEditor: (next: EditorRoute) => void;
}) {
  const [payrollFilter, setPayrollFilter] = usePageFilter('payrollFilter');
  const [positionSort, setPositionSort] = usePageFilter('payrollSort', 'asc');
  const staff = report.data?.staff ?? [];
  const term = search.trim().toLocaleLowerCase('ru');
  const sortedPositions = [...new Set(staff.map((row) => row.position).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const rows = staff.filter((row) => row.name.toLocaleLowerCase('ru').includes(term)
    && (!position || row.position === position)
    && (payrollFilter !== 'due' || row.due > 0)
    && (payrollFilter !== 'calculated' || row.estimate > 0))
    .sort((a, b) => (positionSort === 'desc' ? -1 : 1) * a.position.localeCompare(b.position, 'ru')
      || a.name.localeCompare(b.name, 'ru'));
  const history = rows.find(({ userId }) => userId === historyId);
  const entries = history ? report.data?.records.filter(({ userId }) => userId === history.userId) ?? [] : [];
  const totals = Object.fromEntries(columns.map((column) => {
    if (column.key === 'employee') return [column.key, { value: 'Итого' }];
    if (!('numeric' in column)) return [column.key, { value: null }];
    const sum = rows.reduce((subtotal, row) => subtotal + Number(reportValue(row, column.key) ?? 0), 0);
    return [column.key, renderCell(Number(sum.toFixed(2)), column)];
  }));
  const registerRows = rows.map((row) => ({
    id: row.userId,
    values: Object.fromEntries(columns.map((column) => [
      column.key,
      column.key === 'employee' ? {
        value: row.name,
        display: <button type="button" className="text-left text-primary" aria-expanded={history?.userId === row.userId}
          onClick={() => changeHistory(history?.userId === row.userId ? null : row.userId)}>{row.name}</button>,
      } : renderCell(reportValue(row, column.key), column),
    ])),
  }));
  return <>
    <WorkspaceHeaderCount count={report.isSuccess ? rows.length : undefined} />
    <QueryState pending={report.isPending} error={report.error}>
      <FinanceRegister title={`Зарплата · ${from} — ${to}`} columns={columns.map((column) => column.key === 'position'
        ? { ...column, sort: { ascending: positionSort !== 'desc', toggle: () => setPositionSort(positionSort === 'desc' ? 'asc' : 'desc') } }
        : column)} rows={registerRows} totals={totals}
        defaultColumns={defaultColumns} empty="Сотрудники не найдены"
        filters={<>
          <WorkspaceSearch label="Быстрый поиск" value={search} onChange={changeSearch} />
          <div className="poster-toolbar !p-0">
            <Select ariaLabel="Должность" value={position} onChange={changePosition}
              options={[{ value: '', label: 'Должность' }, ...sortedPositions.map((name) => ({ label: name, value: name }))]} />
            <Select ariaLabel="Фильтр зарплаты" value={payrollFilter} onChange={setPayrollFilter}
              options={[{ value: '', label: '+ Фильтр' }, { value: 'calculated', label: 'Есть расчёт по ставкам' },
                { value: 'due', label: 'Есть к выплате' }]} />
          </div>
        </>}
        tools={<>
          <FinancePeriod from={from} to={to} onApply={changePeriod} />
          {canAccrue && <Select ariaLabel="Начислить зарплату" placeholder="Начислить зарплату" value=""
            options={[{ value: 'calculated', label: 'По расчёту' }, { value: 'manual', label: 'Вручную' }]}
            onChange={(action) => openEditor({ type: 'financeAccrual', action })} />}
        </>} />
    </QueryState>
    {report.isError && <button type="button" className="btn-secondary btn-md" onClick={() => void report.refetch()}>Повторить</button>}
    {history && <section className="mt-5 border-t border-border bg-card" aria-label={'Начисления: ' + history.name}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
        <div>
          <h2 className="font-semibold">{history.name}</h2>
          <p className="mt-1 text-sm text-text-muted">{history.position || 'Расчёт зарплаты'}</p>
        </div>
        {canAccrue && history.estimate > 0 && <button type="button" className="btn-secondary btn-md"
          onClick={() => openEditor({ type: 'financeAccrual', id: history.userId, action: 'calculated' })}>Начислить по расчёту</button>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border px-3 py-3 text-sm sm:grid-cols-4">
        {[
          ['За часы', history.hourlyPay], ['За смены', history.shiftPay], ['По месячной ставке', history.monthlyPay],
          ['От личных продаж', history.personalCommission], ['От продаж за смену', history.shiftCommission],
          ['По ставкам', history.estimate], ['Выплачено', history.paid], ['К выплате', history.due],
        ].map(([label, amount]) => <div key={label}>
          <dt className="text-text-muted">{label}</dt><dd className="tabular-nums">{financeMoney(Number(amount))}</dd>
        </div>)}
      </dl>
      <h3 className="px-3 pt-3 text-sm font-semibold">Начисления за выбранные расчётные месяцы</h3>
      <FinanceTable headers={['Месяц', 'Дата', 'Вид начисления', 'Начислено', 'Выплачено', 'К выплате', 'Комментарий', '']} amounts={[3, 4, 5]}
        rows={entries.map((entry) => ({ key: entry.id, cells: [
          entry.month.split('-').reverse().join('.'), financeDateTime(entry.createdAt), entry.calculation ? 'По ставкам должности' : 'Вручную',
          financeMoney(entry.amount), financeMoney(entry.paidAmount), financeMoney(entry.amount - entry.paidAmount), entry.note || '—',
          canPay && entry.amount > entry.paidAmount && <button type="button" className="text-primary"
            onClick={() => openEditor({ type: 'financePayout', id: entry.id })}>Выплатить</button>,
        ] }))} empty="В выбранных месяцах нет начислений" />
    </section>}
  </>;
}
