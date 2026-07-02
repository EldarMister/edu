import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { colors, fontSize, radius, spacing } from '@/theme';
import { money } from '@/utils/format';
import { PwaIcon } from '@/components/PwaIcon';
import { FastPressable } from '@/components/FastPressable';
import type { PaymentMethod } from '@/types';
import { useStatistics, type StatsDashboard, type StatsPeriod } from '@/services/api/admin';
import { usePublicSettings } from '@/services/api/settings';

// Кастомный период (выбор дат) на mobile пока не портирован — пресеты покрывают основное.
const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
];

const ORDERS_LABEL: Record<StatsPeriod, string> = {
  today: 'Заказов сегодня',
  week: 'Заказов за неделю',
  month: 'Заказов за месяц',
  all: 'Заказов за всё время',
  custom: 'Заказов за период',
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  qr: 'QR-код',
  cash: 'Наличные',
  card: 'Карта',
  mixed: 'Смешанная',
};

/** Статистика владельца — порт PWA StatisticsPage. */
export function StatisticsScreen() {
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const statsQ = useStatistics({ period });
  const publicSettingsQ = usePublicSettings();
  const d = statsQ.data;

  const visiblePaymentMethods = useMemo(() => {
    if (!d) return [] as { method: Extract<PaymentMethod, 'qr' | 'cash' | 'card'>; amount: number }[];
    const enabled = (publicSettingsQ.data?.paymentMethods ?? d.paymentMethods.map((m) => m.method)).filter(
      (method): method is Extract<PaymentMethod, 'qr' | 'cash' | 'card'> =>
        method === 'qr' || method === 'cash' || method === 'card',
    );
    return enabled.map(
      (method) => d.paymentMethods.find((item) => item.method === method) ?? { method, amount: 0, percent: 0 },
    );
  }, [d, publicSettingsQ.data]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.periodTabs}>
        {PERIODS.map((p) => {
          const active = period === p.value;
          return (
            <FastPressable
              key={p.value}
              onPress={() => setPeriod(p.value)}
              style={[styles.periodTab, active && styles.periodTabActive]}
            >
              <Text style={[styles.periodTabText, active && styles.periodTabTextActive]}>{p.label}</Text>
            </FastPressable>
          );
        })}
      </View>

      {statsQ.isLoading || !d ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <>
          {/* KPI — сплит-блок из двух показателей */}
          <View style={styles.splitCard}>
            <SplitMetric icon="list" label={ORDERS_LABEL[period]} value={String(d.cards.ordersPeriod)} delta={d.trends.orders} />
            <View style={styles.splitDivider} />
            <SplitMetric icon="check" label="Средний чек" value={money(d.cards.avgCheck)} delta={d.trends.avgCheck} />
          </View>

          {/* График выручки */}
          <View style={styles.panel}>
            <View style={styles.panelHeadRow}>
              <Text style={styles.panelTitle}>Выручка за период</Text>
              <Text style={styles.panelMeta}>{d.cards.ordersPeriod} заказов</Text>
            </View>
            <RevenueChart data={d.revenueSeries} />
          </View>

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
        </>
      )}
    </ScrollView>
  );
}

/* ---------- KPI ---------- */

function SplitMetric({
  icon,
  label,
  value,
  delta,
}: {
  icon: 'list' | 'check';
  label: string;
  value: string;
  delta: number;
}) {
  return (
    <View style={styles.splitHalf}>
      <View style={styles.splitTop}>
        <View style={styles.splitIcon}>
          <PwaIcon name={icon} size={16} color={colors.primary} strokeWidth={2} />
        </View>
        <Text style={styles.splitLabel}>{label}</Text>
      </View>
      <Text style={styles.splitValue}>{value}</Text>
      <TrendPill value={delta} />
    </View>
  );
}

