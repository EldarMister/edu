import { useMemo, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import { useWarehouseOverview, qty, type StockMovementType } from './api';
import { StockTrendChart } from './StockTrendChart';

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
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
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
              <StockTrendChart data={data?.stockValueTrend ?? []} />
            </Panel>
            <Panel title="Низкий остаток">
              <CompactTable
                headers={['Товар', 'Остаток', 'Ед.']}
                align={['left', 'right', 'right']}
                empty="Низких остатков нет"
                rows={(data?.lowStockItems ?? []).map((item) => [
                  item.name,
                  num(item.stock),
                  item.unit,
                ])}
              />
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Panel title="Топ расходуемых ингредиентов">
              <CompactTable
                headers={['Ингредиент', 'Расход', 'Сумма']}
                align={['left', 'right', 'right']}
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
                align={['left', 'left', 'left', 'right', 'right']}
                empty="Движений пока нет"
                rows={(data?.recentMovements ?? []).map((item) => [
                  formatTime(item.createdAt),
                  <TypeBadge key="t" type={item.type} />,
                  item.ingredientName,
                  <ChangeCell key="c" value={item.change} unit={item.unit} />,
                  qty(item.after, item.unit),
                ])}
              />
            </Panel>
            <Panel title="Закупки по поставщикам">
              <CompactTable
                headers={['Поставщик', 'Сумма']}
                align={['left', 'right']}
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
      <p className="text-[13px] text-text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold text-text-primary">{value}</p>
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

function CompactTable({
  headers,
  rows,
  empty,
  align = [],
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
  align?: ('left' | 'right')[];
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">{empty}</p>;
  }
  const cls = (i: number) => (align[i] === 'right' ? 'text-right' : 'text-left');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-text-muted">
            {headers.map((header, i) => (
              <th key={header} className={`px-2 py-2 font-medium ${cls(i)}`}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border last:border-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-2 py-2.5 ${cls(cellIndex)} ${cellIndex === 0 ? 'font-medium text-text-primary' : 'text-text-secondary'}`}
                >
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

const TYPE_TONE: Record<StockMovementType, string> = {
  purchase: 'bg-success/10 text-success',
  return: 'bg-success/10 text-success',
  sale: 'bg-danger/10 text-danger',
  correction: 'bg-warning/10 text-warning',
  cancel: 'bg-background text-text-muted',
};

/** Спокойный бейдж типа движения. */
function TypeBadge({ type }: { type: StockMovementType }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TYPE_TONE[type]}`}>
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

/** Изменение остатка со знаком и цветом. */
function ChangeCell({ value, unit }: { value: number; unit: string }) {
  const tone = value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-text-secondary';
  return <span className={`font-medium ${tone}`}>{signedQty(value, unit)}</span>;
}

/** Число без единицы измерения: 0.12 → «0,12», 5 → «5». */
function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
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
