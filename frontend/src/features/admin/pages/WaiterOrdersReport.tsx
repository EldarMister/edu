import { useMemo, useState } from 'react';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useWaiterOrdersReport, type StaffMember, type WaiterOrdersReportItem } from '../api';

type DishTotal = { name: string; quantity: number; amount: number };
type CategoryTotal = { name: string; quantity: number; amount: number; dishes: DishTotal[] };

const EMPTY_REPORT_ROWS: WaiterOrdersReportItem[] = [];

const todayYmd = () => {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} мин ${rest} сек` : `${rest} сек`;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function WaiterOrdersReport({ staff, staffLoading }: { staff: StaffMember[]; staffLoading: boolean }) {
  const [from, setFrom] = useState(todayYmd);
  const [to, setTo] = useState(todayYmd);
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

  function changeFrom(value: string) {
    setFrom(value);
    if (value > to) setTo(value);
  }

  function changeTo(value: string) {
    setTo(value);
    if (value < from) setFrom(value);
  }

  function exportCsv() {
    if (!data) return;
    const header = ['Время заказа', 'Время подачи', '№ заказа', 'Стол', 'Блюдо', 'Категория', 'Кол-во', 'Цена', 'Сумма'];
    const lines = data.items.map((item) => [
      timeHM(item.orderedAt),
      timeHM(item.servedAt),
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
    URL.revokeObjectURL(url);
  }

  return (
    <section className="waiter-orders-report space-y-5 rounded-2xl bg-white p-4 shadow-card sm:p-5 lg:p-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary sm:text-[28px]">Отчет официанта по заказам</h2>
        <p className="mt-1 text-sm text-text-muted sm:text-base">Отдельная страница по одному официанту</p>
      </div>

      <div className="no-print flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <div className="flex h-[50px] min-w-0 items-center rounded-xl border border-border bg-white sm:min-w-[390px]">
            <span className="shrink-0 border-r border-border px-3 text-sm text-text-muted">Период:</span>
            <input
              aria-label="Начало периода"
              type="date"
              value={from}
              onChange={(event) => changeFrom(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm text-text-primary outline-none"
            />
            <span className="text-text-light">—</span>
            <input
              aria-label="Конец периода"
              type="date"
              value={to}
              onChange={(event) => changeTo(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm text-text-primary outline-none"
            />
          </div>
          <div className="flex h-[50px] min-w-0 items-center rounded-xl border border-border bg-white sm:min-w-[310px]">
            <span className="shrink-0 border-r border-border px-3 text-sm text-text-muted">Официант:</span>
            <Select
              value={selectedWaiterId}
              onChange={setWaiterId}
              options={waiterOptions}
              placeholder={staffLoading ? 'Загрузка...' : 'Выберите официанта'}
              disabled={staffLoading || waiterOptions.length === 0}
              className="h-full min-w-0 flex-1 rounded-none border-0 px-3 hover:border-0"
            />
          </div>
        </div>

        <div className="flex gap-2 sm:justify-end">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!data}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            <span aria-hidden className="text-lg leading-none">↓</span>
            Экспорт
          </button>
        </div>
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-x-0 gap-y-2 text-sm text-text-primary sm:text-[15px]">
          <SummaryItem label="Официант" value={data.waiter.name} />
          <SummaryItem label="Заказов" value={data.summary.ordersCount} />
          <SummaryItem label="Блюд" value={data.summary.dishesCount} />
          <SummaryItem label="Сумма" value={money(data.summary.amount)} />
          <SummaryItem label="Среднее время подачи" value={durationLabel(data.summary.averageServingSeconds)} last />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        {report.isLoading || staffLoading ? (
          <div className="flex justify-center py-16 text-primary"><Spinner className="h-6 w-6" /></div>
        ) : !selectedWaiterId ? (
          <p className="py-16 text-center text-text-muted">Добавьте официанта, чтобы сформировать отчет</p>
        ) : report.isError ? (
          <div className="py-16 text-center">
            <p className="text-sm text-danger">Не удалось загрузить отчет</p>
            <button type="button" onClick={() => report.refetch()} className="no-print mt-3 text-sm font-medium text-primary">Повторить</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-text-muted">За выбранный период оплаченных заказов нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-sm">
              <thead className="bg-background/40 text-text-muted">
                <tr>
                  {['Время заказа', 'Время подачи', '№ заказа', 'Стол', 'Блюдо', 'Категория', 'Кол-во', 'Цена', 'Сумма'].map((heading) => (
                    <th key={heading} className="border-b border-r border-border px-4 py-3 text-center font-medium last:border-r-0">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => <ReportRow key={row.id} row={row} />)}
              </tbody>
              <tfoot>
                <tr className="bg-background/20 font-semibold text-text-primary">
                  <td colSpan={6} className="px-4 py-3">Итого</td>
                  <td className="px-4 py-3 text-center">{data?.summary.dishesCount}</td>
                  <td />
                  <td className="px-4 py-3 text-center">{money(data?.summary.amount ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {categoryTotals.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 sm:p-5">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-text-primary">Итоги по блюдам</h3>
            <p className="mt-0.5 text-sm text-text-muted">Товарная разбивка за выбранный период</p>
          </div>
          <div className="space-y-1">
            {categoryTotals.map((category, index) => (
              <CategoryTotalRow key={category.name} category={category} defaultOpen={index === 0} />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm font-semibold text-text-primary">
            <span>Всего</span>
            <span>{data?.summary.dishesCount ?? 0} шт. <span className="text-text-muted">({money(data?.summary.amount ?? 0)})</span></span>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryItem({ label, value, last = false }: { label: string; value: string | number; last?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-4 first:pl-0 ${last ? '' : 'border-r border-border'}`}>
      <span>{label}:</span>
      <strong className="font-semibold">{value}</strong>
    </div>
  );
}

function ReportRow({ row }: { row: WaiterOrdersReportItem }) {
  return (
    <tr className="text-text-primary hover:bg-background/30">
      <td className="border-b border-r border-border px-4 py-2.5 text-center">{timeHM(row.orderedAt)}</td>
      <td className="border-b border-r border-border px-4 py-2.5 text-center">{timeHM(row.servedAt)}</td>
      <td className="border-b border-r border-border px-4 py-2.5 text-center">{displayOrderNumber(row.orderNumber)}</td>
      <td className="border-b border-r border-border px-4 py-2.5 text-center">{row.tableNumber}</td>
      <td className="border-b border-r border-border px-5 py-2.5 font-medium">{row.dishName}</td>
      <td className="border-b border-r border-border px-5 py-2.5">{row.categoryName}</td>
      <td className="border-b border-r border-border px-4 py-2.5 text-center">{row.quantity}</td>
      <td className="border-b border-r border-border px-4 py-2.5 text-center">{money(row.unitPrice)}</td>
      <td className="border-b border-border px-4 py-2.5 text-center">{money(row.amount)}</td>
    </tr>
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
