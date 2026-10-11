import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from '@/components/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FastPressable } from '@/components/FastPressable';
import { FullscreenSheet } from '@/components/FullscreenSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { DateField } from '@/components/DateField';
import { colors, fontSize, radius, spacing } from '@/theme';
import { money } from '@/utils/format';
import {
  useKitchenStats,
  type KitchenStats as KitchenStatsData,
  type KitchenStatsDish,
  type KitchenStatsPeriod,
} from '@/services/api/kitchen';
import type { PrepStation } from '@/types';

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

const PREPARED_LABEL: Record<KitchenStatsPeriod, string> = {
  today: 'Приготовлено сегодня',
  week: 'Приготовлено за неделю',
  month: 'Приготовлено за месяц',
  all: 'Приготовлено за всё время',
  custom: 'Приготовлено за период',
};

const minutes = (n: number) => `${n} мин`;
const PAGE_SIZE = 8;

function localDate(daysAgo = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDateRange(from: string, to: string): boolean {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4))
      && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10));
  };
  return valid(from) && valid(to) && from <= to;
}

function DateRangeFields({ from, to, onFrom, onTo }: {
  from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void;
}) {
  return <View style={{ gap: spacing.sm }}>
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <DateField label="С" accessibilityLabel="Начало периода" placeholder="ДД.ММ.ГГГГ" maxLength={10}
          value={from} onChangeText={onFrom} style={styles.searchInput} />
      </View>
      <View style={{ flex: 1 }}>
        <DateField label="По" accessibilityLabel="Конец периода" placeholder="ДД.ММ.ГГГГ" maxLength={10}
          value={to} onChangeText={onTo} style={styles.searchInput} />
      </View>
    </View>
    {!validDateRange(from, to) ? <Text style={{ color: colors.danger }} translate>Введите корректный период в формате ДД.ММ.ГГГГ.</Text> : null}
  </View>;
}

/** Полноэкранная статистика кухни — паритет с PWA KitchenStats. */
export function KitchenStatsSheet({
  visible,
  station,
  onClose,
  inline = false,
}: {
  visible: boolean;
  station: PrepStation;
  onClose: () => void;
  /** The PWA statistics tab keeps the station header and toolbar visible. */
  inline?: boolean;
}) {
  const [period, setPeriod] = useState<KitchenStatsPeriod>('today');
  const [longOpen, setLongOpen] = useState<'longest' | 'fastest' | null>(null);
  const [from, setFrom] = useState(() => localDate(6));
  const [to, setTo] = useState(() => localDate());
  const [preparedOpen, setPreparedOpen] = useState(false);
  const [hourlyOpen, setHourlyOpen] = useState(false);

  const rangeValid = period !== 'custom' || validDateRange(from, to);
  const statsQ = useKitchenStats({ period, ...(period === 'custom' ? { from, to } : {}) }, station, visible && rangeValid);
  const d = statsQ.data;

  const longest = useMemo(
    () => (d ? [...d.dishes].filter((x) => x.timed).sort((a, b) => b.avgMin - a.avgMin) : []),
    [d],
  );
  const fastest = useMemo(
    () => (d ? [...d.dishes].filter((x) => x.timed).sort((a, b) => a.avgMin - b.avgMin) : []),
    [d],
  );
  const preparedDishes = useMemo(() => (d ? [...d.dishes].sort((a, b) => b.count - a.count) : []), [d]);

  return (
    <StatsSurface inline={inline} visible={visible} onClose={onClose}>
      <SafeAreaView style={styles.screen} edges={inline ? [] : ['top', 'bottom']}>
        {!inline ? <View style={styles.header}>
          <Text style={styles.headerTitle} translate>Статистика</Text>
          <FastPressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <PwaIcon name="close" size={22} color={colors.textLight} />
          </FastPressable>
        </View> : null}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <PeriodTabs period={period} onChange={setPeriod} />
          {period === 'custom' ? <DateRangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} /> : null}

          {!rangeValid ? null : statsQ.isError ? (
            <Text style={styles.tableEmpty} translate>Не удалось загрузить статистику</Text>
          ) : statsQ.isLoading || !d ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <>
              {/* Inline-сводка */}
              <View style={styles.summary}>
                <Sum label="Приготовлено блюд" value={String(d.cards.prepared)} />
                <Sep />
                <Sum label="В среднем в день" value={`${d.prepared.avgPerDay} шт`} />
                <Sep />
                <Sum label="Максимум за день" value={`${d.prepared.maxPerDay} шт`} />
                <Sep />
                <Sum label="Отказов" value={String(d.cards.rejections)} />
                <Sep />
                <Sum label="Среднее время" value={d.cards.avgPrepMin > 0 ? minutes(d.cards.avgPrepMin) : '—'} />
              </View>

              <Panel title="Самые долгие блюда" onViewAll={longest.length ? () => setLongOpen('longest') : undefined}>
                <MiniTable
                  columns={[{ label: 'Блюдо' }, { label: 'Среднее время', align: 'right' }]}
                  rows={longest.slice(0, 6).map((x) => [x.name, minutes(x.avgMin)])}
                  empty="Нет данных за период"
                />
              </Panel>

              <Panel title="Самые быстрые блюда" onViewAll={fastest.length ? () => setLongOpen('fastest') : undefined}>
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

              <Panel title="Отказы по блюдам">
                <MiniTable
                  columns={[{ label: 'Блюдо' }, { label: 'Отказов', align: 'right' }]}
                  rows={d.rejections.slice(0, 6).map((x) => [x.name, String(x.count)])}
                  empty="Нет отказов за период"
                />
              </Panel>

              <View style={styles.panel}>
                <View style={styles.panelHeadRow}>
                  <Text style={styles.panelTitle} translate>Приготовлено по часам</Text>
                  <FastPressable onPress={() => setHourlyOpen(true)} hitSlop={6}>
                    <Text style={styles.linkText} translate>Смотреть детали</Text>
                  </FastPressable>
                </View>
                <HourlyChart data={d.hourly} height={200} />
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {longOpen && d ? (
        <LongestDishesModal dishes={longOpen === 'fastest' ? fastest : longest}
          title={longOpen === 'fastest' ? 'Самые быстрые блюда' : 'Самые долгие блюда'}
          periodLabel={period === 'custom' ? `${from} — ${to}` : PERIOD_LABEL[period]}
          onClose={() => setLongOpen(null)} />
      ) : null}
      {preparedOpen && d ? (
        <PreparedDishesModal
          dishes={preparedDishes}
          title={PREPARED_LABEL[period]}
          periodLabel={period === 'custom' ? `${from} — ${to}` : PERIOD_LABEL[period]}
          onClose={() => setPreparedOpen(false)}
        />
      ) : null}
      {hourlyOpen ? (
        <HourlyModal station={station} initialPeriod={period} initialFrom={from} initialTo={to}
          onClose={() => setHourlyOpen(false)} />
      ) : null}
    </StatsSurface>
  );
}

