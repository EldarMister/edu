import { useColumnPreference } from '@/hooks/useColumnPreference';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import * as Print from 'expo-print';
import { ScrollView, View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { StatisticsView } from '@/navigation/adminWorkspaceNavigation';
import type { StatisticsReports } from '@/services/api/admin';
import { colors, radius, spacing } from '@/theme';
import { balanceMoney } from '@/utils/warehouseBalance';
import { waitForNativePrintReturn } from './nativePrintLifecycle';
import { shareCsvText } from './print';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';

type ReportView = Exclude<StatisticsView, 'overview' | 'taxes'>;
type Cell = string | number | null;
type Row = Record<string, Cell>;
type Column = { key: string; label: string; type?: 'money' | 'count' | 'date' | 'duration' | 'percent'; width: number };
type Report = { title: string; columns: Column[]; ascending?: boolean; sortKey: string };
const name = (label: string): Column => ({ key: 'name', label, width: 180 });
const date: Column = { key: 'date', label: 'Дата', type: 'date', width: 140 };
const orders: Column = { key: 'orders', label: 'Чеки', type: 'count', width: 86 };
const quantity: Column = { key: 'quantity', label: 'Кол-во', type: 'count', width: 104 };
const amount = (key: string, label: string, width = 116): Column => ({ key, label, type: 'money', width });
const revenue = amount('revenue', 'Выручка');
const avgCheck = amount('avgCheck', 'Средний чек');
const profit = amount('profit', 'Прибыль');
const paymentMethods = [amount('cash', 'Наличные'), amount('card', 'Карта'), amount('qr', 'QR-код'), amount('other', 'Другие оплаты')];

const REPORTS: Record<ReportView, Report> = {
  sales: { title: 'Продажи', sortKey: 'date', columns: [
    date, orders, revenue, avgCheck, amount('discount', 'Скидка'),
  ] },
  products: { title: 'Товары', sortKey: 'quantity', columns: [
    { key: 'category', label: 'Категория', width: 135 }, name('Товар'), { key: 'waiter', label: 'Официант', width: 140 },
    quantity, amount('gross', 'Валовый оборот', 142), amount('discount', 'Скидка'), revenue, profit,
  ] },
  staff: { title: 'Сотрудники', sortKey: 'name', ascending: true, columns: [
    name('Официант'), revenue, profit, orders, avgCheck, { key: 'avgSeconds', label: 'Среднее время', type: 'duration', width: 128 },
  ] },
  categories: { title: 'Категории', sortKey: 'revenue', columns: [
    name('Категория'), quantity, amount('cost', 'Себестоимость', 132), revenue, profit,
    { key: 'foodCost', label: 'Food cost', type: 'percent', width: 100 },
  ] },
  payments: { title: 'Оплаты', sortKey: 'date', columns: [
    date, orders, ...paymentMethods, amount('total', 'Всего'),
  ] },
};
const PAGE_SIZE = 30;
const COST_KEYS = new Set(['cost', 'profit', 'foodCost']);

const formatDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatCell = (value: Cell | undefined, type: Column['type']) => {
  if (value == null) return '—';
  if (type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (typeof value !== 'number') return value;
  if (type === 'money') return balanceMoney(value);
  if (type === 'duration') return Math.round(value).toLocaleString('ru-RU') + ' сек.';
  if (type === 'percent') return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 }) + '%';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
};

function totals(rows: Row[], view: ReportView): Row {
  const keys = REPORTS[view].columns.filter((column) => column.type === 'count' || column.type === 'money').map(({ key }) => key);
  const result: Row = {};
  for (const key of keys) {
    result[key] = rows.some((row) => row[key] === null) ? null : rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  }
  if (view === 'sales' || view === 'staff') {
    result.avgCheck = Number(result.orders) ? Number(result.revenue) / Number(result.orders) : null;
  }
  if (view === 'categories') {
    result.foodCost = result.cost != null && Number(result.revenue) ? Number(result.cost) / Number(result.revenue) * 100 : null;
  }
  return result;
}

function compare(value: Cell | undefined, other: Cell | undefined, ascending: boolean) {
  if (value == null) return other == null ? 0 : 1;
  if (other == null) return -1;
  const order = typeof value === 'number' && typeof other === 'number'
    ? value - other : String(value).localeCompare(String(other), 'ru', { numeric: true });
  return ascending ? order : -order;
}

