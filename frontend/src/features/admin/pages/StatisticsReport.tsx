import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { useT } from '@/lib/i18n';
import { exportCsv, printReport } from '@/lib/report-output';
import type { StatisticsReports } from '../api';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';
import { STATISTICS_NAV, type StatisticsView } from './statisticsViews';

type Report = Exclude<StatisticsView, 'overview' | 'taxes'>;
type Row = Record<string, string | number | null>;
type Column = { key: string; label: string; format?: 'money' | 'date' | 'duration' | 'percent' };
const cash = (key: string, label: string): Column => ({ key, label, format: 'money' });
const date = { key: 'date', label: 'Дата', format: 'date' } as const;
const orders = { key: 'orders', label: 'Чеки' };
const quantity = { key: 'quantity', label: 'Кол-во' };
const revenue = cash('revenue', 'Выручка');
const profit = cash('profit', 'Прибыль');
const cost = cash('cost', 'Себестоимость');
const foodCost = { key: 'foodCost', label: 'Фудкост', format: 'percent' } as const;
const avgCheck = cash('avgCheck', 'Средний чек');
const methods = [cash('cash', 'Наличные'), cash('card', 'Карта'), cash('qr', 'QR-код'), cash('other', 'Другие оплаты')];

const columns: Record<Report, Column[]> = {
  sales: [date, orders, cash('paidAmount', 'Продажи до возвратов'), cash('refundedAmount', 'Возвраты'), revenue, avgCheck, cash('discount', 'Скидка')],
  products: [{ key: 'category', label: 'Категория' }, { key: 'name', label: 'Товар' }, { key: 'waiter', label: 'Официант' },
    quantity, cash('gross', 'Валовый оборот'), cash('discount', 'Скидка'), revenue, cost, profit, foodCost],
  staff: [{ key: 'name', label: 'Официант' }, revenue, profit, orders, avgCheck,
    { key: 'avgSeconds', label: 'Среднее время', format: 'duration' }],
  categories: [{ key: 'name', label: 'Категория' }, quantity, cost, revenue, cash('tax', 'Сумма налога'), profit,
    foodCost],
  payments: [date, orders, ...methods, cash('total', 'Всего')],
};
const firstColumn = { sales: 'date', products: 'name', staff: 'name', categories: 'name', payments: 'date' };
const defaultSort = { sales: 'date', products: 'quantity', staff: 'name', categories: 'revenue', payments: 'date' };
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const currency = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function formatValue(value: Row[string], format?: Column['format']) {
  if (value == null) return '—';
  if (typeof value === 'string') return format === 'date' ? shortDate.format(new Date(value + 'T00:00:00Z')) : value;
  if (format === 'money') return currency.format(value) + ' с';
  if (format === 'percent') return number.format(value) + '%';
  if (format === 'duration') return number.format(Math.round(value)) + ' сек.';
  return number.format(value);
}

function sum(rows: Row[], key: string) {
  return rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0);
}

function totalFor(rows: Row[], column: Column) {
  const { key, format } = column;
  if (format === 'date' || format === 'duration' || ['name', 'category', 'waiter'].includes(key)) return null;
  if (key === 'avgCheck') return sum(rows, 'orders') ? sum(rows, 'revenue') / sum(rows, 'orders') : null;
  if (key === 'foodCost') return rows.some((row) => row.cost == null) || sum(rows, 'revenue') <= 0
    ? null : 100 * sum(rows, 'cost') / sum(rows, 'revenue');
  return rows.some((row) => row[key] == null) ? null : sum(rows, key);
}

function choices(rows: Row[], key: string, label: string, all: string) {
  const values = new Map<string, string>();
  for (const row of rows) values.set(String(row[key]), String(row[label]));
  return [{ value: '', label: all }, ...Array.from(values, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))];
}

