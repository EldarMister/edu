import { useMemo, useState } from 'react';
import { Select } from '@/components/Select';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { WorkspacePending } from '../components/WorkspacePending';
import { IconTables } from '../components/icons';
import { WorkspaceSearch } from './WorkspaceSearch';
import { ReportPeriodFilter, type PeriodPreset } from './warehouse/ReportPeriodFilter';
import { calendarDate, warehouseDay, warehousePeriodRange } from './warehouse/warehouse-period';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './warehouse/WarehouseColumnSettings';
import { displayOrderNumber, money } from '@/lib/format';
import { useWaiterOrdersReport, type StaffMember, type WaiterOrdersReportItem } from '../api';

type DishTotal = { name: string; quantity: number; amount: number };
type CategoryTotal = { name: string; quantity: number; amount: number; dishes: DishTotal[] };

const EMPTY_REPORT_ROWS: WaiterOrdersReportItem[] = [];

const COLUMN_KEYS = ['dishName', 'orderNumber', 'orderedAt', 'servedAt', 'tableNumber', 'categoryName', 'quantity', 'unitPrice', 'amount'] as const;
type ColumnKey = typeof COLUMN_KEYS[number];
const defaultColumns = [...COLUMN_KEYS];
const columnLabels: Record<ColumnKey, string> = {
  dishName: 'Блюдо',
  orderNumber: '№ заказа',
  orderedAt: 'Время заказа',
  servedAt: 'Время подачи',
  tableNumber: 'Стол',
  categoryName: 'Категория',
  quantity: 'Кол-во',
  unitPrice: 'Цена',
  amount: 'Сумма',
};

const reportDateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const reportSort = new Intl.Collator('ru-RU', { numeric: true });

function columnValue(row: WaiterOrdersReportItem, key: ColumnKey) {
  if (key === 'orderedAt' || key === 'servedAt') return reportDateTime.format(new Date(row[key]));
  if (key === 'unitPrice' || key === 'amount') return money(row[key]);
  if (key === 'orderNumber') return displayOrderNumber(row[key]);
  return row[key];
}

