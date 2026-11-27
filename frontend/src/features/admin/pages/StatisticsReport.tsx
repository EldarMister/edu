import { IconExport, IconPrinter } from '@/features/admin/components/icons';
import { useState } from 'react';
import { ColumnSummary } from '../components/ColumnControl';
import { Link, useLocation } from 'react-router-dom';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { useT } from '@/lib/i18n';
import { exportCsv, printReport } from '@/lib/report-output';
import type { StatisticsReports } from '../api';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';
import { STATISTICS_LABELS, type StatisticsView } from './statisticsViews';
import { groupProductSales, productSalesMetrics } from './product-sales-report';

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
const markup = { key: 'markup', label: 'Наценка', format: 'percent' } as const;
const avgCheck = cash('avgCheck', 'Средний чек');
const methods = [cash('cash', 'Наличные'), cash('card', 'Карта'), cash('qr', 'QR-код'), cash('other', 'Другие оплаты')];

const columns: Record<Report, Column[]> = {
  sales: [date, orders, cash('paidAmount', 'Продажи до возвратов'), cash('refundedAmount', 'Возвраты'), revenue, avgCheck, cash('discount', 'Скидка')],
  products: [{ key: 'name', label: 'Товар' }, { key: 'category', label: 'Категория' }, { key: 'waiter', label: 'Официант' },
    quantity, cash('discount', 'Скидка'), revenue, cost, profit, foodCost,
    cash('averagePrice', 'Средняя цена продажи'), cash('averageCost', 'Средняя себестоимость'), markup],
  staff: [{ key: 'name', label: 'Официант' }, revenue, profit, orders, avgCheck,
    { key: 'avgSeconds', label: 'Среднее время', format: 'duration' }],
  categories: [{ key: 'name', label: 'Категория' }, quantity, cost, revenue, cash('tax', 'Сумма налога'), profit,
    foodCost],
  payments: [date, orders, ...methods, cash('total', 'Всего')],
};
const firstColumn = { sales: 'date', products: 'name', staff: 'name', categories: 'name', payments: 'date' };
const defaultSort = { sales: 'date', products: 'quantity', staff: 'name', categories: 'revenue', payments: 'date' };
const rateColumns = ['averagePrice', 'averageCost', 'foodCost', 'markup'] as const;
const optionalProductColumns = 'averagePrice,averageCost,markup';
const protectedColumns = new Set(['cost', 'profit', 'foodCost', 'averageCost', 'markup']);
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
  const rate = rateColumns.find((column) => column === key);
  if (rate) return productSalesMetrics({ quantity: sum(rows, 'quantity'), revenue: sum(rows, 'revenue'),
    cost: rows.some((row) => row.cost == null) ? null : sum(rows, 'cost'),
    profit: rows.some((row) => row.profit == null) ? null : sum(rows, 'profit'),
  })[rate];
  return rows.some((row) => row[key] == null) ? null : sum(rows, key);
}

function choices(rows: Row[], key: string, label: string, all: string) {
  const values = new Map<string, string>();
  for (const row of rows) values.set(String(row[key]), String(row[label]));
  return [{ value: '', label: all }, ...Array.from(values, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))];
}