export function StatisticsReport({ report, data, periodControl }: { report: Report; data: StatisticsReports; periodControl: ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const { canAction, canSection } = usePermissions();
  const seeCosts = canSection('warehouse') && canAction('warehouseCosts') && canAction('warehouseReports');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [employee, setEmployee] = useState('');
  const [payment, setPayment] = useState('');
  const [hiddenColumns, setHiddenColumns] = useColumnPreference(`statistics-${report}`);
  const hidden = hiddenColumns.split(',').filter(Boolean);
  const [sort, setSort] = useState({ key: defaultSort[report], ascending: report === 'staff' });
  const [printBlocked, setPrintBlocked] = useState(false);
  const title = t(STATISTICS_NAV.find(({ key }) => key === report)?.label ?? 'Статистика');
  const source: Row[] = report === 'categories' || report === 'products' ? data[report].map((row) => ({
    ...row, foodCost: row.cost != null && row.revenue > 0 ? 100 * row.cost / row.revenue : null,
  })) : data[report];
  const allColumns = columns[report].filter(({ key }) => {
    if (key === 'cost' || key === 'profit' || key === 'foodCost') return seeCosts;
    if (report !== 'payments') return true;
    if (payment) return key === 'date' || key === payment;
    return key !== 'other' || source.some((row) => row.other !== 0);
  });
  const visible = allColumns.filter(({ key }) => !hidden.includes(key));
  const effectiveSort = visible.some(({ key }) => key === sort.key) ? sort : { key: defaultSort[report], ascending: false };
  const text = search.trim().toLocaleLowerCase('ru');
  const rows = source.filter((row) => {
    if (category && row[report === 'categories' ? 'id' : 'categoryId'] !== category) return false;
    if (employee && row[report === 'staff' ? 'id' : 'waiterId'] !== employee) return false;
    if (payment && !row[payment]) return false;
    return !text || ['name', 'category', 'waiter'].some((key) => String(row[key] ?? '').toLocaleLowerCase('ru').includes(text));
  }).sort((a, b) => {
    const left = a[effectiveSort.key], right = b[effectiveSort.key];
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
    const difference = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'ru');
    return effectiveSort.ascending ? difference : -difference;
  });
  const totals = visible.map((column, index) => index === 0 ? t('Итого') : formatValue(totalFor(rows, column), column.format));
  const headings = visible.map(({ label }) => t(label));
  const outputRows = () => [...rows.map((row) => visible.map(({ key, format }) => formatValue(row[key], format))), totals];
  const rangeDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'Asia/Bishkek' });
  const caption = data.range.from
    ? rangeDate.format(new Date(data.range.from)) + ' — ' + rangeDate.format(new Date(Date.parse(data.range.to) - 1))
    : t('Всё время');
  const showSearch = report === 'products' || report === 'categories' || report === 'staff';
  const linkPaidChecks = report === 'sales' && canSection('orders');

  function renderCell(row: Row, { key, format }: Pick<Column, 'key' | 'format'>) {
    const value = formatValue(row[key], format);
    if (!linkPaidChecks || key !== 'date' || typeof row.date !== 'string') return value;
    const search = new URLSearchParams({ section: 'orders', ordersTab: 'paid', ordersDateField: 'closed',
      ordersPeriod: 'custom', ordersFrom: row.date, ordersTo: row.date });
    return <Link className="font-medium text-primary hover:underline" to={{ pathname, search: search.toString() }}
      aria-label={t('Закрытые чеки') + ' · ' + value}>{value}</Link>;
  }

  return <>
    <WorkspaceHeaderCount count={rows.length} />
    <WorkspaceHeaderActions>
      {report !== 'payments' && <details className="relative">
        <summary className="btn-secondary btn-md cursor-pointer list-none">{t('Столбцы')}</summary>
        <div className="absolute right-0 z-20 mt-1 grid min-w-44 gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
          {allColumns.map(({ key, label }) => <label key={key} className="flex items-center gap-2 whitespace-nowrap text-sm">
            <input type="checkbox" checked={!hidden.includes(key)} disabled={key === firstColumn[report]}
              onChange={(event) => setHiddenColumns((event.target.checked ? hidden.filter((entry) => entry !== key) : [...hidden, key]).join(','))} />
            {t(label)}
          </label>)}
        </div>
      </details>}
      {canAction('exportReports') && <button type="button" className="btn-secondary btn-md" disabled={!rows.length}
        onClick={() => exportCsv(title, headings, outputRows())}>{t('Экспорт CSV')}</button>}
      <button type="button" className="btn-secondary btn-md" disabled={!rows.length}
        onClick={() => setPrintBlocked(!printReport(title, caption, headings, outputRows()))}>{t('Печать')}</button>
      {periodControl}
    </WorkspaceHeaderActions>
    {printBlocked && <p role="alert" className="text-sm text-danger">{t('Разрешите всплывающие окна и повторите печать.')}</p>}
    <section className="card min-w-0 overflow-hidden">
      {(showSearch || report === 'payments') && <div className="flex flex-wrap items-center gap-2 px-4 py-4">
        {showSearch && <WorkspaceSearch className="[&_.input]:pl-8 [&_.input]:pr-8" value={search} onChange={setSearch}
          label={t('Быстрый поиск')} placeholder={t('Быстрый поиск')} />}
        {(report === 'products' || report === 'categories') && <Select className="h-10" ariaLabel={t('Категории')} value={category} onChange={setCategory}
          options={choices(source, report === 'products' ? 'categoryId' : 'id', report === 'products' ? 'category' : 'name', t('Все категории'))} />}
        {(report === 'products' || report === 'staff') && <Select className="h-10" ariaLabel={t('Официант')} value={employee} onChange={setEmployee}
          options={choices(source, report === 'products' ? 'waiterId' : 'id', report === 'products' ? 'waiter' : 'name', t('Все сотрудники'))} />}
        {report === 'payments' && <Select className="h-10" ariaLabel={t('Оплаты')} value={payment} onChange={setPayment}
          options={[{ value: '', label: t('Все оплаты') }, ...methods.filter(({ key }) => key !== 'other' || source.some((row) => row.other !== 0))
            .map(({ key, label }) => ({ value: key, label: t(label) }))]} />}
        {(search || category || employee || payment) && <button type="button" className="px-2 text-sm text-primary"
          onClick={() => { setSearch(''); setCategory(''); setEmployee(''); setPayment(''); }}>{t('Сбросить всё')}</button>}
      </div>}
      <div className="overflow-x-auto" role="region" aria-label={title} tabIndex={0}>
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="border-b border-border text-text-muted"><tr>
            {visible.map(({ key, label, format }) => <th key={key} scope="col" className={'px-4 py-3.5 font-medium ' +
              (format === 'money' || format === 'duration' || format === 'percent' || key === 'quantity' || key === 'orders' ? 'text-right' : 'text-left')}
              aria-sort={effectiveSort.key === key ? (effectiveSort.ascending ? 'ascending' : 'descending') : undefined}>
              <button type="button" className="hover:text-primary" onClick={() => setSort({ key, ascending: effectiveSort.key === key ? !effectiveSort.ascending : true })}>
                {t(label)}{effectiveSort.key === key ? (effectiveSort.ascending ? ' ↑' : ' ↓') : ''}
              </button>
            </th>)}
          </tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={String(row.date ?? row.id) + ':' + index} className="border-b border-border hover:bg-background">
              {visible.map(({ key, format }) => <td key={key} className={'px-4 py-4 text-text-primary ' +
                (typeof row[key] === 'number' || format && format !== 'date' ? 'text-right tabular-nums' : 'text-left')}>{renderCell(row, { key, format })}</td>)}
            </tr>)}
            {!rows.length && <tr><td colSpan={visible.length} className="p-8 text-center text-text-muted">{t('Нет данных за период')}</td></tr>}
          </tbody>
          {!!rows.length && <tfoot className="bg-background font-semibold text-text-primary"><tr>
            {totals.map((value, index) => <td key={visible[index].key} className={'px-4 py-4 ' + (index ? 'text-right tabular-nums' : 'text-left')}>
              {index && value === '—' && !['money', 'percent'].includes(visible[index].format ?? '') ? '' : value}
            </td>)}
          </tr></tfoot>}
        </table>
      </div>
    </section>
  </>;
}