function filters(rows: Row[], id: string, label: string) {
  return [...new Map(rows.flatMap((row) => row[id] && row[label] ? [[String(row[id]), String(row[label])]] : [])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
    .map(([value, label]) => ({ value, label, translate: false }));
}

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function StatisticsReport({ view, data, periodLabel }: { view: ReportView; data: StatisticsReports; periodLabel: string }) {
  const t = useT();
  const width = useWindowDimensions().width;
  const { canAction, canSection } = usePermissions();
  const report = REPORTS[view];
  const showCosts = canSection('warehouse') && canAction('warehouseReports') && canAction('warehouseCosts');
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [staff, setStaff] = useState<string[]>([]);
  const [payment, setPayment] = useState('');
  const [hidden, setHidden] = useColumnPreference<string>('statistics-' + view, []);
  const [sort, setSort] = useState({ key: report.sortKey, ascending: report.ascending ?? false });
  const [page, setPage] = useState(0);
  const [output, setOutput] = useState<'csv' | 'print' | null>(null);
  const outputController = useRef<AbortController | null>(null);
  const [outputError, setOutputError] = useState('');
  useEffect(() => () => outputController.current?.abort(), []);

  const rows: Row[] = view === 'categories' ? data.categories.map((row) => ({
    ...row, foodCost: row.cost != null && row.revenue !== 0 ? row.cost / row.revenue * 100 : null,
  })) : data[view];
  const categoryOptions = view === 'categories' ? filters(rows, 'id', 'name') : filters(rows, 'categoryId', 'category');
  const staffOptions = view === 'staff' ? filters(rows, 'id', 'name') : filters(rows, 'waiterId', 'waiter');
  const hasOtherPayments = view === 'payments' && rows.some((row) => !!row.other);
  const reportColumns = report.columns.filter(({ key }) => {
    if (!showCosts && COST_KEYS.has(key)) return false;
    if (view !== 'payments') return true;
    if (payment) return key === 'date' || key === payment;
    return key !== 'other' || hasOtherPayments;
  });
  const requiredKey = view === 'products' ? 'name' : report.columns[0].key;
  const optionalColumns = reportColumns.filter(({ key }) => key !== requiredKey);
  const columns = reportColumns.filter(({ key }) => !hidden.includes(key));
  const effectiveSort = columns.some(({ key }) => key === sort.key) ? sort : { key: report.sortKey, ascending: report.ascending ?? false };
  const term = search.trim().toLocaleLowerCase('ru-RU');
  const visible = rows.filter((row) =>
    (!term || [row.name, row.category, row.waiter].some((part) => String(part ?? '').toLocaleLowerCase('ru-RU').includes(term)))
    && (!categories.length || categories.includes(String(view === 'categories' ? row.id : row.categoryId)))
    && (!staff.length || staff.includes(String(view === 'staff' ? row.id : row.waiterId)))
    && (!payment || !!row[payment]))
    .sort((a, b) => compare(a[effectiveSort.key], b[effectiveSort.key], effectiveSort.ascending));
  const total = { ...totals(visible, view), [columns[0].key]: t('Итого') };
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visiblePage = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const tableWidth = columns.reduce((value, column) => value + column.width, 0);
  const stretch = Math.max(0, width - 2 * spacing.lg - tableWidth);
  const cellWidth = (column: Column, index: number) => column.width + (index === 0 ? stretch : 0);
  const rowValues = (row: Row) => columns.map(({ key, type }) => formatCell(row[key], type));

  async function exportReport(action: 'csv' | 'print') {
    if (outputController.current) return;
    const controller = new AbortController();
    outputController.current = controller;
    setOutput(action);
    setOutputError('');
    const heading = columns.map(({ label }) => t(label));
    const values = visible.map(rowValues);
    const footer = rowValues(total);
    try {
      if (action === 'csv') {
        const body = [heading, ...values, footer].map((row) => row.map((value) => {
          const numeric = /^-\d+(?:[\u00a0\u202f ]\d{3})*(?:,\d+)?(?: с|%| сек\.)?$/.test(value);
          const text = /^\s*[=+\-@]/.test(value) && !numeric ? "'" + value : value;
          return '"' + text.replace(/"/g, '""') + '"';
        }).join(';')).join('\r\n');
        await shareCsvText(t(report.title), body, controller.signal);
      } else {
        const render = (row: string[], tag: 'th' | 'td') =>
          '<tr>' + row.map((value) => `<${tag}>${htmlEscape(value)}</${tag}>`).join('') + '</tr>';
        const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
          @page { size: landscape; margin: 10mm; } body { font: 12px Arial, sans-serif; color: black; background: white; }
          table { width: 100%; border-collapse: collapse; } td, th { padding: 6px; border: 1px solid #ccc; text-align: left; }
          tfoot { font-weight: bold; } tr { break-inside: avoid; }
          </style><h1>${htmlEscape(t(report.title))}</h1><p>${htmlEscape(periodLabel)}</p>
          <table><thead>${render(heading, 'th')}</thead><tbody>${values.map((row) => render(row, 'td')).join('')}</tbody>
          <tfoot>${render(footer, 'td')}</tfoot></table></html>`;
        await waitForNativePrintReturn(() => Print.printAsync({ html, orientation: Print.Orientation.landscape }), controller.signal);
      }
    } catch (error) {
      if (!controller.signal.aborted) setOutputError(apiError(error));
    } finally {
      outputController.current = null;
      if (!controller.signal.aborted) setOutput(null);
    }
  }

  function tableRow(row: Row, key: string, total = false) {
    return <View key={key} style={[styles.row, total && styles.total]}>
      {columns.map((column, index) => <Text key={column.key} style={[
        styles.cell, { width: cellWidth(column, index) }, column.type && column.type !== 'date' && styles.numeric, total && styles.strong,
      ]}>{formatCell(row[column.key], column.type)}</Text>)}
    </View>;
  }

  return <View style={styles.panel}>
    <View style={styles.toolbar}>
      <View style={styles.controls}>
        {view !== 'payments' && <WarehouseMultiSelect label="Столбцы" value={optionalColumns.map(({ key }) => key).filter((key) => !hidden.includes(key))}
          options={optionalColumns.map(({ key, label }) => ({ value: key, label }))}
          onChange={(shown) => setHidden(optionalColumns.map(({ key }) => key).filter((key) => !shown.includes(key)))} />}
        {canAction('exportReports') &&
          <Button icon="export" size="md" variant="secondary" title="Экспорт CSV" loading={output === 'csv'} disabled={!visible.length || output !== null} onPress={() => void exportReport('csv')} />
        }
        <Button icon="adminPrinter" size="md" variant="secondary" title="Печать" loading={output === 'print'} disabled={!visible.length || output !== null} onPress={() => void exportReport('print')} />
      </View>
      {view === 'payments' && <View style={styles.controls}>
        <Select title="Оплаты" value={payment} onChange={(value) => { setPayment(value); setPage(0); }}
          options={[{ value: '', label: 'Все оплаты' }, ...paymentMethods.filter(({ key }) => key !== 'other' || hasOtherPayments)
            .map(({ key, label }) => ({ value: key, label }))]} />
      </View>}
      {(view === 'products' || view === 'categories' || view === 'staff') && <View style={styles.controls}>
        <View style={styles.search}>
          <PwaIcon name="search" size={16} color={colors.textMuted} />
          <TextInput value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} style={styles.searchInput}
            placeholder={t('Быстрый поиск')} accessibilityLabel={t('Быстрый поиск')} maxLength={160} />
        </View>
        {view !== 'staff' && <WarehouseMultiSelect label="Категории" value={categories} options={categoryOptions}
          onChange={(value) => { setCategories(value); setPage(0); }} />}
        {view !== 'categories' && <WarehouseMultiSelect label="Официант" value={staff} options={staffOptions}
          onChange={(value) => { setStaff(value); setPage(0); }} />}
        {!!(search || categories.length || staff.length) && <Button size="md" variant="secondary" title="Сбросить всё" onPress={() => {
          setSearch(''); setCategories([]); setStaff([]); setPage(0);
        }} />}
      </View>}
      {!!outputError && <Text style={styles.error} accessibilityRole="alert">{outputError}</Text>}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled">
      <View>
        <View style={styles.row}>
          {columns.map((column, index) => <FastPressable key={column.key} style={{ width: cellWidth(column, index) }}
            accessibilityRole="button" accessibilityState={{ selected: effectiveSort.key === column.key }}
            onPress={() => {
              setSort({ key: column.key, ascending: effectiveSort.key === column.key ? !effectiveSort.ascending : true });
              setPage(0);
            }}>
            <Text style={[styles.cell, styles.header, column.type && column.type !== 'date' && styles.numeric]}>
              {t(column.label)}{effectiveSort.key === column.key ? (effectiveSort.ascending ? ' ↑' : ' ↓') : ''}
            </Text>
          </FastPressable>)}
        </View>
        {visiblePage.map((row, index) => tableRow(row, [row.date ?? row.id, row.categoryId, row.waiterId, index].join(':')))}
        {!!visible.length && tableRow(total, 'total', true)}
      </View>
    </ScrollView>
    {!visible.length && <Text style={styles.empty} translate>Нет данных за период</Text>}
    {pageCount > 1 && <View style={styles.pagination}>
      <Button title="Назад" size="md" variant="secondary" disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} />
      <Text style={styles.header}>{currentPage + 1} / {pageCount}</Text>
      <Button title="Далее" size="md" variant="secondary" disabled={currentPage + 1 >= pageCount} onPress={() => setPage(currentPage + 1)} />
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card },
  toolbar: { padding: spacing.md, gap: spacing.sm },
  controls: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  search: { minWidth: 150, flex: 1, minHeight: 36, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.sm },
  searchInput: { flex: 1, minHeight: 36, color: colors.textPrimary, paddingVertical: 2 },
  row: { flexDirection: 'row', minHeight: 46, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cell: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, color: colors.textPrimary, fontSize: 14 },
  header: { color: colors.textMuted, fontSize: 13 },
  numeric: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  total: { backgroundColor: colors.background, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  strong: { fontWeight: '600' },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  error: { color: colors.danger },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.md },
});
