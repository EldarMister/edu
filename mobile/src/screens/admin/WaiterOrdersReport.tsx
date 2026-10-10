import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import { Select } from '@/components/Select';
import { DateField } from '@/components/DateField';
import { Button, Card } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { useWaiterOrdersReport, type StaffMember } from '@/services/api/admin';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { colors, radius, spacing } from '@/theme';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import { shareCsv } from './print';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
type Category = { name: string; quantity: number; amount: number; dishes: Map<string, { name: string; quantity: number; amount: number }> };

export function WaiterOrdersReport({ staff }: { staff: StaffMember[] }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [waiterId, setWaiterId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { canAction } = usePermissions();
  const push = useNotifications((s) => s.push);
  const options = staff.filter((s) => s.role === 'WAITER').map((s) => ({ value: s.id, label: s.name }));
  const selectedId = options.some((s) => s.value === waiterId) ? waiterId : options[0]?.value ?? '';
  const q = useWaiterOrdersReport(selectedId, from, to);
  const data = q.data;
  const totals = useMemo(() => {
    const categories = new Map<string, Category>();
    for (const row of q.data?.items ?? []) {
      const category = categories.get(row.categoryName) ?? { name: row.categoryName, quantity: 0, amount: 0, dishes: new Map() };
      category.quantity += row.quantity; category.amount += row.amount;
      const dish = category.dishes.get(row.dishName) ?? { name: row.dishName, quantity: 0, amount: 0 };
      dish.quantity += row.quantity; dish.amount += row.amount; category.dishes.set(dish.name, dish); categories.set(category.name, category);
    }
    return [...categories.values()].sort((a, b) => b.quantity - a.quantity);
  }, [q.data]);
  async function exportReport() {
    if (!data) return;
    setExporting(true);
    try { await shareCsv(`waiter-orders-${data.waiter.name}-${from}-${to}`, [['Время заказа', 'Время подачи', '№ заказа', 'Стол', 'Блюдо', 'Категория', 'Кол-во', 'Цена', 'Сумма'], ...data.items.map((r) => [r.orderedAt, r.servedAt, displayOrderNumber(r.orderNumber), r.tableNumber, r.dishName, r.categoryName, r.quantity, r.unitPrice, r.amount])]); }
    catch (error) { push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
    finally { setExporting(false); }
  }
  return <View style={styles.stack}><Text style={styles.title} translate>Отчёт официанта по заказам</Text><Select value={selectedId} options={options} onChange={setWaiterId} title="Официант" /><View style={styles.dates}><View style={{ flex: 1 }}><DateField label="С даты" value={from} onChangeText={(v) => { setFrom(v); if (v > to) setTo(v); }} /></View><View style={{ flex: 1 }}><DateField label="По дату" value={to} onChangeText={(v) => { setTo(v); if (v < from) setFrom(v); }} /></View></View>{data ? <Card style={styles.stack}><Text style={styles.label} translate>{data.waiter.name} · Заказов: {data.summary.ordersCount} · Блюд: {data.summary.dishesCount}</Text><Text style={styles.title}>{money(data.summary.amount)}</Text><Text style={styles.muted} translate>Среднее время подачи: {Math.floor(data.summary.averageServingSeconds / 60)} мин {data.summary.averageServingSeconds % 60} сек</Text>{canAction('exportReports') ? <Button title="Экспорт CSV" disabled={!data} loading={exporting} onPress={() => void exportReport()} /> : null}</Card> : null}{q.isLoading ? <ActivityIndicator color={colors.primary} /> : q.isError ? <Card><Text style={{ color: colors.danger }}>{apiError(q.error)}</Text><Button title="Повторить" onPress={() => void q.refetch()} /></Card> : !selectedId ? <Text style={styles.muted} translate>Добавьте официанта, чтобы сформировать отчёт</Text> : !data?.items.length ? <Text style={styles.muted} translate>За выбранный период оплаченных заказов нет</Text> : data.items.map((row) => <Card key={row.id} style={styles.stack}><View style={styles.between}><Text style={styles.label} translate>{displayOrderNumber(row.orderNumber)} · Стол {row.tableNumber}</Text><Text style={styles.label}>{money(row.amount)}</Text></View><Text style={styles.label}>{row.quantity}× {row.dishName}</Text><Text style={styles.muted} translate>{row.categoryName} · Цена: {money(row.unitPrice)}</Text><Text style={styles.muted} translate>Заказ: {timeHM(row.orderedAt)} · Подача: {timeHM(row.servedAt)}</Text></Card>)}{totals.length ? <Card style={styles.stack}><Text style={styles.title} translate>Итоги по блюдам</Text>{totals.map((category) => <View key={category.name}><FastPressable style={styles.between} onPress={() => setExpanded((v) => v === category.name ? null : category.name)}><Text style={styles.label}>{expanded === category.name ? '⌄' : '›'} {category.name}</Text><Text style={styles.muted} translate>{category.quantity} шт. ({money(category.amount)})</Text></FastPressable>{expanded === category.name ? [...category.dishes.values()].sort((a, b) => b.quantity - a.quantity).map((dish) => <View key={dish.name} style={[styles.between, { paddingLeft: spacing.md, paddingTop: spacing.sm }]}><Text style={[styles.muted, { flex: 1 }]}>{dish.name}</Text><Text style={styles.muted} translate>{dish.quantity} шт. ({money(dish.amount)})</Text></View>) : null}</View>)}</Card> : null}</View>;
}
const styles = StyleSheet.create({ stack: { gap: spacing.sm }, title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' }, label: { color: colors.textPrimary, fontWeight: '600' }, muted: { color: colors.textMuted, fontSize: 13 }, between: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }, dates: { flexDirection: 'row', gap: spacing.sm }, input: { height: 44, flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, color: colors.textPrimary, backgroundColor: colors.white } });
