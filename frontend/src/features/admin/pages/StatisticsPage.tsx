import { useMemo, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import type { PaymentMethod } from '@/types';
import {
  IconCard,
  IconCash,
  IconCheck,
  IconMoney,
  IconOrders,
  IconQr,
} from '../components/icons';
import { useStatistics, type StatsPeriod } from '../api';

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'За сегодня' },
  { value: 'week', label: 'За неделю' },
  { value: 'month', label: 'За месяц' },
  { value: 'all', label: 'За все время' },
  { value: 'custom', label: 'Свой период' },
];

const METHOD_META: Record<PaymentMethod, { label: string; tone: string; icon: JSX.Element }> = {
  qr: { label: 'QR', tone: 'bg-primary/10 text-primary', icon: <IconQr /> },
  cash: { label: 'Наличные', tone: 'bg-success/10 text-success', icon: <IconCash /> },
  card: { label: 'Карта', tone: 'bg-orange-100 text-orange-500', icon: <IconCard /> },
};

export function StatisticsPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const weekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  }, []);
  const [period, setPeriod] = useState<StatsPeriod>('today');
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const statsQ = useStatistics({ period, from: period === 'custom' ? from : undefined, to: period === 'custom' ? to : undefined });
  const d = statsQ.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`shrink-0 rounded-2xl px-5 py-2.5 text-sm font-medium transition-colors ${
                period === p.value
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-secondary hover:bg-white hover:text-primary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="input h-10 w-[150px]" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-sm text-text-muted">-</span>
            <input className="input h-10 w-[150px]" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      </div>

      {statsQ.isLoading || !d ? (
        <div className="flex justify-center py-16 text-primary">
          <Spinner className="h-7 w-7" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <MetricCard
              icon={<IconMoney />}
              label="Выручка сегодня"
              value={money(d.cards.revenueToday)}
              delta={d.trends.revenue}
              tone="primary"
            />
            <MetricCard
              icon={<IconOrders />}
              label="Заказов сегодня"
              value={d.cards.ordersToday}
              delta={d.trends.orders}
              tone="primary"
            />
            <MetricCard
              icon={<IconCheck />}
              label="Средний чек"
              value={money(d.cards.avgCheck)}
              delta={d.trends.avgCheck}
              tone="primary"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]">
            <section className="card p-6">
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">Выручка</h3>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <span className="text-2xl font-semibold text-text-primary">{money(d.cards.revenuePeriod)}</span>
                    <Trend value={d.trends.revenue} suffix="к прошлому периоду" />
                  </div>
                </div>
                <select
                  className="input h-11 w-full rounded-xl bg-white sm:w-44"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as StatsPeriod)}
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <RevenueChart data={d.revenueSeries} />
            </section>

            <section className="card p-6">
              <h3 className="mb-8 text-lg font-semibold text-text-primary">Способы оплаты</h3>
              <div className="space-y-0">
                {d.paymentMethods.map((m) => (
                  <PaymentRow key={m.method} method={m.method} amount={m.amount} percent={m.percent} />
                ))}
              </div>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Leaderboard
              title="Топ блюд"
              accent="primary"
              items={d.topDishes.map((x) => ({ name: x.name, sub: `${x.count} заказов`, amount: x.amount }))}
              empty="Нет продаж за период"
            />
            <Leaderboard
              title="Лучшие официанты"
              accent="warning"
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
  tone: 'primary';
}) {
  return (
    <div className="card flex min-h-[138px] items-center gap-5 rounded-2xl p-6">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[15px] text-text-secondary">{label}</p>
        <p className="mt-2 text-3xl font-semibold leading-none text-text-primary">{value}</p>
        <div className="mt-4">
          <Trend value={delta} suffix="к прошлому периоду" />
        </div>
      </div>
    </div>
  );
}

function Trend({ value, suffix }: { value: number; suffix: string }) {
  const positive = value >= 0;
  return (
    <span className={`text-sm font-medium ${positive ? 'text-primary' : 'text-danger'}`}>
      {positive ? '↑' : '↓'} {Math.abs(value)}% {suffix}
    </span>
  );
}

function RevenueChart({ data }: { data: { label: string; amount: number }[] }) {
  const W = 760;
  const H = 280;
  const padX = 46;
  const padY = 24;
  const max = Math.max(1, ...data.map((d) => d.amount));
  const n = data.length;
  if (n === 0) return <p className="py-20 text-center text-text-muted">Нет данных</p>;

  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(1, n - 1);
  const y = (v: number) => H - padY - (v / max) * (H - padY * 2);
  const points = data.map((d, i) => [x(i), y(d.amount)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - padY} L ${x(0).toFixed(1)} ${H - padY} Z`;
  const peak = data.reduce((a, b) => (b.amount > a.amount ? b : a), data[0]);
  const peakIdx = data.indexOf(peak);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((v) => Math.round(max * v));

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[300px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="stats-revenue-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#005BFF" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#005BFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const yy = y(tick);
          return (
            <g key={tick}>
              <line x1={padX} x2={W - padX} y1={yy} y2={yy} stroke="#E2E8F0" strokeWidth="1" />
              <text x="0" y={yy + 4} className="fill-text-muted text-[12px]">{shortMoney(tick)}</text>
            </g>
          );
        })}
        <path d={area} fill="url(#stats-revenue-fill)" />
        <path d={line} fill="none" stroke="#005BFF" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {peak.amount > 0 && (
          <>
            <circle cx={x(peakIdx)} cy={y(peak.amount)} r="5" fill="#fff" stroke="#005BFF" strokeWidth="3" />
            <foreignObject x={Math.max(padX, x(peakIdx) - 44)} y={Math.max(8, y(peak.amount) - 66)} width="96" height="58">
              <div className="rounded-lg bg-white px-3 py-2 text-sm shadow-soft">
                <p className="text-text-secondary">{data[peakIdx].label}</p>
                <p className="font-semibold text-text-primary">{money(peak.amount)}</p>
              </div>
            </foreignObject>
          </>
        )}
      </svg>
      <div className="ml-10 mt-1 flex justify-between text-xs text-text-muted">
        <span>{data[0].label}</span>
        <span>{data[Math.floor((n - 1) / 2)]?.label}</span>
        <span>{data[n - 1].label}</span>
      </div>
    </div>
  );
}

