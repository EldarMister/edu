import { Select } from '@/components/Select';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { QueryState } from '../warehouse/WarehouseUi';
import { usePageFilter, type EditorRoute } from '../warehouse/workspace-route';
import type { FinanceAccount, usePayroll } from './api';
import { financeDay, financeMoney } from './finance-format';
import { FinanceRegister, type RegisterColumn } from './FinanceRegister';
import { PayrollEmployeeCard, payrollMonthLabel } from './PayrollEmployeeCard';

const columns = [
  { key: 'employee', label: 'Сотрудник', width: 160 },
  { key: 'position', label: 'Должность', width: 160 },
  { key: 'hours', label: 'Часы', width: 76, numeric: true },
  { key: 'shifts', label: 'Смены', width: 76, numeric: true },
  { key: 'estimate', label: 'Рассчитано', width: 112, numeric: true },
  { key: 'accrued', label: 'Начислено', width: 112, numeric: true },
  { key: 'paid', label: 'Выплачено', width: 112, numeric: true },
  { key: 'due', label: 'Остаток', width: 112, numeric: true },
] as const satisfies readonly RegisterColumn[];
const workingTime = ['hours', 'shifts'] as const;
const amounts = ['estimate', 'accrued', 'paid', 'due'] as const;
const workNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const workCell = (value: number | null) => ({ value, display: value == null ? '—' : workNumber.format(value) });

function adjacentMonth(month: string, offset: number) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function PayrollRegister({ report, month, changeMonth, search, changeSearch, position, changePosition,
  historyId, changeHistory, canAccrue, canPay, accounts, openEditor }: {
  report: ReturnType<typeof usePayroll>; month: string; changeMonth: (month: string) => void;
  search: string; changeSearch: (search: string) => void; position: string; changePosition: (position: string) => void;
  historyId: string | null; changeHistory: (id: string | null) => void; canAccrue: boolean; canPay: boolean;
  accounts: FinanceAccount[]; openEditor: (next: EditorRoute) => void;
}) {
  const [payrollFilter, setPayrollFilter] = usePageFilter('payrollFilter');
  const [sort, setSort] = usePageFilter('payrollSort', 'asc');
  const [requestedKey] = sort.split('-');
  const sortKey = requestedKey === 'hours' || requestedKey === 'shifts' ? requestedKey : 'position';
  const ascending = !sort.endsWith('desc');
  const sortedColumns = columns.map((column): RegisterColumn => {
    const key = column.key;
    if (key !== 'position' && key !== 'hours' && key !== 'shifts') return column;
    return {
      ...column,
      sort: {
        ascending: sortKey === key ? ascending : undefined,
        toggle: () => {
          const direction = sortKey === key && ascending ? 'desc' : 'asc';
          setSort(key === 'position' ? direction : key + '-' + direction);
        },
      },
    };
  });
  const staff = report.data?.staff ?? [];
  const selected = staff.find(({ userId }) => userId === historyId);
  const term = search.trim().toLocaleLowerCase('ru');
  const positions = [...new Set(staff.map((row) => row.position).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const rows = staff.filter((row) => row.name.toLocaleLowerCase('ru').includes(term)
    && (!position || row.position === position) && (payrollFilter !== 'due' || row.due > 0)
    && (payrollFilter !== 'calculated' || row.available > 0)).sort((a, b) => {
    const left = a[sortKey], right = b[sortKey];
    if ((left == null) !== (right == null)) return left == null ? 1 : -1;
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'ru');
    return (ascending ? result : -result) || a.name.localeCompare(b.name, 'ru');
  });
  const timeTotals = Object.fromEntries(workingTime.map((key) => {
    const known = rows.flatMap((row) => row[key] == null ? [] : [row[key]]);
    return [key, workCell(known.length ? known.reduce((total, value) => total + value, 0) : null)];
  }));
  if (selected) return <PayrollEmployeeCard key={selected.userId + month} employee={selected} month={month}
    entries={report.data?.records.filter(({ userId }) => userId === selected.userId) ?? []}
    accounts={accounts} canAccrue={canAccrue} canPay={canPay} onClose={() => changeHistory(null)} openEditor={openEditor} />;
  return <>
    <WorkspaceHeaderCount count={report.isSuccess ? rows.length : undefined} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-muted">{canAccrue ? 'Выберите сотрудника, проверьте расчёт за месяц и выплатите зарплату.' : 'Расчёт зарплаты за месяц. Откройте сотрудника для расшифровки.'}</p>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary btn-md" aria-label="Предыдущий месяц" onClick={() => changeMonth(adjacentMonth(month, -1))}>‹</button>
        <input type="month" aria-label="Расчётный месяц" className="input w-[180px]" value={month} max={financeDay().slice(0, 7)}
          onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) changeMonth(event.target.value); }} />
        <button type="button" className="btn-secondary btn-md" aria-label="Следующий месяц" disabled={month >= financeDay().slice(0, 7)}
          onClick={() => changeMonth(adjacentMonth(month, 1))}>›</button>
      </div>
    </div>
    <QueryState pending={report.isPending} error={report.error}>
      <FinanceRegister title={`Зарплата · ${payrollMonthLabel(month)}`} columns={sortedColumns}
        filters={<><WorkspaceSearch label="Поиск сотрудника" value={search} onChange={changeSearch} />
          <Select ariaLabel="Должность" value={position} onChange={changePosition}
            options={[{ value: '', label: 'Все должности' }, ...positions.map((name) => ({ label: name, value: name }))]} />
          <Select ariaLabel="Состояние расчёта" value={payrollFilter} onChange={setPayrollFilter}
            options={[{ value: '', label: 'Все сотрудники' }, { value: 'calculated', label: 'Нужно начислить' }, { value: 'due', label: 'Есть остаток к выплате' }]} />
        </>}
        rows={rows.map((row) => ({ id: row.userId, values: {
          employee: { value: row.name, display: <button type="button" className="text-left text-primary hover:underline"
            onClick={() => changeHistory(row.userId)}>{row.name}</button> },
          position: { value: row.position || '—' },
          hours: workCell(row.hours),
          shifts: workCell(row.shifts),
          ...Object.fromEntries(amounts.map((key) => [key, { value: row[key], display: financeMoney(row[key]) }])),
        }, action: <button type="button" className="text-primary" onClick={() => changeHistory(row.userId)}>Расчёт</button> }))}
        totals={{ employee: { value: 'Итого' }, ...timeTotals, ...Object.fromEntries(amounts.map((key) => {
          const value = rows.reduce((sum, row) => sum + row[key], 0);
          return [key, { value, display: financeMoney(value) }];
        })) }} empty="За этот месяц сотрудники не найдены" />
      <p className="mt-3 text-xs text-text-muted">Рассчитано — по ставкам и рабочим сменам. Начислено — подтверждённая зарплата с доплатами. Остаток — начислено минус выплачено за этот месяц.</p>
    </QueryState>
    {report.isError && <button type="button" className="btn-secondary btn-md" onClick={() => void report.refetch()}>Повторить</button>}
  </>;
}
