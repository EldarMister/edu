import { useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { StatCard, StatCardsRow } from '../components/StatCard';
import { IconMoney, IconOrders, IconCheck } from '../components/icons';
import { useStatistics } from '../api';
import type { PaymentMethod } from '@/types';

const PERIODS: { value: 'week' | 'month' | 'year'; label: string }[] = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];
const METHOD_LABEL: Record<PaymentMethod, string> = { qr: 'QR-код', cash: 'Наличные', card: 'Карта' };
const METHOD_COLOR: Record<PaymentMethod, string> = {
  qr: 'bg-primary',
  cash: 'bg-success',
  card: 'bg-warning',
};

export function StatisticsPage() {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');
  const statsQ = useStatistics(period);
  const d = statsQ.data;
  const t = useT();

  return (
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard
          label={t('Выручка сегодня')}
          value={d ? money(d.cards.revenueToday) : '—'}
          icon={<IconMoney />}
          tone="primary"
        />
        <StatCard
          label={t('Заказов сегодня')}
          value={d?.cards.ordersToday ?? '—'}
          icon={<IconOrders />}
          tone="warning"
        />
        <StatCard
          label={t('Средний чек')}
          value={d ? money(d.cards.avgCheck) : '—'}
          icon={<IconCheck />}
          tone="success"
        />
        <StatCard
          label={`${t('Выручка')} ${t(period === 'week' ? 'за неделю' : period === 'year' ? 'за год' : 'за месяц')}`}
          value={d ? money(d.cards.revenuePeriod) : '—'}
          icon={<IconMoney />}
          tone="muted"
        />
      </StatCardsRow>

      {statsQ.isLoading || !d ? (
        <div className="flex justify-center py-16 text-primary">
          <Spinner className="h-7 w-7" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* График выручки */}
          <div className="card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-text-primary">{t('Выручка')}</h3>
              <div className="flex gap-1 rounded-lg bg-background p-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPeriod(p.value)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      period === p.value ? 'bg-white text-primary shadow-sm' : 'text-text-muted'
                    }`}
                  >
                    {t(p.label)}
                  </button>
                ))}
              </div>
            </div>
            <RevenueChart data={d.revenueSeries} />
          </div>

          {/* Способы оплаты */}
          <div className="card p-5">
            <h3 className="mb-4 text-[15px] font-semibold text-text-primary">{t('Способы оплаты')}</h3>
            <div className="space-y-4">
              {d.paymentMethods.map((m) => (
                <div key={m.method}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-text-secondary">{t(METHOD_LABEL[m.method])}</span>
                    <span className="font-medium text-text-primary">{m.percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-background">
                    <div className={`h-full rounded-full ${METHOD_COLOR[m.method]}`} style={{ width: `${m.percent}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{money(m.amount)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Топ блюд */}
          <div className="card p-5 lg:col-span-1">
            <h3 className="mb-4 text-[15px] font-semibold text-text-primary">{t('Топ блюд')}</h3>
            <RankList
              items={d.topDishes.map((x) => ({ name: x.name, sub: `${x.count} шт.`, amount: x.amount }))}
              empty="Нет продаж за период"
            />
          </div>

          {/* Лучшие официанты */}
          <div className="card p-5 lg:col-span-2">
            <h3 className="mb-4 text-[15px] font-semibold text-text-primary">{t('Лучшие официанты')}</h3>
            <RankList
              items={d.topWaiters.map((x) => ({ name: x.name, sub: `${x.orders} заказов`, amount: x.amount }))}
              empty="Нет данных за период"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RevenueChart({ data }: { data: { date: string; amount: number }[] }) {
  const W = 600;
  const H = 200;
  const pad = 8;
  const max = Math.max(1, ...data.map((d) => d.amount));
  const n = data.length;
  if (n === 0) return <p className="py-12 text-center text-text-muted">Нет данных</p>;

  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, n - 1);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.amount).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;
  const peak = data.reduce((a, b) => (b.amount > a.amount ? b : a), data[0]);
  const peakIdx = data.indexOf(peak);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#005BFF" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#005BFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#rev)" />
        <path d={line} fill="none" stroke="#005BFF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {peak.amount > 0 && (
          <circle cx={x(peakIdx)} cy={y(peak.amount)} r="3.5" fill="#005BFF" stroke="#fff" strokeWidth="2" />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-text-light">
        <span>{fmtDate(data[0].date)}</span>
        <span className="font-medium text-text-secondary">пик: {money(peak.amount)}</span>
        <span>{fmtDate(data[n - 1].date)}</span>
      </div>
    </div>
  );
}

function RankList({
  items,
  empty,
}: {
  items: { name: string; sub: string; amount: number }[];
  empty: string;
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={it.name} className="flex items-center gap-3">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
              i === 0 ? 'bg-primary/10 text-primary' : 'bg-background text-text-muted'
            }`}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary">{it.name}</p>
            <p className="text-xs text-text-muted">{it.sub}</p>
          </div>
          <span className="text-sm font-semibold text-text-primary">{money(it.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}
