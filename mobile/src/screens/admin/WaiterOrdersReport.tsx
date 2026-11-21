import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import React, { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/typography';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { DateField } from '@/components/DateField';
import { Button, SegmentTabs } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { useWaiterOrdersReport, type StaffMember, type WaiterOrdersReportItem } from '@/services/api/admin';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { colors, spacing } from '@/theme';
import { displayOrderNumber, money } from '@/utils/format';
import { warehouseLocalTime, warehouseReportRange, type WarehousePeriod } from '@/utils/warehouseTiming';
import { WarehouseDirectorySearch } from './WarehouseDirectoryTable';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';
import { shareCsv } from './print';

type DishTotal = { name: string; quantity: number; amount: number };
type Category = DishTotal & { dishes: Map<string, DishTotal> };
type ColumnKey = 'dishName' | 'orderNumber' | 'orderedAt' | 'servedAt' | 'tableNumber' | 'categoryName' | 'quantity' | 'unitPrice' | 'amount';
const COLUMNS: { value: ColumnKey; label: string; width: number }[] = [
  { value: 'dishName', label: 'Блюдо', width: 205 }, { value: 'orderNumber', label: '№ заказа', width: 100 },
  { value: 'orderedAt', label: 'Время заказа', width: 158 }, { value: 'servedAt', label: 'Время подачи', width: 158 },
  { value: 'tableNumber', label: 'Стол', width: 70 }, { value: 'categoryName', label: 'Категория', width: 145 },
  { value: 'quantity', label: 'Кол-во', width: 80 }, { value: 'unitPrice', label: 'Цена', width: 90 },
  { value: 'amount', label: 'Сумма', width: 98 },
];
const optionalColumns = COLUMNS.filter(({ value }) => value !== 'dishName');
const defaults = optionalColumns.map(({ value }) => value);
const tabs = [{ key: 'orders', label: 'Позиции заказов' }, { key: 'dishes', label: 'По блюдам' }] as const;
type ReportTab = typeof tabs[number]['key'];
const periods: { value: WarehousePeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' }, { value: 'yesterday', label: 'Вчера' },
  { value: 'week', label: 'Последние 7 дней' }, { value: 'month', label: 'Последние 30 дней' },
  { value: 'currentMonth', label: 'Текущий месяц' }, { value: 'lastMonth', label: 'Прошлый месяц' },
  { value: 'custom', label: 'Свой период' },
];
const reportTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Bishkek', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const sorter = new Intl.Collator('ru-RU', { numeric: true });
const emptyRows: WaiterOrdersReportItem[] = [];

function rowValue(row: WaiterOrdersReportItem, key: ColumnKey) {
  if (key === 'orderedAt' || key === 'servedAt') return reportTime.format(new Date(row[key]));
  if (key === 'unitPrice' || key === 'amount') return money(row[key]);
  return key === 'orderNumber' ? displayOrderNumber(row.orderNumber) : row[key];
}

const byQuantity = (a: DishTotal, b: DishTotal) => b.quantity - a.quantity || b.amount - a.amount;
const durationLabel = (seconds: number) => seconds < 60 ? `${seconds} сек` : `${Math.floor(seconds / 60)} мин ${seconds % 60} сек`;

export function WaiterOrdersReport({ staff, staffLoading = false }: { staff: Pick<StaffMember, 'id' | 'name' | 'role'>[]; staffLoading?: boolean }) {
  const today = warehouseLocalTime().date;
  const [period, setPeriod] = useState<WarehousePeriod>('today');
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const { from = today, to = today } = warehouseReportRange(period, new Date(), { from: customFrom, to: customTo });
  const [tab, setTab] = useState<ReportTab>('orders');
  const [search, setSearch] = useState('');
  const [shown, saveColumns] = useColumnPreference('waiter-orders-report', defaults);
  const [sort, setSort] = useState<{ key: ColumnKey; desc: boolean }>({ key: 'orderedAt', desc: true });
  const columns = COLUMNS.filter(({ value }) => value === 'dishName' || shown.includes(value));
  const [waiterId, setWaiterId] = useState('');
  const [exporting, setExporting] = useState(false);
  const { canAction } = usePermissions();
  const push = useNotifications((s) => s.push);
  const options = staff.filter((s) => s.role === 'WAITER').map((s) => ({ value: s.id, label: s.name, translate: false }));
  const selectedId = options.some((s) => s.value === waiterId) ? waiterId : options[0]?.value ?? '';
  const q = useWaiterOrdersReport(selectedId, from, to);
  const data = q.data;
  const rows = data?.items ?? emptyRows;
  const query = search.trim().toLocaleLowerCase('ru');
  const activeSort = columns.some(({ value }) => value === sort.key) ? sort : { key: 'dishName' as const, desc: false };
  const visibleRows = rows.filter((row) => !query || [row.dishName, row.categoryName, row.orderNumber, String(row.tableNumber)]
    .some((value) => value?.toLocaleLowerCase('ru').includes(query))).sort((left, right) => {
      const a = left[activeSort.key];
      const b = right[activeSort.key];
      const difference = typeof a === 'number' && typeof b === 'number' ? a - b : sorter.compare(String(a), String(b));
      return activeSort.desc ? -difference : difference;
    });
  const quantity = visibleRows.reduce((sum, row) => sum + row.quantity, 0);
  const amount = visibleRows.reduce((sum, row) => sum + row.amount, 0);
  const totals = useMemo(() => {
    const categories = new Map<string, Category>();
    for (const row of q.data?.items ?? []) {
      const category = categories.get(row.categoryName) ?? { name: row.categoryName, quantity: 0, amount: 0, dishes: new Map() };
      category.quantity += row.quantity; category.amount += row.amount;
      const dish = category.dishes.get(row.dishName) ?? { name: row.dishName, quantity: 0, amount: 0 };
      dish.quantity += row.quantity; dish.amount += row.amount;
      category.dishes.set(dish.name, dish); categories.set(category.name, category);
    }
    return [...categories.values()].sort(byQuantity);
  }, [q.data]);

  async function exportReport() {
    if (!data || !visibleRows.length) return;
    setExporting(true);
    try {
      await shareCsv(`waiter-orders-${data.waiter.name}-${from}-${to}`, [
        COLUMNS.map(column => column.label),
        ...visibleRows.map((row) => COLUMNS.map(({ value }) => value === 'unitPrice' || value === 'amount' ? row[value] : rowValue(row, value))),
      ]);
    } catch (error) { push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
    finally { setExporting(false); }
  }

  return <View style={styles.panel}>
    <View style={styles.toolbar}>
      <Text style={styles.title} translate>Отчёт официанта</Text>
      <AnchoredSelectScope>
        <Select title="Официант" placeholder="Выберите официанта" searchable disabled={staffLoading || !options.length}
          value={selectedId} options={options} onChange={setWaiterId} />
        <Select title="Период отчёта" value={period} options={periods} onChange={setPeriod} />
      </AnchoredSelectScope>
    </View>
    {period === 'custom' && <View style={styles.toolbar}>
      <DateField value={customFrom} accessibilityLabel="Начало периода" onChangeText={(value) => { setCustomFrom(value); if (value > customTo) setCustomTo(value); }} />
      <DateField value={customTo} accessibilityLabel="Конец периода" onChangeText={(value) => { setCustomTo(value); if (value < customFrom) setCustomFrom(value); }} />
    </View>}
    {data && <View style={styles.summary}>
      {[
        ['Сумма по позициям', money(data.summary.amount)], ['Оплачено заказов', data.summary.ordersCount],
        ['Блюд', data.summary.dishesCount],
        ['Среднее время подачи', data.summary.ordersCount ? durationLabel(data.summary.averageServingSeconds) : '—'],
      ].map(([label, value]) => <View key={label} style={styles.summaryItem}>
        <Text style={styles.muted} translate>{label}</Text><Text style={styles.label}>{value}</Text>
      </View>)}
    </View>}
    <View style={styles.tableFrame}>
      <View style={styles.filters}>
        <SegmentTabs<ReportTab> items={[...tabs]} value={tab} onChange={setTab} />
        {tab === 'orders' && <View style={styles.toolbar}>
          <WarehouseDirectorySearch label="Поиск по заказам" placeholder="Блюдо или № заказа" value={search} onChange={setSearch} />
          <WarehouseMultiSelect label="Столбцы" value={shown} options={optionalColumns} onChange={saveColumns} />
          {canAction('exportReports') && <Button title="Экспорт CSV" size="md" variant="secondary" disabled={!visibleRows.length}
            loading={exporting} onPress={() => void exportReport()} />}
        </View>}
      </View>
      {q.isLoading || staffLoading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
        : !selectedId ? <Text style={styles.emptyText} translate>Добавьте официанта, чтобы сформировать отчёт</Text>
        : q.isError && !data ? <View style={styles.empty}><Text style={{ color: colors.danger }} translate>Не удалось загрузить отчёт</Text><Button title="Повторить" variant="secondary" onPress={() => void q.refetch()} /></View>
        : tab === 'dishes' && totals.length ? <View style={styles.categories}>
          {totals.map((category, index) => <CategoryRow key={category.name} category={category} defaultOpen={index === 0} />)}
        </View> : tab === 'dishes' || !visibleRows.length ? <Text style={styles.emptyText} translate>
          {tab === 'orders' && rows.length ? 'По вашему запросу ничего не найдено' : 'За выбранный период оплаченных заказов нет'}
        </Text>
        : <ScrollView horizontal showsHorizontalScrollIndicator><View>
          <View style={[styles.tableRow, styles.tableHeader]}>{columns.map(({ label, width, value }) => (
            <FastPressable key={value} style={{ width }} accessibilityRole="button" onPress={() => setSort({ key: value, desc: activeSort.key === value && !activeSort.desc })}>
              <Text style={[styles.cell, styles.muted]} translate>{label}{activeSort.key === value ? activeSort.desc ? ' ↓' : ' ↑' : ''}</Text>
            </FastPressable>
          ))}</View>
          {visibleRows.map((row) => <View key={row.id} style={styles.tableRow}>
            {columns.map(({ value, width }) => <Text key={value} style={[styles.cell, { width }]}>{rowValue(row, value)}</Text>)}
          </View>)}
          <View style={[styles.tableRow, styles.tableFooter]}>
            {columns.map(({ value, width }) => <Text key={value} style={[styles.cell, styles.label, { width }]} translate>
              {value === 'dishName' ? 'Итого' : value === 'quantity' ? quantity : value === 'amount' ? money(amount) : ''}
            </Text>)}
          </View>
        </View></ScrollView>}
    </View>
  </View>;
}

function CategoryRow({ category, defaultOpen }: { category: Category; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return <View>
    <FastPressable style={styles.categoryRow} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}>
      <PwaIcon name={open ? 'chevronDown' : 'chevronRight'} color={colors.textLight} size={18} /><Text style={[styles.label, { flex: 1 }]}>{category.name}</Text><Text style={styles.muted} translate>{category.quantity} шт. ({money(category.amount)})</Text>
    </FastPressable>
    {open ? [...category.dishes.values()].sort(byQuantity).map(dish => <View key={dish.name} style={[styles.between, styles.dish]}><Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>{dish.name}</Text><Text style={styles.muted} translate>{dish.quantity} шт. ({money(dish.amount)})</Text></View>) : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderRadius: 16, backgroundColor: colors.white, padding: 16, gap: 20 }, toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  categories: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  filters: { padding: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '600', letterSpacing: -0.4 }, subtitle: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' }, muted: { color: colors.textMuted, fontSize: 14 },
  period: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  filterLabel: { paddingHorizontal: 12, color: colors.textMuted, fontSize: 14 }, select: { borderWidth: 0, borderRadius: 12, height: 48 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, summaryItem: { flexGrow: 1, minWidth: 130, gap: 4, padding: spacing.sm, borderWidth: 1, borderRadius: 10, borderColor: colors.border },
  tableFrame: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderColor: colors.border }, tableHeader: { backgroundColor: colors.background }, tableFooter: { backgroundColor: '#FAFBFC', borderBottomWidth: 0 },
  cell: { textAlign: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRightWidth: 1, borderColor: colors.border, fontSize: 14, color: colors.textPrimary },
  empty: { padding: 40, alignItems: 'center', gap: spacing.md }, emptyText: { textAlign: 'center', padding: 40, color: colors.textMuted, fontSize: 14 },
  totals: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, gap: 8 }, totalsTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }, dish: { paddingLeft: 26, paddingBottom: 8 }, grandTotal: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, marginTop: 4 },
});
