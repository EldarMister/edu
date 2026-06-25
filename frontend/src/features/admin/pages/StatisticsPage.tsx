import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import type { PaymentMethod } from '@/types';
import { IconCheck, IconOrders } from '../components/icons';
import { useStatistics, type StatsPeriod } from '../api';
import { usePublicSettings } from '@/features/settings/api';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
  { value: 'custom', label: 'Период' },
];

// Подпись KPI заказов зависит от выбранного периода вверху.
const ORDERS_LABEL: Record<StatsPeriod, string> = {
  today: 'Заказов сегодня',
  week: 'Заказов за неделю',
  month: 'Заказов за месяц',
  all: 'Заказов за всё время',
  custom: 'Заказов за период',
};

// Заголовок карточки приготовленных блюд зависит от выбранного периода.
const PREPARED_LABEL: Record<StatsPeriod, string> = {
  today: 'Приготовлено сегодня',
  week: 'Приготовлено за неделю',
  month: 'Приготовлено за месяц',
  all: 'Приготовлено за всё время',
  custom: 'Приготовлено за период',
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
  // Смешанная в статистике раскладывается на наличные/QR на бэке, отдельной строкой не выводится.
  mixed: 'Смешанная',
};

export function StatisticsPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const weekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  }, []);
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [viewAll, setViewAll] = useState<{ title: string; columns: Col[]; rows: string[][] } | null>(null);
  const statsQ = useStatistics({
    period,
    from: period === 'custom' ? from : undefined,
    to: period === 'custom' ? to : undefined,
  });
  const publicSettingsQ = usePublicSettings();
  const d = statsQ.data;
  const visiblePaymentMethods = (() => {
    if (!d) return [];
    const enabled = (publicSettingsQ.data?.paymentMethods ?? d.paymentMethods.map((m) => m.method)).filter(
      (method): method is Extract<PaymentMethod, 'qr' | 'cash' | 'card'> =>
        method === 'qr' || method === 'cash' || method === 'card',
    );
    return enabled.map((method) => d.paymentMethods.find((item) => item.method === method) ?? { method, amount: 0, percent: 0 });
  })();

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* Переключатель периода */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-background p-1 sm:inline-flex sm:w-auto sm:flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
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

        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="input h-10 w-[150px]" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-sm text-text-muted">—</span>
            <input className="input h-10 w-[150px]" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      {statsQ.isLoading || !d ? (
        <div className="flex justify-center py-20 text-primary">
          <Spinner className="h-7 w-7" />
        </div>
      ) : (
        <>
          {/* Метрики: десктоп — две карточки */}
          <div className="hidden gap-4 lg:grid lg:grid-cols-2">
            <MetricCard icon={<IconOrders />} label={ORDERS_LABEL[period]} value={String(d.cards.ordersPeriod)} delta={d.trends.orders} />
            <MetricCard icon={<IconCheck />} label="Средний чек" value={money(d.cards.avgCheck)} delta={d.trends.avgCheck} />
          </div>

          {/* Метрики: мобильный — единый сплит-блок (2 показателя) */}
          <div className="card flex divide-x divide-border lg:hidden">
            <SplitMetric icon={<IconOrders />} label={ORDERS_LABEL[period]} value={String(d.cards.ordersPeriod)} delta={d.trends.orders} />
            <SplitMetric icon={<IconCheck />} label="Средний чек" value={money(d.cards.avgCheck)} delta={d.trends.avgCheck} />
          </div>

          {/* График выручки */}
          <section className="rounded-xl border border-border bg-white p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-text-primary">Выручка за период</h3>
              <span className="text-sm font-medium text-text-muted">{d.cards.ordersPeriod} заказов</span>
            </div>
            <RevenueChart data={d.revenueSeries} />
          </section>

          {/* Аналитические блоки */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Panel title="Способы оплаты">
              <MiniTable
                columns={[{ label: 'Способ' }, { label: 'Сумма', align: 'right' }]}
                rows={visiblePaymentMethods.map((m) => [METHOD_LABEL[m.method], money(m.amount)])}
                footer={['Итого', money(visiblePaymentMethods.reduce((s, m) => s + m.amount, 0))]}
                empty="Нет оплат за период"
              />
            </Panel>
            <Panel title="Топ блюд">
              <MiniTable
                columns={[{ label: 'Блюдо' }, { label: 'Кол-во', align: 'right' }, { label: 'Выручка', align: 'right' }]}
                rows={d.topDishes.map((x) => [x.name, `${x.count} шт`, money(x.amount)])}
                empty="Нет продаж за период"
              />
            </Panel>
            <Panel title="Лучшие официанты">
              <MiniTable
                columns={[{ label: 'Официант' }, { label: 'Заказы', align: 'right' }, { label: 'Выручка', align: 'right' }]}
                rows={d.topWaiters.map((x) => [x.name, String(x.orders), money(x.amount)])}
                empty="Нет данных за период"
              />
            </Panel>
            <Panel title="Часы пик">
              <MiniTable
                columns={[{ label: 'Время' }, { label: 'Выручка', align: 'right' }]}
                rows={d.peakHours.map((x) => [`${x.hour} – ${nextHourLabel(x.hour)}`, money(x.amount)])}
                empty="Нет оплаченных заказов за период"
              />
            </Panel>
          </div>

          {/* Приготовленные блюда и проданные напитки */}
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Приготовлено блюд">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ['Всего приготовлено', `${d.prepared.total} шт`],
                    ['В среднем в день', `${d.prepared.avgPerDay} шт`],
                    ['Уникальных блюд', String(d.prepared.uniqueDishes)],
                    ['Максимум за день', `${d.prepared.maxPerDay} шт`],
                  ].map(([label, value]) => (
                    <tr key={label} className="border-b border-border last:border-0">
                      <td className="py-2 font-medium text-text-primary">{label}</td>
                      <td className="py-2 text-right text-text-secondary">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <ListCard
              title={PREPARED_LABEL[period]}
              columns={[{ label: 'Блюдо' }, { label: 'Кол-во', align: 'right' }]}
              rows={d.prepared.dishes.map((x) => [x.name, `${x.count} шт`])}
              empty="Нет приготовленных блюд за период"
              onViewAll={setViewAll}
            />
            <ListCard
              title="Продано напитков"
              columns={[{ label: 'Напиток' }, { label: 'Кол-во', align: 'right' }]}
              rows={d.drinks.dishes.map((x) => [x.name, `${x.count} шт`])}
              empty="Нет продаж напитков за период"
              onViewAll={setViewAll}
            />
          </div>
        </>
      )}

      <Modal open={!!viewAll} onClose={() => setViewAll(null)} title={viewAll?.title} panelClassName="max-w-md">
        {viewAll && <MiniTable columns={viewAll.columns} rows={viewAll.rows} empty="—" />}
      </Modal>
    </div>
  );
}

