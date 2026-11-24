import { Select } from '@/components/Select';
import type { ReactNode } from 'react';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { QueryState } from '../warehouse/WarehouseUi';
import { usePageFilter, type EditorRoute } from '../warehouse/workspace-route';
import type { FinanceAccount, PayrollStaffRow, usePayroll } from './api';
import { financeDay, financeMoney } from './finance-format';
import { FinanceRegister, type RegisterColumn } from './FinanceRegister';
import { PayrollEmployeeCard, payrollMonthLabel } from './PayrollEmployeeCard';

const columns = [
  { key: 'employee', label: 'Сотрудник', width: 160 },
  { key: 'position', label: 'Должность', width: 160 },
  { key: 'hours', label: 'Часы', width: 76, numeric: true },
  { key: 'shifts', label: 'Смены', width: 76, numeric: true },
  { key: 'days', label: 'Рабочие дни', width: 112, numeric: true },
  { key: 'hourlyPay', label: 'Оплата за часы', width: 130, numeric: true },
  { key: 'shiftPay', label: 'Оплата за смены', width: 136, numeric: true },
  { key: 'monthlyPay', label: 'По месячной ставке', width: 140, numeric: true },
  { key: 'personalSales', label: 'Личные продажи', width: 135, numeric: true },
  { key: 'shiftSales', label: 'Продажи за рабочие смены', width: 200, numeric: true },
  { key: 'personalCommission', label: 'Комиссия с личных продаж', width: 202, numeric: true },
  { key: 'shiftCommission', label: 'Комиссия с продаж за смены', width: 210, numeric: true },
  { key: 'estimate', label: 'Рассчитано', width: 112, numeric: true },
  { key: 'available', label: 'К начислению', width: 116, numeric: true },
  { key: 'accrued', label: 'Начислено', width: 112, numeric: true },
  { key: 'paid', label: 'Выплачено', width: 112, numeric: true },
  { key: 'due', label: 'Остаток', width: 112, numeric: true },
] as const satisfies readonly RegisterColumn[];
type PayrollColumn = typeof columns[number]['key'];
type PayrollValueColumn = Exclude<PayrollColumn, 'employee' | 'position'>;
const initialColumns: PayrollColumn[] = ['employee', 'position', 'hours', 'shifts', 'estimate', 'accrued', 'paid', 'due'];
const monthColumns = new Set<PayrollColumn>(['available', 'accrued', 'paid', 'due']);
const workingTime = new Set<PayrollValueColumn>(['hours', 'shifts', 'days']);
const calculationBreakdown = new Set<PayrollValueColumn>([
  'hourlyPay', 'shiftPay', 'monthlyPay', 'personalSales', 'shiftSales', 'personalCommission', 'shiftCommission',
]);
const workNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function payrollValue(row: PayrollStaffRow, key: PayrollValueColumn) {
  return calculationBreakdown.has(key) && !row.timeTrackingAvailable ? null : row[key];
}

function payrollCell(key: PayrollValueColumn, value: number | null) {
  return { value, display: workingTime.has(key) && value != null ? workNumber.format(value) : financeMoney(value) };
}

