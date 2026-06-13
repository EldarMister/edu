import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import type { PaymentMethod } from '@/types';
import { IconCard, IconCash, IconCheck, IconOrders, IconQr } from '../components/icons';
import { useStatistics, type StatsPeriod } from '../api';
import { usePublicSettings } from '@/features/settings/api';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
  { value: 'custom', label: 'Период' },
];

const METHOD_META: Record<PaymentMethod, { label: string; bar: string; tone: string; icon: JSX.Element }> = {
  qr: { label: 'QR-код', bar: 'bg-primary', tone: 'bg-primary/10 text-primary', icon: <IconQr /> },
  cash: { label: 'Наличные', bar: 'bg-success', tone: 'bg-success/10 text-success', icon: <IconCash /> },
  card: { label: 'Карта', bar: 'bg-warning', tone: 'bg-warning/10 text-warning', icon: <IconCard /> },
  // Смешанная в статистике раскладывается на наличные/QR на бэке, отдельной строкой не выводится.
  mixed: { label: 'Смешанная', bar: 'bg-primary', tone: 'bg-primary/10 text-primary', icon: <IconQr /> },
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
    <div className="space-y-5 overflow-x-hidden">
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
            <MetricCard icon={<IconOrders />} label="Заказов сегодня" value={d.cards.ordersToday} delta={d.trends.orders} />
            <MetricCard icon={<IconCheck />} label="Средний чек" value={money(d.cards.avgCheck)} delta={d.trends.avgCheck} />
          </div>

          {/* Метрики: мобильный — единый сплит-блок (2 показателя) */}
          <div className="card flex divide-x divide-border lg:hidden">
            <SplitMetric icon={<IconOrders />} label="Заказов сегодня" value={d.cards.ordersToday} delta={d.trends.orders} />
            <SplitMetric icon={<IconCheck />} label="Средний чек" value={money(d.cards.avgCheck)} delta={d.trends.avgCheck} />
          </div>

          {/* График — главный элемент */}
          <section className="card p-4 sm:p-6">
            <div className="mb-3 flex items-start justify-between gap-3 sm:mb-5">
              <div>
                <h3 className="text-[14px] font-medium text-text-muted">Выручка за период</h3>
                <div className="mt-1 flex flex-wrap items-center gap-2.5">
                  <span className="text-[32px] font-bold leading-none text-text-primary sm:text-[28px] sm:font-semibold">
                    {money(d.cards.revenuePeriod)}
                  </span>
                  <TrendPill value={d.trends.revenue} />
                </div>
              </div>
              <div className="hidden text-right text-sm text-text-muted sm:block">
                {d.cards.ordersPeriod} заказов
              </div>
            </div>
            <RevenueChart data={d.revenueSeries} />
          </section>

          {/* Аналитические блоки */}
          <div className="grid gap-4 xl:grid-cols-3">
            <PaymentMethodsCard methods={visiblePaymentMethods} />
            <Leaderboard
              title="Топ блюд"
              items={d.topDishes.map((x) => ({ name: x.name, sub: `${x.count} заказов`, amount: x.amount }))}
              empty="Нет продаж за период"
            />
            <Leaderboard
              title="Лучшие официанты"
              withAvatar
              items={d.topWaiters.map((x) => ({ name: x.name, sub: `${x.orders} заказов`, amount: x.amount }))}
              empty="Нет данных за период"
            />
          </div>
        </>
      )}
    </div>
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

function TrendPill({ value }: { value: number }) {
  const flat = value === 0;
  const positive = value > 0;
  const cls = flat
    ? 'bg-background text-text-muted'
    : positive
      ? 'bg-success/10 text-success'
      : 'bg-danger/10 text-danger';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${cls}`}>
      {!flat && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={positive ? '' : 'rotate-180'}>
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
  const H = W < 480 ? 240 : 280;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 30;

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
        className="touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#005BFF" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#005BFF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Сетка + подписи значений */}
        {ticks.map((t) => {
          const yy = y(t);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="#EEF2F7" strokeWidth="1" />
              <text x={padL - 10} y={yy + 4} textAnchor="end" className="fill-text-light text-[12px]">
                {shortMoney(t)}
              </text>
            </g>
          );
        })}

        {/* Область + линия */}
        <path d={area} fill="url(#rev-fill)" />
        <path d={line} fill="none" stroke="#005BFF" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Подписи по оси X */}
        {xLabelIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-text-light text-[12px]">
            {formatAxisLabel(data[i].label)}
          </text>
        ))}

        {/* Hover: crosshair + точка */}
        {hi && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#CBD5E1" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx={x(hover)} cy={y(hi.amount)} r="5" fill="#fff" stroke="#005BFF" strokeWidth="3" />
          </g>
        )}
      </svg>

      {/* Тултип */}
      {hi && hover != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-white px-3 py-2 shadow-card"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hi.amount) / H) * 100}%`, transform: 'translate(-50%, calc(-100% - 12px))' }}
        >
          <p className="whitespace-nowrap text-[11px] text-text-muted">{formatTooltipLabel(hi.label)}</p>
          <p className="whitespace-nowrap text-sm font-semibold text-text-primary">{money(hi.amount)}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Способы оплаты ---------- */

function PaymentMethodsCard({ methods }: { methods: { method: PaymentMethod; amount: number; percent: number }[] }) {
  const total = methods.reduce((s, m) => s + m.amount, 0);
  return (
    <section className="card p-5 sm:p-6">
      <h3 className="mb-5 text-[15px] font-semibold text-text-primary">Способы оплаты</h3>
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">Нет оплат за период</p>
      ) : (
        <div className="space-y-4">
          {methods.map((m) => {
            const meta = METHOD_META[m.method];
            return (
              <div key={m.method}>
                <div className="mb-1.5 flex items-center gap-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                    {meta.icon}
                  </span>
                  <span className="text-sm font-medium text-text-primary">{meta.label}</span>
                  <span className="ml-auto text-sm font-semibold text-text-primary">{m.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background">
                  <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${m.percent}%` }} />
                </div>
                <p className="mt-1 text-right text-xs text-text-muted">{money(m.amount)}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- Рейтинги ---------- */

const RANK_TONE = ['bg-amber-100 text-amber-600', 'bg-slate-200 text-slate-600', 'bg-orange-100 text-orange-500'];

function Leaderboard({
  title,
  items,
  empty,
  withAvatar = false,
}: {
  title: string;
  items: { name: string; sub: string; amount: number }[];
  empty: string;
  withAvatar?: boolean;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <h3 className="mb-4 text-[15px] font-semibold text-text-primary">{title}</h3>
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li
              key={`${it.name}-${i}`}
              className={`flex items-center gap-3 rounded-xl px-2 py-2 ${i === 0 ? 'bg-primary/5' : ''}`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                  RANK_TONE[i] ?? 'bg-background text-text-muted'
                }`}
              >
                {i + 1}
              </span>
              {withAvatar && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {it.name[0] ?? '?'}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${i === 0 ? 'font-semibold' : 'font-medium'} text-text-primary`}>
                  {it.name}
                </p>
                <p className="text-xs text-text-muted">{it.sub}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">{money(it.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