/* ---------- Карточка-список с «Смотреть все» ---------- */

const LIST_LIMIT = 6;

function ListCard({
  title,
  columns,
  rows,
  empty,
  onViewAll,
}: {
  title: string;
  columns: Col[];
  rows: string[][];
  empty: string;
  onViewAll: (v: { title: string; columns: Col[]; rows: string[][] }) => void;
}) {
  return (
    <Panel title={title}>
      <MiniTable columns={columns} rows={rows.slice(0, LIST_LIMIT)} empty={empty} />
      {rows.length > LIST_LIMIT && (
        <button
          type="button"
          onClick={() => onViewAll({ title, columns, rows })}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          Смотреть все
        </button>
      )}
    </Panel>
  );
}

/* ---------- Карточки-метрики ---------- */

function MetricCard({
  icon,
  label,
  value,
  delta,
}: {
  icon: JSX.Element;
  label: string;
  value: React.ReactNode;
  delta: number;
}) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-text-muted">{label}</p>
        <p className="mt-1 text-[26px] font-semibold leading-none text-text-primary">{value}</p>
      </div>
      <TrendPill value={delta} />
    </div>
  );
}

/** Половина мобильного сплит-блока KPI. */
function SplitMetric({
  icon,
  label,
  value,
  delta,
}: {
  icon: JSX.Element;
  label: string;
  value: React.ReactNode;
  delta: number;
}) {
  return (
    <div className="flex-1 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        <p className="text-[12px] leading-tight text-text-muted">{label}</p>
      </div>
      <p className="mt-2 text-[22px] font-semibold leading-none text-text-primary">{value}</p>
      <div className="mt-2">
        <TrendPill value={delta} />
      </div>
    </div>
  );
}

/* ---------- Панель и компактная таблица ---------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-4">
      <h3 className="mb-3 text-base font-semibold text-text-primary">{title}</h3>
      {children}
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
  rows: string[][];
  footer?: string[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">{empty}</p>;
  }
  const cellAlign = (i: number) => (columns[i]?.align === 'right' ? 'text-right' : 'text-left');
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-text-muted">
          {columns.map((c, i) => (
            <th key={c.label} className={`pb-2 font-medium ${cellAlign(i)}`}>
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
                className={`py-2 ${cellAlign(ci)} ${ci === 0 ? 'font-medium text-text-primary' : 'text-text-secondary'}`}
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
              <td
                key={ci}
                className={`pt-2 font-semibold text-text-primary ${cellAlign(ci)}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function TrendPill({ value }: { value: number }) {
  const flat = value === 0;
  const positive = value > 0;
  const cls = flat
    ? 'bg-background text-text-muted'
    : positive
      ? 'bg-success/10 text-success'
      : 'bg-danger/10 text-danger';
  return (
    <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold leading-none ${cls}`}>
      {!flat && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" className={positive ? '' : 'rotate-180'}>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      )}
      {positive ? '+' : ''}{value}%
    </span>
  );
}

/* ---------- График выручки ---------- */