function TrendPill({ value }: { value: number }) {
  const flat = value === 0;
  const positive = value > 0;
  const bg = flat ? colors.background : positive ? colors.successSoft : colors.dangerSoft;
  const fg = flat ? colors.textMuted : positive ? colors.success : colors.danger;
  return (
    <View style={[styles.trendPill, { backgroundColor: bg }]}>
      {!flat ? <Text style={[styles.trendArrow, { color: fg }]}>{positive ? '↑' : '↓'}</Text> : null}
      <Text style={[styles.trendText, { color: fg }]}>
        {positive ? '+' : ''}
        {value}%
      </Text>
    </View>
  );
}

/* ---------- Панель и таблица ---------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
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
  if (rows.length === 0) return <Text style={styles.tableEmpty}>{empty}</Text>;
  const cellStyle = (i: number, kind: 'head' | 'first' | 'rest') => [
    styles.cell,
    columns[i]?.align === 'right' ? styles.cellRight : styles.cellLeft,
    kind === 'head' ? styles.cellHead : kind === 'first' ? styles.cellPrimary : styles.cellSecondary,
  ];
  const colFlex = (i: number) => (i === 0 ? styles.colGrow : styles.colAuto);
  return (
    <View style={{ marginTop: spacing.sm }}>
      <View style={[styles.row, styles.rowHead]}>
        {columns.map((c, i) => (
          <View key={c.label} style={colFlex(i)}>
            <Text style={cellStyle(i, 'head')}>{c.label}</Text>
          </View>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={[styles.row, ri < rows.length - 1 && styles.rowBorder]}>
          {r.map((cell, ci) => (
            <View key={ci} style={colFlex(ci)}>
              <Text style={cellStyle(ci, ci === 0 ? 'first' : 'rest')}>{cell}</Text>
            </View>
          ))}
        </View>
      ))}
      {footer ? (
        <View style={[styles.row, styles.rowFooter]}>
          {footer.map((cell, ci) => (
            <View key={ci} style={colFlex(ci)}>
              <Text style={[cellStyle(ci, ci === 0 ? 'first' : 'rest'), styles.cellFooter]}>{cell}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ---------- График выручки (SVG) ---------- */