function StatsSurface({ inline, visible, onClose, children }: {
  inline: boolean; visible: boolean; onClose: () => void; children: React.ReactNode;
}) {
  return inline
    ? <View style={styles.screen}>{children}</View>
    : <FullscreenSheet visible={visible} onClose={onClose} style={styles.screen}>{children}</FullscreenSheet>;
}

/* ---------- Период ---------- */

function PeriodTabs({
  period,
  onChange,
}: {
  period: KitchenStatsPeriod;
  onChange: (p: KitchenStatsPeriod) => void;
}) {
  const { width } = useWindowDimensions();
  const narrow = width < 640;
  const tabWidth = (width - spacing.lg * 2 - 8 - 8) / 3;
  return (
    <View style={styles.periodTabs}>
      {PERIODS.map((p) => {
        const active = period === p.value;
        return (
          <FastPressable
            key={p.value}
            onPress={() => onChange(p.value)}
            style={[styles.periodTab, narrow && { width: tabWidth }, active && styles.periodTabActive]}
          >
            <Text style={[styles.periodTabText, active && styles.periodTabTextActive]} translate>{p.label}</Text>
          </FastPressable>
        );
      })}
    </View>
  );
}

/* ---------- Inline-сводка ---------- */

function Sum({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.sumText} translate>
      {label}: <Text style={styles.sumValue}>{value}</Text>
    </Text>
  );
}
function Sep() {
  return <Text style={styles.sumSep}>|</Text>;
}