function RevenueChart({ data }: { data: { label: string; amount: number }[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  // Адаптивный viewBox 1:1 к реальной ширине — подписи читаемы на любом экране.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(280, Math.round(width));
  // Компактная высота на мобильном, чуть выше на десктопе.
  const H = W < 480 ? 246 : 292;
  const padL = 50;
  const padR = 18;
  const padT = 20;
  const padB = 36;

  const n = data.length;
  if (n === 0) return <p className="py-20 text-center text-text-muted">Нет данных за период</p>;

  const max = Math.max(1, ...data.map((p) => p.amount));
  const niceMax = niceCeil(max);
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB);

  const pts = data.map((p, i) => [x(i), y(p.amount)] as const);
  const line = smoothPath(pts);
  const area = `${line} L ${x(n - 1)} ${H - padB} L ${x(0)} ${H - padB} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(niceMax * t));

  // Подписи по оси X — прореживаем, чтобы не наезжали (на узком экране реже).
  const maxLabels = W < 480 ? 5 : 7;
  const step = Math.max(1, Math.ceil(n / maxLabels));
  const xLabelIdx = data.map((_, i) => i).filter((i) => i % step === 0);
  // Последнюю метку добавляем, только если она не вплотную к предыдущей.
  const lastIdx = n - 1;
  if (lastIdx - (xLabelIdx[xLabelIdx.length - 1] ?? 0) >= step) xLabelIdx.push(lastIdx);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(x(i) - vbX);
      if (dist < best) { best = dist; nearest = i; }
    }
    setHover(nearest);
  }

  const hi = hover != null ? data[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="revenue-chart-svg touch-none overflow-visible"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#005BFF" stopOpacity="0.18" />
            <stop offset="58%" stopColor="#005BFF" stopOpacity="0.055" />
            <stop offset="100%" stopColor="#005BFF" stopOpacity="0" />
          </linearGradient>
          <filter id="rev-active-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0.356 0 0 0 0 1 0 0 0 0.24 0"
            />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Сетка + подписи значений */}
        {ticks.map((t) => {
          const yy = y(t);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="#F1F5F9" strokeWidth="0.8" />
              <text x={padL - 12} y={yy + 4} textAnchor="end" className="fill-text-light text-[11px] font-medium">
                {shortMoney(t)}
              </text>
            </g>
          );
        })}

        {/* Область + линия */}
        <path d={area} fill="url(#rev-fill)" className="revenue-area" />
        <path
          d={line}
          fill="none"
          stroke="#005BFF"
          strokeWidth="2.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="revenue-line"
        />

        {/* Подписи по оси X */}
        {xLabelIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="fill-text-light text-[11px] font-medium">
            {formatAxisLabel(data[i].label)}
          </text>
        ))}

        {/* Hover: crosshair + точка */}
        {hi && hover != null && (
          <g className="revenue-active-point">
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#D8E2F0" strokeWidth="0.9" strokeDasharray="3 6" />
            <circle cx={x(hover)} cy={y(hi.amount)} r="9" fill="#005BFF" opacity="0.1" />
            <circle cx={x(hover)} cy={y(hi.amount)} r="5.4" fill="#fff" stroke="#005BFF" strokeWidth="2.6" filter="url(#rev-active-glow)" />
          </g>
        )}
      </svg>

      {/* Тултип */}
      {hi && hover != null && (
        <div
          className="revenue-tooltip pointer-events-none absolute z-10 -translate-x-1/2 rounded-xl border border-[#E6ECF5] bg-white px-3.5 py-2.5 shadow-[0_16px_36px_rgba(15,23,42,0.12),0_2px_8px_rgba(15,23,42,0.06)]"
          style={{ left: `clamp(76px, ${(x(hover) / W) * 100}%, calc(100% - 76px))`, top: `${(y(hi.amount) / H) * 100}%`, transform: 'translate(-50%, calc(-100% - 14px))' }}
        >
          <p className="whitespace-nowrap text-[11px] font-medium leading-none text-text-muted">{formatTooltipLabel(hi.label)}</p>
          <p className="mt-1.5 whitespace-nowrap text-[15px] font-semibold leading-none text-text-primary">{money(hi.amount)}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Утилиты ---------- */

/** Сглаженный путь (monotone cubic) по точкам. */
function smoothPath(pts: readonly (readonly [number, number])[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function shortMoney(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1000) return `${trim(value / 1000)}k`;
  return String(value);
}
function trim(n: number) {
  return Number(n.toFixed(1)).toString();
}

function nextHourLabel(hour: string) {
  const value = Number(hour.slice(0, 2));
  return `${String((value + 1) % 24).padStart(2, '0')}:00`;
}

/** Короткая подпись оси: "12:00" | "6 июн" | "июн 26". Без Invalid Date. */
function formatAxisLabel(raw: string): string {
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}T00:00:00`);
    return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}-01T00:00:00`);
    return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
  }
  return raw;
}

/** Полная подпись для тултипа. */
function formatTooltipLabel(raw: string): string {
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}T00:00:00`);
    return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}-01T00:00:00`);
    return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }
  return raw;
}
