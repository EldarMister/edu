import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import { Select } from '@/components/Select';
import { DateField } from '@/components/DateField';
import { Button } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { useWaiterOrdersReport, type StaffMember, type WaiterOrdersReportItem } from '@/services/api/admin';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { colors, spacing } from '@/theme';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import { shareCsv } from './print';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
type DishTotal = { name: string; quantity: number; amount: number };
type Category = DishTotal & { dishes: Map<string, DishTotal> };
const COLUMNS = [
  { label: 'Время заказа', width: 120 }, { label: 'Время подачи', width: 120 },
  { label: '№ заказа', width: 100 }, { label: 'Стол', width: 70 },
  { label: 'Блюдо', width: 210 }, { label: 'Категория', width: 160 },
  { label: 'Кол-во', width: 80 }, { label: 'Цена', width: 90 }, { label: 'Сумма', width: 90 },
];
const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0);
const byQuantity = (a: DishTotal, b: DishTotal) => b.quantity - a.quantity || b.amount - a.amount;
const durationLabel = (seconds: number) => seconds < 60 ? `${seconds} сек` : `${Math.floor(seconds / 60)} мин ${seconds % 60} сек`;

export function WaiterOrdersReport({ staff, staffLoading = false }: { staff: StaffMember[]; staffLoading?: boolean }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [waiterId, setWaiterId] = useState('');
  const [exporting, setExporting] = useState(false);
  const { canAction } = usePermissions();
  const push = useNotifications((s) => s.push);
  const options = staff.filter((s) => s.role === 'WAITER').map((s) => ({ value: s.id, label: s.name, translate: false }));
  const selectedId = options.some((s) => s.value === waiterId) ? waiterId : options[0]?.value ?? '';
  const q = useWaiterOrdersReport(selectedId, from, to);
  const data = q.data;
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
    if (!data) return;
    setExporting(true);
    try {
      await shareCsv(`waiter-orders-${data.waiter.name}-${from}-${to}`, [
        COLUMNS.map(column => column.label),
        ...data.items.map(row => [timeHM(row.orderedAt), timeHM(row.servedAt), displayOrderNumber(row.orderNumber), row.tableNumber, row.dishName, row.categoryName, row.quantity, row.unitPrice, row.amount]),
      ]);
    } catch (error) { push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
    finally { setExporting(false); }
  }

  return <View style={styles.panel}>
    <View><Text style={styles.title} translate>Отчет официанта по заказам</Text><Text style={styles.subtitle} translate>Отдельная страница по одному официанту</Text></View>
    <View style={styles.stack}>
      <View style={styles.period}><Text style={styles.filterLabel} translate>Период:</Text><View style={{ flex: 1 }}><DateField value={from} onChangeText={value => { setFrom(value); if (value > to) setTo(value); }} /></View><Text style={styles.muted}>—</Text><View style={{ flex: 1 }}><DateField value={to} onChangeText={value => { setTo(value); if (value < from) setFrom(value); }} /></View></View>
      <View style={styles.period}><Text style={styles.filterLabel} translate>Официант:</Text><View style={{ flex: 1 }} pointerEvents={staffLoading || !options.length ? 'none' : 'auto'}><Select value={selectedId} options={options} onChange={setWaiterId} title="Официант" placeholder={staffLoading ? 'Загрузка...' : 'Выберите официанта'} style={styles.select} /></View></View>
      {canAction('exportReports') ? <Button title="Экспорт" disabled={!data} size="md" loading={exporting} onPress={() => void exportReport()} style={{ alignSelf: 'flex-end', paddingHorizontal: 20 }} /> : null}
    </View>
    {data ? <View style={styles.summary}>
      {[['Официант', data.waiter.name], ['Заказов', data.summary.ordersCount], ['Блюд', data.summary.dishesCount], ['Сумма', money(data.summary.amount)], ['Среднее время подачи', durationLabel(data.summary.averageServingSeconds)]].map(([label, value]) => <Text key={label} style={styles.summaryItem}><Text translate>{label}:</Text> <Text style={styles.label}>{value}</Text></Text>)}
    </View> : null}
    <View style={styles.tableFrame}>
      {q.isLoading || staffLoading ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
        : !selectedId ? <Text style={styles.emptyText} translate>Добавьте официанта, чтобы сформировать отчет</Text>
        : q.isError ? <View style={styles.empty}><Text style={{ color: colors.danger }} translate>Не удалось загрузить отчет</Text><Button title="Повторить" variant="secondary" onPress={() => void q.refetch()} /></View>
        : !data?.items.length ? <Text style={styles.emptyText} translate>За выбранный период оплаченных заказов нет</Text>
        : <ScrollView horizontal showsHorizontalScrollIndicator><View style={{ width: TABLE_WIDTH }}>
          <View style={[styles.tableRow, styles.tableHeader]}>{COLUMNS.map(column => <Text key={column.label} style={[styles.cell, styles.muted, { width: column.width }]} translate>{column.label}</Text>)}</View>
          {data.items.map(row => <ReportRow key={row.id} row={row} />)}
          <View style={[styles.tableRow, styles.tableFooter]}><Text style={[styles.cell, styles.label, { width: TABLE_WIDTH - 260, textAlign: 'left' }]} translate>Итого</Text><Text style={[styles.cell, styles.label, { width: 80 }]}>{data.summary.dishesCount}</Text><View style={{ width: 90 }} /><Text style={[styles.cell, styles.label, { width: 90 }]}>{money(data.summary.amount)}</Text></View>
        </View></ScrollView>}
    </View>
    {totals.length ? <View style={styles.totals}>
      <View><Text style={styles.totalsTitle} translate>Итоги по блюдам</Text><Text style={styles.subtitle} translate>Товарная разбивка за выбранный период</Text></View>
      {totals.map((category, index) => <CategoryRow key={category.name} category={category} defaultOpen={index === 0} />)}
      <View style={[styles.between, styles.grandTotal]}><Text style={styles.label} translate>Всего</Text><Text style={styles.label} translate>{data?.summary.dishesCount ?? 0} шт. ({money(data?.summary.amount ?? 0)})</Text></View>
    </View> : null}
  </View>;
}