function RevenueChart({ data }: { data: StatsDashboard['revenueSeries'] }) {
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const widthRef = useRef(320);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) {
      widthRef.current = w;
      setWidth(w);
    }
  };

  const n = data.length;
  const W = Math.max(280, Math.round(width));
  const H = 246;
  const padL = 50;
  const padR = 18;
  const padT = 20;
  const padB = 36;

  const max = Math.max(1, ...data.map((p) => p.amount));
  const niceMax = niceCeil(max);
  const xAt = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const yAt = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => updateHover(e.nativeEvent.locationX),
      onPanResponderMove: (e) => updateHover(e.nativeEvent.locationX),
      onPanResponderRelease: () => setHover(null),
      onPanResponderTerminate: () => setHover(null),
    }),
  ).current;

  function updateHover(locationX: number) {
    const w = widthRef.current;
    const count = data.length;
    if (count === 0 || w <= 0) return;
    const vbX = (locationX / w) * Math.max(280, Math.round(w));
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      const dist = Math.abs(padL + (i * (Math.max(280, Math.round(w)) - padL - padR)) / Math.max(1, count - 1) - vbX);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    setHover(nearest);
  }

  if (n === 0) return <Text style={styles.tableEmpty}>Нет данных за период</Text>;

  const pts = data.map((p, i) => [xAt(i), yAt(p.amount)] as const);
  const line = smoothPath(pts);
  const area = `${line} L ${xAt(n - 1)} ${H - padB} L ${xAt(0)} ${H - padB} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(niceMax * t));

  const maxLabels = 5;
  const step = Math.max(1, Math.ceil(n / maxLabels));
  const xLabelIdx = data.map((_, i) => i).filter((i) => i % step === 0);
  const lastIdx = n - 1;
  if (lastIdx - (xLabelIdx[xLabelIdx.length - 1] ?? 0) >= step) xLabelIdx.push(lastIdx);

  const hi = hover != null ? data[hover] : null;
  const tipW = 120;
  const tipLeft = hover != null ? Math.min(Math.max(xAt(hover) - tipW / 2, 4), W - tipW - 4) : 0;
  const tipTop = hi != null ? Math.max(yAt(hi.amount) - 62, 0) : 0;

  return (
    <View style={{ width: '100%' }} onLayout={onLayout} {...pan.panHandlers}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#005BFF" stopOpacity="0.18" />
            <Stop offset="58%" stopColor="#005BFF" stopOpacity="0.055" />
            <Stop offset="100%" stopColor="#005BFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {ticks.map((tk) => {
          const yy = yAt(tk);
          return (
            <G key={tk}>
              <Line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="#F1F5F9" strokeWidth={0.8} />
              <SvgText x={padL - 12} y={yy + 4} textAnchor="end" fontSize={11} fill={colors.textLight}>
                {shortMoney(tk)}
              </SvgText>
            </G>
          );
        })}

        <Path d={area} fill="url(#rev-fill)" />
        <Path d={line} fill="none" stroke="#005BFF" strokeWidth={2.8} strokeLinejoin="round" strokeLinecap="round" />

        {xLabelIdx.map((i) => (
          <SvgText key={i} x={xAt(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={colors.textLight}>
            {formatAxisLabel(data[i].label)}
          </SvgText>
        ))}

        {hi && hover != null ? (
          <G>
            <Line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={padT}
              y2={H - padB}
              stroke="#D8E2F0"
              strokeWidth={0.9}
              strokeDasharray="3 6"
            />
            <Circle cx={xAt(hover)} cy={yAt(hi.amount)} r={9} fill="#005BFF" opacity={0.1} />
            <Circle cx={xAt(hover)} cy={yAt(hi.amount)} r={5.4} fill="#fff" stroke="#005BFF" strokeWidth={2.6} />
          </G>
        ) : null}
      </Svg>

      {hi && hover != null ? (
        <View style={[styles.tooltip, { left: tipLeft, top: tipTop, width: tipW }]} pointerEvents="none">
          <Text style={styles.tooltipLabel} numberOfLines={1}>
            {formatTooltipLabel(hi.label)}
          </Text>
          <Text style={styles.tooltipValue} numberOfLines={1}>
            {money(hi.amount)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ---------- Утилиты ---------- */

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
function trim(nm: number) {
  return Number(nm.toFixed(1)).toString();
}

function nextHourLabel(hour: string) {
  const value = Number(hour.slice(0, 2));
  return `${String((value + 1) % 24).padStart(2, '0')}:00`;
}

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

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  loading: { paddingVertical: 60, alignItems: 'center' },

  periodTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 4,
  },
  periodTab: { flexGrow: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  periodTabActive: {
    backgroundColor: colors.white,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  periodTabText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted },
  periodTabTextActive: { color: colors.primary },

  splitCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
  },
  splitDivider: { width: 1, backgroundColor: colors.border },
  splitHalf: { flex: 1, padding: spacing.md },
  splitTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  splitIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitLabel: { flex: 1, fontSize: 12, color: colors.textMuted },
  splitValue: { marginTop: spacing.sm, fontSize: 22, fontWeight: '600', color: colors.textPrimary },
  trendPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
  },
  trendArrow: { fontSize: 12, fontWeight: '700' },
  trendText: { fontSize: 12, fontWeight: '700' },

  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  panelHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  panelTitle: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  panelMeta: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, marginBottom: spacing.md },

  tableEmpty: { paddingVertical: spacing.xl, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  rowHead: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowFooter: { borderTopWidth: 1, borderTopColor: colors.border },
  colGrow: { flex: 1, minWidth: 0 },
  colAuto: { flexShrink: 0 },
  cell: { fontSize: fontSize.sm },
  cellLeft: { textAlign: 'left' },
  cellRight: { textAlign: 'right' },
  cellHead: { fontSize: fontSize.xs, fontWeight: '500', color: colors.textMuted },
  cellPrimary: { fontWeight: '500', color: colors.textPrimary },
  cellSecondary: { color: colors.textSecondary },
  cellFooter: { fontWeight: '700', color: colors.textPrimary },

  tooltip: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: '#E6ECF5',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  tooltipLabel: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  tooltipValue: { marginTop: 4, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
});
