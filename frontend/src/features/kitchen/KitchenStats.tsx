import { useMemo, useState } from 'react';
import type { PrepStation } from '@/types';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import {
  useKitchenStats,
  type KitchenStats as KitchenStatsData,
  type KitchenStatsDish,
  type KitchenStatsPeriod,
} from './api';

const PERIODS: { value: KitchenStatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
  { value: 'custom', label: 'Период' },
];

const PERIOD_LABEL: Record<KitchenStatsPeriod, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц',
  all: 'Всё время',
  custom: 'Период',
};

// Заголовок списка приготовленных блюд зависит от выбранного периода (как у владельца).
const PREPARED_LABEL: Record<KitchenStatsPeriod, string> = {
  today: 'Приготовлено сегодня',
  week: 'Приготовлено за неделю',
  month: 'Приготовлено за месяц',
  all: 'Приготовлено за всё время',
  custom: 'Приготовлено за период',
};

function minutes(n: number) {
  return `${n} мин`;
}

/** Сегментированный переключатель периода (активный — белая кнопка с синим текстом). */
function PeriodTabs({
  period,
  onChange,
}: {
  period: KitchenStatsPeriod;
  onChange: (p: KitchenStatsPeriod) => void;
}) {
  return (
    <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-background p-1 sm:inline-flex sm:w-auto sm:flex-wrap">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            period === p.value
              ? 'bg-white text-primary shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Поля выбора дат для произвольного периода. */
function CustomRange({
  from,
  to,
  today,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  today: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className="input h-10 w-[150px]" type="date" value={from} max={to} onChange={(e) => onFrom(e.target.value)} />
      <span className="text-sm text-text-muted">—</span>
      <input className="input h-10 w-[150px]" type="date" value={to} max={today} onChange={(e) => onTo(e.target.value)} />
    </div>
  );
}

export function KitchenStats({ station = 'kitchen' }: { station?: PrepStation }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const weekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  }, []);

  const [period, setPeriod] = useState<KitchenStatsPeriod>('today');
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);

  const [longOpen, setLongOpen] = useState(false);
  const [preparedOpen, setPreparedOpen] = useState(false);
  const [hourlyOpen, setHourlyOpen] = useState(false);

  const statsQ = useKitchenStats(
    { period, from: period === 'custom' ? from : undefined, to: period === 'custom' ? to : undefined },
    station,
  );
  const d = statsQ.data;

  const longest = useMemo(
    () => (d ? [...d.dishes].filter((x) => x.timed).sort((a, b) => b.avgMin - a.avgMin) : []),
    [d],
  );
  const fastest = useMemo(
    () => (d ? [...d.dishes].filter((x) => x.timed).sort((a, b) => a.avgMin - b.avgMin) : []),
    [d],
  );
  const preparedDishes = useMemo(
    () => (d ? [...d.dishes].sort((a, b) => b.count - a.count) : []),
    [d],
  );

  return (
    <div className="space-y-4 overflow-x-hidden p-4 sm:p-5">
      {/* Период */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PeriodTabs period={period} onChange={setPeriod} />
        {period === 'custom' && (
          <CustomRange from={from} to={to} today={today} onFrom={setFrom} onTo={setTo} />
        )}
      </div>

      {statsQ.isLoading || !d ? (
        <div className="flex justify-center py-20 text-primary">
          <Spinner className="h-7 w-7" />
        </div>
      ) : (
        <>
          {/* Inline-сводка (как у заказов) */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
            <Sum label="Приготовлено блюд" value={d.cards.prepared} />
            <Sep />
            <Sum label="В среднем в день" value={`${d.prepared.avgPerDay} шт`} />
            <Sep />
            <Sum label="Максимум за день" value={`${d.prepared.maxPerDay} шт`} />
            <Sep />
            <Sum label="Отказов" value={d.cards.rejections} />
            <Sep />
            <Sum label="Среднее время" value={d.cards.avgPrepMin > 0 ? minutes(d.cards.avgPrepMin) : '—'} />
          </div>

          {/* Блоки-списки */}
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Самые долгие блюда" onViewAll={longest.length ? () => setLongOpen(true) : undefined}>
              <MiniTable
                columns={[{ label: 'Блюдо' }, { label: 'Среднее время', align: 'right' }]}
                rows={longest.slice(0, 6).map((x) => [x.name, minutes(x.avgMin)])}
                empty="Нет данных за период"
              />
            </Panel>
            <Panel title="Самые быстрые блюда" onViewAll={fastest.length ? () => setLongOpen(true) : undefined}>
              <MiniTable
                columns={[{ label: 'Блюдо' }, { label: 'Среднее время', align: 'right' }]}
                rows={fastest.slice(0, 6).map((x) => [x.name, minutes(x.avgMin)])}
                empty="Нет данных за период"
              />
            </Panel>
            <Panel
              title={PREPARED_LABEL[period]}
              onViewAll={preparedDishes.length ? () => setPreparedOpen(true) : undefined}
            >
              <MiniTable
                columns={[{ label: 'Блюдо' }, { label: 'Кол-во', align: 'right' }]}
                rows={preparedDishes.slice(0, 6).map((x) => [x.name, `${x.count} шт`])}
                empty="Нет приготовленных блюд за период"
              />
            </Panel>
          </div>

          <Panel title="Отказы по блюдам">
            <MiniTable
              columns={[{ label: 'Блюдо' }, { label: 'Отказов', align: 'right' }]}
              rows={d.rejections.slice(0, 6).map((x) => [x.name, String(x.count)])}
              empty="Нет отказов за период"
            />
          </Panel>

          <section className="rounded-xl border border-border bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-text-primary">Приготовлено по часам</h3>
              <button
                type="button"
                onClick={() => setHourlyOpen(true)}
                className="text-sm font-medium text-primary hover:underline"
              >
                Смотреть детали
              </button>
            </div>
            <HourlyChart data={d.hourly} height={200} />
          </section>
        </>
      )}

      {/* Модалки и панель */}
      {longOpen && d && (
        <LongestDishesModal
          dishes={longest}
          periodLabel={PERIOD_LABEL[period]}
          onClose={() => setLongOpen(false)}
        />
      )}
      {preparedOpen && d && (
        <PreparedDishesModal
          dishes={preparedDishes}
          title={PREPARED_LABEL[period]}
          periodLabel={PERIOD_LABEL[period]}
          onClose={() => setPreparedOpen(false)}
        />
      )}
      {hourlyOpen && (
        <HourlyModal
          station={station}
          initialPeriod={period}
          initialFrom={from}
          initialTo={to}
          today={today}
          onClose={() => setHourlyOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------- Inline-сводка (как у заказов) ---------- */

function Sum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span>
      {label}: <span className="font-medium text-text-primary">{value}</span>
    </span>
  );
}
function Sep() {
  return <span className="text-text-light">|</span>;
}

/* ---------- Панель и компактная таблица ---------- */

function Panel({
  title,
  onViewAll,
  children,
}: {
  title: string;
  onViewAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="mb-3 text-base font-semibold text-text-primary">{title}</h3>
      {children}
      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          Смотреть все
        </button>
      )}
    </section>
  );
}

type Col = { label: string; align?: 'left' | 'right' };

function MiniTable({
  columns,
  rows,
  footer,
  empty,
}: {
  columns: Col[];
  rows: (string | number)[][];
  footer?: (string | number)[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">{empty}</p>;
  }
  const align = (i: number) => (columns[i]?.align === 'right' ? 'text-right' : 'text-left');
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-text-muted">
          {columns.map((c, i) => (
            <th key={c.label} className={`pb-2 font-medium ${align(i)}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-b border-border last:border-0">
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={`py-2 ${align(ci)} ${ci === 0 ? 'font-medium text-text-primary' : 'text-text-secondary'}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && (
        <tfoot>
          <tr className="border-t border-border">
            {footer.map((cell, ci) => (
              <td key={ci} className={`pt-2 font-semibold text-text-primary ${align(ci)}`}>
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/* ---------- Модалка «Самые долгие блюда» ---------- */

const PAGE_SIZE = 8;

function LongestDishesModal({
  dishes,
  periodLabel,
  onClose,
}: {
  dishes: KitchenStatsDish[];
  periodLabel: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? dishes.filter((x) => x.name.toLowerCase().includes(q)) : dishes;
  }, [dishes, search]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="modal-backdrop z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        className="card relative z-10 flex w-full flex-col rounded-b-none sm:max-w-3xl sm:rounded-2xl"
        style={{ maxHeight: 'calc(92dvh - env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">Самые долгие блюда</h3>
            <p className="mt-0.5 text-xs text-text-muted">{periodLabel}</p>
          </div>
          <button onClick={onClose} className="text-text-light hover:text-text-secondary" aria-label="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="shrink-0 px-4 py-3">
          <input
            className="input"
            placeholder="Поиск по блюду"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <MiniTable
            columns={[
              { label: 'Блюдо' },
              { label: 'Среднее время', align: 'right' },
              { label: 'Мин. время', align: 'right' },
              { label: 'Макс. время', align: 'right' },
              { label: 'Кол-во', align: 'right' },
              { label: 'Выручка', align: 'right' },
            ]}
            rows={rows.map((x) => [
              x.name,
              minutes(x.avgMin),
              minutes(x.minMin),
              minutes(x.maxMin),
              `${x.count} шт`,
              money(x.revenue),
            ])}
            empty="Ничего не найдено"
          />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <span className="text-xs text-text-muted">
            Всего блюд: {filtered.length}
          </span>
          <Pagination page={current} pages={pages} onChange={setPage} />
        </div>
      </div>
    </div>
  );
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-secondary disabled:opacity-40 enabled:hover:bg-background"
      >
        ‹
      </button>
      <span className="px-2 text-sm text-text-muted">
        {page} / {pages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= pages}
        className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-text-secondary disabled:opacity-40 enabled:hover:bg-background"
      >
        ›
      </button>
    </div>
  );
}

/* ---------- Модалка «Приготовлено за период» (как у владельца) ---------- */

function PreparedDishesModal({
  dishes,
  title,
  periodLabel,
  onClose,
}: {
  dishes: KitchenStatsDish[];
  title: string;
  periodLabel: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? dishes.filter((x) => x.name.toLowerCase().includes(q)) : dishes;
  }, [dishes, search]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const totalCount = filtered.reduce((s, x) => s + x.count, 0);

  return (
    <div className="modal-backdrop z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        className="card relative z-10 flex w-full flex-col rounded-b-none sm:max-w-xl sm:rounded-2xl"
        style={{ maxHeight: 'calc(92dvh - env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">{title}</h3>
            <p className="mt-0.5 text-xs text-text-muted">{periodLabel}</p>
          </div>
          <button onClick={onClose} className="text-text-light hover:text-text-secondary" aria-label="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="shrink-0 px-4 py-3">
          <input
            className="input"
            placeholder="Поиск по блюду"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <MiniTable
            columns={[{ label: 'Блюдо' }, { label: 'Кол-во', align: 'right' }]}
            rows={rows.map((x) => [x.name, `${x.count} шт`])}
            footer={['Итого', `${totalCount} шт`]}
            empty="Ничего не найдено"
          />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <span className="text-xs text-text-muted">Всего блюд: {filtered.length}</span>
          <Pagination page={current} pages={pages} onChange={setPage} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Модалка «Приготовлено по часам» ---------- */

function HourlyModal({
  station,
  initialPeriod,
  initialFrom,
  initialTo,
  today,
  onClose,
}: {
  station: PrepStation;
  initialPeriod: KitchenStatsPeriod;
  initialFrom: string;
  initialTo: string;
  today: string;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<KitchenStatsPeriod>(initialPeriod);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const statsQ = useKitchenStats(
    { period, from: period === 'custom' ? from : undefined, to: period === 'custom' ? to : undefined },
    station,
  );
  const hourly = statsQ.data?.hourly ?? [];
  const active = hourly.filter((h) => h.count > 0);
  const totalCount = active.reduce((s, h) => s + h.count, 0);
  const peak = active.reduce<{ hour: number; count: number } | null>(
    (best, h) => (!best || h.count > best.count ? h : best),
    null,
  );
  const avgPerHour = active.length > 0 ? Math.round(totalCount / active.length) : 0;
  const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

  return (
    <div className="modal-backdrop z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        className="card relative z-10 flex w-full flex-col rounded-b-none sm:max-w-4xl sm:rounded-2xl"
        style={{ maxHeight: 'calc(92dvh - env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold text-text-primary">Приготовлено по часам</h3>
          <button onClick={onClose} className="text-text-light hover:text-text-secondary" aria-label="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* Период внутри модалки */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <PeriodTabs period={period} onChange={setPeriod} />
            {period === 'custom' && (
              <CustomRange from={from} to={to} today={today} onFrom={setFrom} onTo={setTo} />
            )}
          </div>

          {statsQ.isLoading ? (
            <div className="flex justify-center py-16 text-primary">
              <Spinner className="h-7 w-7" />
            </div>
          ) : (
            <>
              {/* Большой график */}
              <HourlyChart data={hourly} height={260} showRevenueAxis />

              {/* Таблица по часам */}
              <div className="mt-5">
                <MiniTable
                  columns={[
                    { label: 'Время' },
                    { label: 'Приготовлено блюд', align: 'right' },
                    { label: 'Выручка', align: 'right' },
                  ]}
                  rows={active.map((h) => [hourLabel(h.hour), String(h.count), money(h.revenue)])}
                  empty="Нет данных за период"
                />
              </div>

              {/* Краткие показатели */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                <Summary label="Пиковый час" value={peak ? hourLabel(peak.hour) : '—'} />
                <Summary label="Всего блюд" value={String(totalCount)} />
                <Summary label="Среднее в час" value={String(avgPerHour)} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3 text-center">
      <p className="text-[12px] text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}

/* ---------- График по часам ---------- */

function HourlyChart({
  data,
  height,
  showRevenueAxis = false,
}: {
  data: KitchenStatsData['hourly'];
  height: number;
  showRevenueAxis?: boolean;
}) {
  const max = Math.max(1, ...data.map((h) => h.count));
  const barCount = data.length;
  if (!data.some((h) => h.count > 0)) {
    return <p className="py-12 text-center text-sm text-text-muted">Нет данных за период</p>;
  }
  // Сверху над столбцом — количество, снизу — час (ось времени).
  return (
    <div className="w-full">
      <div className="flex items-stretch gap-[3px]" style={{ height }}>
        {data.map((h) => {
          const hPct = (h.count / max) * 100;
          return (
            <div key={h.hour} className="group flex flex-1 flex-col items-center justify-end">
              {h.count > 0 && (
                <span className="mb-1 text-[10px] font-medium leading-none text-text-secondary">{h.count}</span>
              )}
              <div
                className="w-full rounded-t-[3px] bg-primary/85 transition-colors group-hover:bg-primary"
                style={{ height: `${h.count > 0 ? Math.max(4, hPct) : 0}%` }}
                title={`${String(h.hour).padStart(2, '0')}:00 — ${h.count} шт${showRevenueAxis ? `, ${money(h.revenue)}` : ''}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {data.map((h) => (
          <div key={h.hour} className="flex-1 text-center text-[10px] leading-none text-text-light">
            {String(h.hour).padStart(2, '0')}
          </div>
        ))}
      </div>
      <span className="sr-only">{barCount} часов</span>
    </div>
  );
}