export function StatisticsReport({ report, data }: { report: Report; data: StatisticsReports }) {
  const t = useT();
  const { pathname } = useLocation();
  const { canAction, canSection } = usePermissions();
  const seeCosts = canSection('warehouse') && canAction('warehouseCosts') && canAction('warehouseReports');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [employee, setEmployee] = useState('');
  const [payment, setPayment] = useState('');
  const [productBreakdown, setProductBreakdown] = useColumnPreference('statistics-products-breakdown');
  const grouping = productBreakdown.split(',').filter(Boolean);
  const showVariants = grouping.includes('variants');
  const showWaiters = grouping.includes('waiters');
  function setGrouping(key: 'variants' | 'waiters', checked: boolean) {
    setProductBreakdown((checked ? [...grouping, key] : grouping.filter((entry) => entry !== key)).join(','));
  }
  const [hiddenColumns, setHiddenColumns] = useColumnPreference(`statistics-${report}`, report === 'products' ? optionalProductColumns : '');
  const hidden = hiddenColumns.split(',').filter(Boolean);
  const [sort, setSort] = useState({ key: defaultSort[report], ascending: report === 'staff' });
  const [printBlocked, setPrintBlocked] = useState(false);
  const title = t(STATISTICS_LABELS[report]);
  const source: Row[] = report === 'categories' ? data.categories.map((row) => ({
    ...row, foodCost: row.cost != null && row.revenue > 0 ? 100 * row.cost / row.revenue : null,
  })) : data[report];
  const allColumns = columns[report].filter(({ key }) => {
    if (protectedColumns.has(key)) return seeCosts;
    if (report === 'products' && key === 'waiter') return showWaiters || !!employee;
    if (report !== 'payments') return true;
    if (payment) return key === 'date' || key === payment;
    return key !== 'other' || source.some((row) => row.other !== 0);
  });
  const visible = allColumns.filter(({ key }) => !hidden.includes(key));
  const effectiveSort = visible.some(({ key }) => key === sort.key) ? sort : { key: defaultSort[report], ascending: false };
  const text = search.trim().toLocaleLowerCase('ru');
  const matchesFilters = (row: Row) => {
    if (category && row[report === 'categories' ? 'id' : 'categoryId'] !== category) return false;
    if (employee && row[report === 'staff' ? 'id' : 'waiterId'] !== employee) return false;
    if (payment && !row[payment]) return false;
    return !text || ['name', 'category', 'waiter'].some((key) => String(row[key] ?? '').toLocaleLowerCase('ru').includes(text));
  };
  const filtered: Row[] = report === 'products' ? groupProductSales(data.products.filter(matchesFilters), showVariants, showWaiters)
    : source.filter(matchesFilters);
  const rows = filtered.sort((a, b) => {
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
  const linkPaidChecks = (report === 'sales' || report === 'payments') && canSection('orders');

  function renderCell(row: Row, { key, format }: Pick<Column, 'key' | 'format'>) {
    const value = formatValue(row[key], format);
    if (!linkPaidChecks || typeof row.date !== 'string') return value;
    if (key !== 'date' && (report !== 'payments' || !row[key])) return value;
    const methodKey = key === 'date' ? payment : key;
    const method = methods.find((entry) => entry.key === methodKey && entry.key !== 'other');
    if (methodKey && !method) return value;
    const search = new URLSearchParams({ section: 'orders', ordersTab: 'paid', ordersDateField: 'closed',
      ordersPeriod: 'custom', ordersFrom: row.date, ordersTo: row.date });
    if (method) search.set('ordersPaymentMethod', method.key);
    const label = [t('Закрытые чеки'), formatValue(row.date, 'date')];
    if (method) label.push(t(method.label));
    if (key !== 'date') label.push(value);
    return <Link className="font-medium text-primary hover:underline" to={{ pathname, search: search.toString() }}
      aria-label={label.join(' · ')}>{value}</Link>;
  }

  return <>
    <WorkspaceHeaderCount count={rows.length} />
    <WorkspaceHeaderActions>
      {report !== 'payments' && <details className="relative">
        <ColumnSummary label={t('Столбцы')} />
        <div className="absolute right-0 z-20 mt-1 grid min-w-44 gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
          {report === 'products' && <div className="grid gap-2 border-b border-border pb-2">
            <label className="flex items-center gap-2 whitespace-nowrap text-sm">
              <input type="checkbox" checked={showVariants} onChange={(event) => setGrouping('variants', event.target.checked)} />
              {t('Варианты отдельными строками')}
            </label>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm">
              <input type="checkbox" checked={showWaiters} onChange={(event) => setGrouping('waiters', event.target.checked)} />
              {t('Официанты отдельными строками')}
            </label>
          </div>}
          {allColumns.map(({ key, label }) => <label key={key} className="flex items-center gap-2 whitespace-nowrap text-sm">
            <input type="checkbox" checked={!hidden.includes(key)} disabled={key === firstColumn[report]}
              onChange={(event) => setHiddenColumns((event.target.checked ? hidden.filter((entry) => entry !== key) : [...hidden, key]).join(','))} />
            {t(label)}
          </label>)}
        </div>
      </details>}
      {canAction('exportReports') && <button type="button" className="workspace-tool" disabled={!rows.length}
        onClick={() => exportCsv(title, headings, outputRows())}><IconExport />{t('Экспорт CSV')}</button>}
      <button type="button" className="workspace-tool" disabled={!rows.length}
        onClick={() => setPrintBlocked(!printReport(title, caption, headings, outputRows()))}><IconPrinter />{t('Печать')}</button>
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
