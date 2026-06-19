import { useMemo, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import { useWarehouseOverview, qty, type StockMovementType } from './api';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

const TYPE_LABEL: Record<StockMovementType, string> = {
  purchase: 'Приход',
  sale: 'Списание',
  return: 'Возврат',
  correction: 'Коррекция',
  cancel: 'Отмена',
};

export function WarehouseOverviewTab() {
  const [preset, setPreset] = useState<PeriodPreset>('week');
  const [customFrom, setCustomFrom] = useState(localDate(addDays(new Date(), -6)));
  const [customTo, setCustomTo] = useState(localDate(new Date()));

  const range = useMemo(() => {
    const today = new Date();
    if (preset === 'today') {
      const value = localDate(today);
      return { dateFrom: value, dateTo: value };
    }
    if (preset === 'month') {
      return { dateFrom: localDate(addDays(today, -29)), dateTo: localDate(today) };
    }
    if (preset === 'custom') {
      return { dateFrom: customFrom, dateTo: customTo };
    }
    return { dateFrom: localDate(addDays(today, -6)), dateTo: localDate(today) };
  }, [customFrom, customTo, preset]);

  const overview = useWarehouseOverview(range);
  const data = overview.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">Склад</h2>
          <p className="text-sm text-text-secondary">Обзор остатков, закупок и движений</p>
        </div>
        <PeriodFilter
          preset={preset}
          setPreset={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          setCustomFrom={setCustomFrom}
          setCustomTo={setCustomTo}
        />
      </div>

      {overview.isLoading ? (
        <div className="flex justify-center py-16 text-primary">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Стоимость остатков" value={money(data?.stockValue ?? 0)} />
            <MetricCard label="Низкий остаток" value={String(data?.lowStockCount ?? 0)} />
            <MetricCard label="Закупки за период" value={money(data?.purchasesTotal ?? 0)} />
            <MetricCard label="Списания сырья" value={money(data?.ingredientWriteOffTotal ?? 0)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
            <Panel title="Динамика остатков">
              <StockLineChart data={data?.stockValueTrend ?? []} />
            </Panel>
            <Panel title="Критично / низкий остаток">
              <CompactTable
                headers={['Ингредиент', 'Текущий остаток', 'Порог']}
                empty="Низких остатков нет"
                rows={(data?.lowStockItems ?? []).map((item) => [
                  item.name,
                  qty(item.stock, item.unit),
                  qty(item.lowStockThreshold, item.unit),
                ])}
              />
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title="Топ расходуемых ингредиентов">
              <CompactTable
                headers={['Ингредиент', 'Расход', 'Сумма']}
                empty="Нет списаний за период"
                rows={(data?.topConsumedIngredients ?? []).map((item) => [
                  item.name,
                  qty(item.quantity, item.unit),
                  money(item.cost),
                ])}
              />
            </Panel>
            <Panel title="Последние движения">
              <CompactTable
                headers={['Время', 'Тип', 'Ингредиент', 'Изменение', 'После']}
                empty="Движений пока нет"
                rows={(data?.recentMovements ?? []).map((item) => [
                  formatTime(item.createdAt),
                  TYPE_LABEL[item.type] ?? item.type,
                  item.ingredientName,
                  signedQty(item.change, item.unit),
                  qty(item.after, item.unit),
                ])}
              />
            </Panel>
            <Panel title="Закупки по поставщикам">
              <CompactTable
                headers={['Поставщик', 'Сумма']}
                empty="Нет закупок за период"
                rows={(data?.suppliersTop ?? []).map((item) => [item.supplier, money(item.total)])}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function PeriodFilter({
  preset,
  setPreset,
  customFrom,
  customTo,
  setCustomFrom,
  setCustomTo,
}: {
  preset: PeriodPreset;
  setPreset: (v: PeriodPreset) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
}) {
  const items: { key: PeriodPreset; label: string }[] = [
    { key: 'today', label: 'Сегодня' },
    { key: 'week', label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
    { key: 'custom', label: 'Период' },
  ];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="inline-flex rounded-lg border border-border bg-white p-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              preset === item.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
            }`}
            onClick={() => setPreset(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input className="input h-10 w-[145px] text-sm" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="text-text-muted">-</span>
          <input className="input h-10 w-[145px] text-sm" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="mb-3 text-base font-semibold text-text-primary">{title}</h3>
      {children}
    </section>
  );
}

function CompactTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-text-muted">{empty}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            {headers.map((header) => (
              <th key={header} className="px-2 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-b border-border last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className="px-2 py-2.5 text-text-secondary first:font-medium first:text-text-primary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockLineChart({ data }: { data: Array<{ date: string; value: number }> }) {
  if (data.length === 0) {
    return <div className="rounded-lg border border-dashed border-border py-20 text-center text-sm text-text-muted">Нет данных для графика</div>;
  }

  const width = 720;
  const height = 230;
  const padX = 38;
  const padY = 22;
  const max = Math.max(...data.map((item) => item.value), 1);
  const min = Math.min(...data.map((item) => item.value), 0);
  const spread = Math.max(max - min, 1);
  const points = data.map((item, index) => {
    const x = padX + (index * (width - padX * 2)) / Math.max(data.length - 1, 1);
    const y = height - padY - ((item.value - min) * (height - padY * 2)) / spread;
    return { ...item, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const grid = [0, 1, 2, 3].map((i) => padY + (i * (height - padY * 2)) / 3);

  return (
    <div className="overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[230px] w-full">
        {grid.map((y) => (
          <line key={y} x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="4 4" />
        ))}
        <path d={path} fill="none" stroke="#0b63f6" strokeWidth="2.5" />
        {points.map((point) => (
          <circle key={point.date} cx={point.x} cy={point.y} r="3.5" fill="white" stroke="#0b63f6" strokeWidth="2" />
        ))}
      </svg>
      <div className="flex justify-between gap-2 text-xs text-text-muted">
        <span>{formatDate(data[0]?.date)}</span>
        <span>{formatDate(data[data.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function signedQty(value: number, unit: string) {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${qty(value, unit)}`;
}