function columnAlign(key: ColumnKey) {
  return key === 'quantity' || key === 'unitPrice' || key === 'amount' ? 'text-right tabular-nums' : 'text-left';
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} мин ${rest} сек` : `${rest} сек`;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function WaiterOrdersReport({ staff, staffLoading }: {
  staff: Pick<StaffMember, 'id' | 'name' | 'role'>[];
  staffLoading: boolean;
}) {
  const today = warehouseDay();
  const todayKey = calendarDate(today);
  const [period, setPeriod] = useState<PeriodPreset>('today');
  const [customRange, setCustomRange] = useState({ dateFrom: todayKey, dateTo: todayKey });
  const { dateFrom: from = todayKey, dateTo: to = todayKey } = warehousePeriodRange(
    period, today, customRange.dateFrom, customRange.dateTo,
  );
  const [view, setView] = useState<'orders' | 'dishes'>('orders');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: ColumnKey; descending: boolean }>({ key: 'orderedAt', descending: true });
  const [columnPreference, saveColumns] = useColumnPreference('waiter-orders-report');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columns = visibleWarehouseColumns(columnPreference, defaultColumns);
  const activeSort = columns.includes(sort.key) ? sort : { key: columns[0], descending: false };
  const waiterOptions = useMemo(
    () => staff
      .filter((member) => member.role === 'WAITER')
      .map((waiter) => ({ value: waiter.id, label: waiter.name })),
    [staff],
  );
  const [waiterId, setWaiterId] = useState('');
  const selectedWaiterId = waiterOptions.some((option) => option.value === waiterId)
    ? waiterId
    : waiterOptions[0]?.value ?? '';
  const report = useWaiterOrdersReport(selectedWaiterId, from, to);
  const data = report.data;
  const rows = data?.items ?? EMPTY_REPORT_ROWS;
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const displayedRows = rows.filter((row) => !query || [
    row.dishName, row.categoryName, displayOrderNumber(row.orderNumber), String(row.tableNumber),
  ].some((value) => value.toLocaleLowerCase('ru-RU').includes(query))).sort((left, right) => {
    const a = left[activeSort.key];
    const b = right[activeSort.key];
    const difference = typeof a === 'number' && typeof b === 'number' ? a - b : reportSort.compare(String(a), String(b));
    return activeSort.descending ? -difference : difference;
  });
  const rowQuantity = displayedRows.reduce((sum, row) => sum + row.quantity, 0);
  const rowAmount = displayedRows.reduce((sum, row) => sum + row.amount, 0);
  const categoryTotals = useMemo<CategoryTotal[]>(() => {
    const categories = new Map<string, {
      name: string;
      quantity: number;
      amount: number;
      dishes: Map<string, DishTotal>;
    }>();

    for (const row of rows) {
      let category = categories.get(row.categoryName);
      if (!category) {
        category = { name: row.categoryName, quantity: 0, amount: 0, dishes: new Map() };
        categories.set(row.categoryName, category);
      }
      category.quantity += row.quantity;
      category.amount += row.amount;

      const dish = category.dishes.get(row.dishName) ?? { name: row.dishName, quantity: 0, amount: 0 };
      dish.quantity += row.quantity;
      dish.amount += row.amount;
      category.dishes.set(row.dishName, dish);
    }

    return [...categories.values()]
      .map((category) => ({
        name: category.name,
        quantity: category.quantity,
        amount: category.amount,
        dishes: [...category.dishes.values()].sort((left, right) => right.quantity - left.quantity || right.amount - left.amount),
      }))
      .sort((left, right) => right.quantity - left.quantity || right.amount - left.amount);
  }, [rows]);

  function exportCsv() {
    if (!data || !displayedRows.length) return;
    const header = ['Время заказа', 'Время подачи', '№ заказа', 'Стол', 'Блюдо', 'Категория', 'Кол-во', 'Цена', 'Сумма'];
    const lines = displayedRows.map((item) => [
      reportDateTime.format(new Date(item.orderedAt)),
      reportDateTime.format(new Date(item.servedAt)),
      displayOrderNumber(item.orderNumber),
      item.tableNumber,
      item.dishName,
      item.categoryName,
      item.quantity,
      item.unitPrice,
      item.amount,
    ].map(csvCell).join(';'));
    const csv = '\ufeff' + [header.map(csvCell).join(';'), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `waiter-orders-${data.waiter.name}-${from}-${to}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="waiter-orders-report min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Отчёт официанта</h2>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Select
            ariaLabel="Официант" value={selectedWaiterId} onChange={setWaiterId} options={waiterOptions}
            searchable placeholder={staffLoading ? 'Загрузка…' : 'Выберите официанта'}
            disabled={staffLoading || waiterOptions.length === 0} className="min-h-10 w-40 max-w-full sm:w-44"
          />
          <div className="[&_.report-period-trigger]:min-h-10 [&_.report-period-trigger]:rounded-lg">
            <ReportPeriodFilter label="Период отчёта" confirmSelection includeAll={false}
              preset={period} today={today} range={{ dateFrom: from, dateTo: to }}
              onPreset={setPeriod} onRange={(dateFrom, dateTo) => {
                setCustomRange({ dateFrom, dateTo });
                setPeriod('custom');
              }} />
          </div>
        </div>
        {data && <p className="hidden print:block">{data.waiter.name} · {from} — {to}</p>}
      </div>

      {data && (
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-4">
          <SummaryItem label="Сумма по позициям" value={money(data.summary.amount)} />
          <SummaryItem label="Оплачено заказов" value={data.summary.ordersCount} />
          <SummaryItem label="Блюд" value={data.summary.dishesCount} />
          <SummaryItem label="Среднее время подачи" value={data.summary.ordersCount
            ? durationLabel(data.summary.averageServingSeconds) : '—'} />
        </dl>
      )}

      <div className="min-w-0 rounded-xl border border-border bg-card" aria-busy={report.isLoading || staffLoading}>
        <div className="no-print flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2">
          <div role="group" aria-label="Раздел отчёта" className="flex flex-wrap gap-1">
            <button type="button" aria-pressed={view === 'orders'} onClick={() => setView('orders')}
              className="btn-ghost btn-md aria-pressed:bg-primary/10 aria-pressed:text-primary">Позиции заказов</button>
            <button type="button" aria-pressed={view === 'dishes'} onClick={() => setView('dishes')}
              className="btn-ghost btn-md aria-pressed:bg-primary/10 aria-pressed:text-primary">По блюдам</button>
          </div>
          {view === 'orders' && <div className="flex min-w-0 flex-wrap items-center gap-2">
            <WorkspaceSearch value={search} onChange={setSearch} label="Поиск по заказам" placeholder="Блюдо или № заказа"
              className="max-sm:w-full [&_.input]:pl-8 [&_.input]:pr-8" />
            <button type="button" onClick={() => setColumnsOpen(true)} className="btn-secondary btn-md">
              <IconTables className="h-4 w-4" /> Столбцы
            </button>
            <button type="button" onClick={exportCsv} className="btn-secondary btn-md" disabled={!displayedRows.length}>
              Экспорт CSV
            </button>
          </div>}
        </div>

        {report.isLoading || staffLoading ? (
          <WorkspacePending />
        ) : !selectedWaiterId ? (
          <p className="px-4 py-12 text-center text-sm text-text-muted">Добавьте официанта, чтобы сформировать отчёт</p>
        ) : report.isError && !data ? (
          <div className="px-4 py-12 text-center">
            <p role="alert" className="text-sm text-danger">Не удалось загрузить отчёт</p>
            <button type="button" onClick={() => report.refetch()} className="no-print btn-secondary btn-md mt-3">Повторить</button>
          </div>
        ) : view === 'dishes' ? (
          <div className="px-3 py-2 sm:px-4">
            {!categoryTotals.length && <p className="px-4 py-12 text-center text-sm text-text-muted">За выбранный период оплаченных заказов нет</p>}
            {categoryTotals.map((category, index) => (
              <CategoryTotalRow key={category.name} category={category} defaultOpen={index === 0} />
            ))}
          </div>
        ) : !displayedRows.length ? (
          <p className="px-4 py-12 text-center text-sm text-text-muted">
            {rows.length ? 'По вашему запросу ничего не найдено' : 'За выбранный период оплаченных заказов нет'}
          </p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Позиции оплаченных заказов" tabIndex={0}>
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="border-b border-border text-text-muted">
                <tr>
                  {columns.map((key) => (
                    <th key={key} scope="col" className={`px-4 py-3 font-medium ${columnAlign(key)}`}
                      aria-sort={activeSort.key === key ? (activeSort.descending ? 'descending' : 'ascending') : undefined}>
                      <button type="button" className="hover:text-primary"
                        onClick={() => setSort({ key, descending: activeSort.key === key && !activeSort.descending })}>
                        {columnLabels[key]}{activeSort.key === key && <span aria-hidden="true">{activeSort.descending ? ' ↓' : ' ↑'}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row) => (
                  <tr key={row.id} className="border-b border-border hover:bg-background/60">
                    {columns.map((key) => <td key={key} className={`px-4 py-3 ${columnAlign(key)} ${key === 'dishName' ? 'font-medium' : ''}`}>
                      {columnValue(row, key)}
                    </td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-background font-semibold">
                <tr>
                  {columns.map((key) => <td key={key} className={`px-4 py-3 ${columnAlign(key)}`}>
                    {key === 'dishName' ? 'Итого' : key === 'quantity' ? rowQuantity : key === 'amount' ? money(rowAmount) : null}
                  </td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {columnsOpen && <WarehouseColumnSettings columns={columns} defaults={defaultColumns} label={(key) => columnLabels[key]}
        onClose={() => setColumnsOpen(false)} onApply={(selected, reset) => {
          saveColumns(reset && selected.join(',') === defaultColumns.join(',') ? '' : selected.join(','));
          setColumnsOpen(false);
        }} />}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 border-border px-4 py-3 even:border-l max-md:[&:nth-child(n+3)]:border-t md:border-l md:first:border-l-0">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-text-primary sm:text-xl">{value}</dd>
    </div>
  );
}

function CategoryTotalRow({ category, defaultOpen }: { category: CategoryTotal; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-background"
      >
        <span
          aria-hidden
          className={`text-xl leading-none text-text-light transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        <span className="font-medium text-text-primary">{category.name}</span>
        <span className="ml-auto whitespace-nowrap text-text-secondary">
          {category.quantity} шт. <span className="text-text-muted">({money(category.amount)})</span>
        </span>
      </button>
      {open && (
        <div className="space-y-1 pb-2 pl-9 pr-2">
          {category.dishes.map((dish) => (
            <div key={dish.name} className="flex items-center gap-3 text-sm text-text-secondary">
              <span className="min-w-0 flex-1 truncate">{dish.name}</span>
              <span className="shrink-0 whitespace-nowrap">
                {dish.quantity} шт. <span className="text-text-muted">({money(dish.amount)})</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