/* ---------- Панель и таблица ---------- */

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
    <View style={styles.panel}>
      <Text style={styles.panelTitle} translate>{title}</Text>
      {children}
      {onViewAll ? (
        <FastPressable onPress={onViewAll} hitSlop={6} style={{ marginTop: spacing.md }}>
          <Text style={styles.linkText} translate>Смотреть все</Text>
        </FastPressable>
      ) : null}
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
  if (rows.length === 0) {
    return <Text style={styles.tableEmpty}>{empty}</Text>;
  }
  const cellStyle = (colIdx: number, isHead: boolean, isFirstCol: boolean) => [
    styles.cell,
    columns[colIdx]?.align === 'right' ? styles.cellRight : styles.cellLeft,
    isHead ? styles.cellHead : isFirstCol ? styles.cellPrimary : styles.cellSecondary,
  ];
  // Первая колонка тянется, числовые — по контенту.
  const colFlex = (i: number) => (i === 0 ? styles.colGrow : styles.colAuto);

  return (
    <View>
      <View style={[styles.row, styles.rowHead]}>
        {columns.map((c, i) => (
          <View key={c.label} style={colFlex(i)}>
            <Text style={cellStyle(i, true, i === 0)} translate>{c.label}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.row, ri < rows.length - 1 && styles.rowBorder]}>
          {row.map((cell, ci) => (
            <View key={ci} style={colFlex(ci)}>
              <Text style={cellStyle(ci, false, ci === 0)}>{cell}</Text>
            </View>
          ))}
        </View>
      ))}
      {footer ? (
        <View style={[styles.row, styles.rowFooter]}>
          {footer.map((cell, ci) => (
            <View key={ci} style={colFlex(ci)}>
              <Text style={[cellStyle(ci, false, ci === 0), styles.cellFooter]}>{cell}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ---------- График по часам ---------- */

function HourlyChart({ data, height }: { data: KitchenStatsData['hourly']; height: number }) {
  const max = Math.max(1, ...data.map((h) => h.count));
  if (!data.some((h) => h.count > 0)) {
    return <Text style={styles.tableEmpty} translate>Нет данных за период</Text>;
  }
  return (
    <View>
      <View style={[styles.chartRow, { height }]}>
        {data.map((h) => {
          const hPct = (h.count / max) * 100;
          return (
            <View key={h.hour} style={styles.chartCol}>
              {h.count > 0 ? <Text style={styles.chartValue}>{h.count}</Text> : null}
              <View
                style={[styles.chartBar, { height: `${h.count > 0 ? Math.max(4, hPct) : 0}%` }]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.chartLabels}>
        {data.map((h) => (
          <Text key={h.hour} style={styles.chartLabel}>
            {String(h.hour).padStart(2, '0')}
          </Text>
        ))}
      </View>
    </View>
  );
}

/* ---------- Детальные модалки ---------- */

function DetailModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  const close = React.useCallback(() => setOpen(false), []);
  const dismiss = React.useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <FullscreenSheet visible={open} onClose={close} onDismiss={dismiss} style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.headerTitle} translate>{title}</Text>
            {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
          </View>
          <FastPressable onPress={close} hitSlop={12} style={styles.closeBtn}>
            <PwaIcon name="close" size={22} color={colors.textLight} />
          </FastPressable>
        </View>
        {children}
      </SafeAreaView>
    </FullscreenSheet>
  );
}

function usePagedSearch(dishes: KitchenStatsDish[]) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? dishes.filter((x) => x.name.toLowerCase().includes(q)) : dishes;
  }, [dishes, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return {
    search,
    setSearch: (v: string) => {
      setSearch(v);
      setPage(1);
    },
    setPage,
    filtered,
    pages,
    current,
    rows,
  };
}

function LongestDishesModal({
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
  const s = usePagedSearch(dishes);
  return (
    <DetailModalShell title={title} subtitle={periodLabel} onClose={onClose}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск по блюду"
          placeholderTextColor={colors.textLight}
          value={s.search}
          onChangeText={s.setSearch}
        />
      </View>
      <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
        <MiniTable
          columns={[
            { label: 'Блюдо' },
            { label: 'Ср.', align: 'right' },
            { label: 'Мин.', align: 'right' },
            { label: 'Макс.', align: 'right' },
            { label: 'Кол-во', align: 'right' },
          ]}
          rows={s.rows.map((x) => [x.name, minutes(x.avgMin), minutes(x.minMin), minutes(x.maxMin), `${x.count}`])}
          empty="Ничего не найдено"
        />
      </ScrollView>
      <View style={styles.modalFooter}>
        <Text style={styles.footerMuted} translate>Всего блюд: {s.filtered.length}</Text>
        <Pagination page={s.current} pages={s.pages} onChange={s.setPage} />
      </View>
    </DetailModalShell>
  );
}

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
  const s = usePagedSearch(dishes);
  const totalCount = s.filtered.reduce((sum, x) => sum + x.count, 0);
  return (
    <DetailModalShell title={title} subtitle={periodLabel} onClose={onClose}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск по блюду"
          placeholderTextColor={colors.textLight}
          value={s.search}
          onChangeText={s.setSearch}
        />
      </View>
      <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
        <MiniTable
          columns={[{ label: 'Блюдо' }, { label: 'Кол-во', align: 'right' }]}
          rows={s.rows.map((x) => [x.name, `${x.count} шт`])}
          footer={['Итого', `${totalCount} шт`]}
          empty="Ничего не найдено"
        />
      </ScrollView>
      <View style={styles.modalFooter}>
        <Text style={styles.footerMuted} translate>Всего блюд: {s.filtered.length}</Text>
        <Pagination page={s.current} pages={s.pages} onChange={s.setPage} />
      </View>
    </DetailModalShell>
  );
}

function HourlyModal({
  station,
  initialPeriod,
  initialFrom,
  initialTo,
  onClose,
}: {
  station: PrepStation;
  initialPeriod: KitchenStatsPeriod;
  initialFrom: string;
  initialTo: string;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<KitchenStatsPeriod>(initialPeriod);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const rangeValid = period !== 'custom' || validDateRange(from, to);
  const statsQ = useKitchenStats({ period, ...(period === 'custom' ? { from, to } : {}) }, station, rangeValid);
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
    <DetailModalShell title="Приготовлено по часам" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
        <PeriodTabs period={period} onChange={setPeriod} />
        {period === 'custom' ? <DateRangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} /> : null}
        {!rangeValid ? null : statsQ.isError ? <Text style={styles.tableEmpty} translate>Не удалось загрузить статистику</Text> : statsQ.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={{ marginTop: spacing.lg }}>
              <HourlyChart data={hourly} height={240} />
            </View>
            <View style={{ marginTop: spacing.lg }}>
              <MiniTable
                columns={[
                  { label: 'Время' },
                  { label: 'Блюд', align: 'right' },
                  { label: 'Выручка', align: 'right' },
                ]}
                rows={active.map((h) => [hourLabel(h.hour), String(h.count), money(h.revenue)])}
                empty="Нет данных за период"
              />
            </View>
            <View style={styles.summaryCards}>
              <SummaryCard label="Пиковый час" value={peak ? hourLabel(peak.hour) : '—'} />
              <SummaryCard label="Всего блюд" value={String(totalCount)} />
              <SummaryCard label="Среднее в час" value={String(avgPerHour)} />
            </View>
          </>
        )}
      </ScrollView>
    </DetailModalShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryCardLabel} translate>{label}</Text>
      <Text style={styles.summaryCardValue}>{value}</Text>
    </View>
  );
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <View style={styles.pagination}>
      <FastPressable
        disabled={page <= 1}
        onPress={() => onChange(page - 1)}
        style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
      >
        <PwaIcon name="chevronLeft" size={16} color={colors.textSecondary} />
      </FastPressable>
      <Text style={styles.pageInfo}>
        {page} / {pages}
      </Text>
      <FastPressable
        disabled={page >= pages}
        onPress={() => onChange(page + 1)}
        style={[styles.pageBtn, page >= pages && styles.pageBtnDisabled]}
      >
        <PwaIcon name="chevronRight" size={16} color={colors.textSecondary} />
      </FastPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  headerSub: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  loading: { paddingVertical: 60, alignItems: 'center' },

  periodTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 4,
  },
  periodTab: { borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: 16, alignItems: 'center' },
  periodTabActive: {
    backgroundColor: colors.white,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  periodTabText: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  periodTabTextActive: { color: colors.primary },

  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  sumText: { fontSize: fontSize.sm, color: colors.textSecondary },
  sumValue: { fontWeight: '600', color: colors.textPrimary },
  sumSep: { fontSize: fontSize.sm, color: colors.textLight },

  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  panelHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md },
  panelTitle: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  linkText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.primary },

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

  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  chartValue: { fontSize: 10, fontWeight: '500', color: colors.textSecondary, marginBottom: 2 },
  chartBar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: colors.primary },
  chartLabels: { flexDirection: 'row', gap: 3, marginTop: 6 },
  chartLabel: { flex: 1, textAlign: 'center', fontSize: 9, color: colors.textLight },

  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  searchInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  modalScroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  footerMuted: { fontSize: fontSize.xs, color: colors.textMuted },
  pagination: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pageBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBtnDisabled: { opacity: 0.4 },
  pageInfo: { fontSize: fontSize.sm, color: colors.textMuted, paddingHorizontal: spacing.sm },

  summaryCards: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  summaryCardLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  summaryCardValue: { marginTop: 4, fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
});