function ReportRow({ row }: { row: WaiterOrdersReportItem }) {
  const values = [timeHM(row.orderedAt), timeHM(row.servedAt), displayOrderNumber(row.orderNumber), row.tableNumber, row.dishName, row.categoryName, row.quantity, money(row.unitPrice), money(row.amount)];
  return <View style={styles.tableRow}>{values.map((value, index) => <Text key={index} style={[styles.cell, { width: COLUMNS[index].width }, (index === 4 || index === 5) && { textAlign: 'left' }, index === 4 && styles.label]}>{value}</Text>)}</View>;
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
  panel: { borderRadius: 16, backgroundColor: colors.white, padding: 16, gap: 20 }, stack: { gap: 12 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '600', letterSpacing: -0.4 }, subtitle: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' }, muted: { color: colors.textMuted, fontSize: 14 },
  period: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  filterLabel: { paddingHorizontal: 12, color: colors.textMuted, fontSize: 14 }, select: { borderWidth: 0, borderRadius: 12, height: 48 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, summaryItem: { color: colors.textPrimary, fontSize: 14, paddingRight: 10, borderRightWidth: 1, borderColor: colors.border },
  tableFrame: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderColor: colors.border }, tableHeader: { backgroundColor: colors.background }, tableFooter: { backgroundColor: '#FAFBFC', borderBottomWidth: 0 },
  cell: { textAlign: 'center', paddingHorizontal: 12, paddingVertical: 12, borderRightWidth: 1, borderColor: colors.border, fontSize: 14, color: colors.textPrimary },
  empty: { padding: 40, alignItems: 'center', gap: spacing.md }, emptyText: { textAlign: 'center', padding: 40, color: colors.textMuted, fontSize: 14 },
  totals: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, gap: 8 }, totalsTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }, dish: { paddingLeft: 26, paddingBottom: 8 }, grandTotal: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, marginTop: 4 },
});