function PaymentRow({ method, amount, percent }: { method: PaymentMethod; amount: number; percent: number }) {
  const meta = METHOD_META[method];
  return (
    <div className="flex items-center gap-4 border-b border-border py-6 last:border-0">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-primary">{meta.label}</p>
      </div>
      <div className="text-right">
        <p className="text-2xl font-medium text-text-primary">{percent}%</p>
        <p className="text-sm text-text-muted">{money(amount)}</p>
      </div>
    </div>
  );
}

function Leaderboard({
  title,
  items,
  empty,
  withAvatar = false,
  accent,
}: {
  title: string;
  items: { name: string; sub: string; amount: number }[];
  empty: string;
  withAvatar?: boolean;
  accent: 'primary' | 'warning';
}) {
  return (
    <section className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        <span className={accent === 'warning' ? 'text-warning' : 'text-text-muted'}>{accent === 'warning' ? '♕' : '♨'}</span>
      </div>
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it, i) => (
            <li key={`${it.name}-${i}`} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {withAvatar && (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                      {it.name[0] ?? '?'}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-primary">{it.name}</p>
                    <p className="text-sm text-text-muted">{it.sub}</p>
                  </div>
                </div>
              </div>
              <span className="font-semibold text-text-primary">{money(it.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <button className="mt-5 text-sm font-medium text-primary">Весь список</button>
    </section>
  );
}

function shortMoney(value: number) {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