function adjacentMonth(month: string, offset: number) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function PayrollRegister({ report, month, changeMonth, search, changeSearch, position, changePosition,
  historyId, changeHistory, canAccrue, canPay, accounts, openEditor, range, periodPicker }: {
  report: ReturnType<typeof usePayroll>; month: string; changeMonth: (month: string) => void;
  search: string; changeSearch: (search: string) => void; position: string; changePosition: (position: string) => void;
  historyId: string | null; changeHistory: (id: string | null) => void; canAccrue: boolean; canPay: boolean;
  accounts: FinanceAccount[]; openEditor: (next: EditorRoute) => void;
  range?: { from: string; to: string }; periodPicker: ReactNode;
}) {
  const [payrollFilter, setPayrollFilter] = usePageFilter('payrollFilter');
  const [sort, setSort] = usePageFilter('payrollSort', 'name-asc');
  const [requestedKey] = sort.split('-');
  const requestedColumn = requestedKey === 'name' ? 'employee' :
    requestedKey === 'asc' || requestedKey === 'desc' ? 'position' : requestedKey;
  const availableColumns = columns.filter(({ key }) => !range || !monthColumns.has(key));
  const sortKey = availableColumns.find(({ key }) => key === requestedColumn)?.key ?? 'employee';
  const ascending = sortKey !== requestedColumn || !sort.endsWith('desc');
  const sortedColumns = availableColumns.map(({ key, ...column }): RegisterColumn => ({ ...column, key,
    sort: {
      ascending: sortKey === key ? ascending : undefined,
      toggle: () => {
        const direction = sortKey === key && ascending ? 'desc' : 'asc';
        setSort(key === 'position' ? direction : `${key === 'employee' ? 'name' : key}-${direction}`);
      },
    },
  }));
  const valueColumns = availableColumns.map(({ key }) => key).filter((key): key is PayrollValueColumn => key !== 'employee' && key !== 'position');
  const staff = report.data?.staff ?? [];
  const selected = staff.find(({ userId }) => userId === historyId);
  const term = search.trim().toLocaleLowerCase('ru');
  const positions = [...new Set(staff.map((row) => row.position).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const rows = staff.filter((row) => row.name.toLocaleLowerCase('ru').includes(term)
    && (!position || row.position === position) && (range || payrollFilter !== 'due' || row.due > 0)
    && (range || payrollFilter !== 'calculated' || row.available > 0)).sort((a, b) => {
    const left = sortKey === 'employee' ? a.name : sortKey === 'position' ? a.position : payrollValue(a, sortKey);
    const right = sortKey === 'employee' ? b.name : sortKey === 'position' ? b.position : payrollValue(b, sortKey);
    if ((left == null) !== (right == null)) return left == null ? 1 : -1;
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'ru');
    return (ascending ? result : -result) || a.name.localeCompare(b.name, 'ru');
  });
  const totals = Object.fromEntries(valueColumns.map((key) => {
    if (key === 'shiftSales') return [key, { value: null,
      display: <span title="Один чек может учитываться в сменах нескольких сотрудников">—</span> }];
    const known = rows.map((row) => payrollValue(row, key)).filter((value) => value != null);
    return [key, payrollCell(key, known.length ? known.reduce((sum, value) => sum + value, 0) : null)];
  }));
  if (selected) return <PayrollEmployeeCard key={selected.userId + month} employee={selected} month={month} range={range}
    entries={report.data?.records.filter(({ userId }) => userId === selected.userId) ?? []}
    accounts={accounts} canAccrue={canAccrue} canPay={canPay} onClose={() => changeHistory(null)} openEditor={openEditor} />;
  return <>
    <WorkspaceHeaderCount count={report.isSuccess ? rows.length : undefined} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-muted">{range ? 'Начисления и выплаты доступны в режиме «Расчётный месяц».'
        : canAccrue ? 'Выберите сотрудника, проверьте расчёт за месяц и выплатите зарплату.' : 'Откройте сотрудника для расшифровки.'}</p>
      <div className="flex flex-wrap items-center gap-2">
        {periodPicker}
        {range ? <button type="button" className="btn-secondary btn-md" onClick={() => changeMonth(month)}>Расчётный месяц</button> : <>
        <button type="button" className="btn-secondary btn-md" aria-label="Предыдущий месяц" onClick={() => changeMonth(adjacentMonth(month, -1))}>‹</button>
        <input type="month" aria-label="Расчётный месяц" className="input w-[180px]" value={month} max={financeDay().slice(0, 7)}
          onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) changeMonth(event.target.value); }} />
        <button type="button" className="btn-secondary btn-md" aria-label="Следующий месяц" disabled={month >= financeDay().slice(0, 7)}
          onClick={() => changeMonth(adjacentMonth(month, 1))}>›</button>
        </>}
      </div>
    </div>
    <QueryState pending={report.isPending} error={report.error}>
      <FinanceRegister title={`Зарплата · ${range ? [range.from, range.to].map((day) => day.split('-').reverse().join('.')).join(' — ') : payrollMonthLabel(month)}`}
        columns={sortedColumns} defaultColumns={initialColumns.filter((key) => !range || !monthColumns.has(key))}
        columnPreference={range ? 'payroll-period' : 'payroll-month'}
        filters={<><WorkspaceSearch label="Поиск сотрудника" value={search} onChange={changeSearch} />
          <Select ariaLabel="Должность" value={position} onChange={changePosition}
            options={[{ value: '', label: 'Все должности' }, ...positions.map((name) => ({ label: name, value: name }))]} />
          {!range && <Select ariaLabel="Состояние расчёта" value={payrollFilter} onChange={setPayrollFilter}
            options={[{ value: '', label: 'Все сотрудники' }, { value: 'calculated', label: 'Нужно начислить' }, { value: 'due', label: 'Есть остаток к выплате' }]} />}
        </>}
        rows={rows.map((row) => ({ id: row.userId, values: {
          employee: { value: row.name, display: <button type="button" className="text-left text-primary hover:underline"
            onClick={() => changeHistory(row.userId)}>{row.name}</button> },
          position: { value: row.position || '—' },
          ...Object.fromEntries(valueColumns.map((key) => [key, payrollCell(key, payrollValue(row, key))])),
        }, action: <button type="button" className="text-primary" onClick={() => changeHistory(row.userId)}>Расчёт</button> }))}
        totals={{ employee: { value: 'Итого' }, ...totals }} empty="За выбранный период сотрудники не найдены" />
    </QueryState>
    {report.isError && <button type="button" className="btn-secondary btn-md" onClick={() => void report.refetch()}>Повторить</button>}
  </>;
}
