import React from 'react';
import { StyleSheet } from 'react-native';
import * as Print from 'expo-print';
import { DateField } from '@/components/DateField';
import { FastPressable } from '@/components/FastPressable';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { ScrollView, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, EmptyState, Loading } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { TAX_REPORT_ENDPOINT, TAX_REPORT_LABELS, TAX_TYPE_LABELS, useTaxReport } from '@/services/api/taxes';
import { colors, spacing } from '@/theme';
import { balanceMoney } from '@/utils/warehouseBalance';
import { warehouseLocalTime, warehouseReportRange, type WarehousePeriod } from '@/utils/warehouseTiming';
import { waitForNativePrintReturn } from './nativePrintLifecycle';
import { WarehouseDirectoryTable, WarehouseDirectoryValue, type DirectoryColumn } from './WarehouseDirectoryTable';
import { WarehouseWorkbook } from './WarehouseWorkbook';

type TaxSort = 'name' | 'rate' | 'salesAmount' | 'amount';
const periodOptions: { value: WarehousePeriod; label: string }[] = [
  { value: 'currentMonth', label: 'Текущий месяц' }, { value: 'lastMonth', label: 'Прошлый месяц' },
  { value: 'today', label: 'Сегодня' }, { value: 'yesterday', label: 'Вчера' },
  { value: 'week', label: 'Последние 7 дней' }, { value: 'month', label: 'Последние 30 дней' },
  { value: 'all', label: 'За всё время' }, { value: 'custom', label: 'Произвольный период' },
];
const columnList: { label: string; sort?: TaxSort; width: number }[] = [
  { label: 'Название', sort: 'name', width: 164 }, { label: 'Процент', sort: 'rate', width: 100 },
  { label: 'Тип', width: 158 }, { label: 'Операция', width: 203 },
  { label: 'Сумма продаж', sort: 'salesAmount', width: 124 }, { label: 'Сумма налога', sort: 'amount', width: 124 },
];
const escape = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function TaxReportScreen() {
  const canExport = usePermissions().canAction('exportReports');
  const today = warehouseLocalTime().date;
  const [period, setPeriod] = React.useState<WarehousePeriod>('currentMonth');
  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(today);
  const [kind, setKind] = React.useState('');
  const [sort, setSort] = React.useState<TaxSort>('name');
  const [desc, setDesc] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  const [error, setError] = React.useState('');
  const range = warehouseReportRange(period, new Date(), { from, to });
  const params = { ...range, kind: kind || undefined, sort, direction: desc ? 'desc' : 'asc' };
  const report = useTaxReport(params);
  const rows = (report.data ?? []).map((row) => {
    const operation = row.operation ?? row.kind;
    return { id: JSON.stringify([row.taxId, row.name, row.type, operation, row.rate]), cells: [
      row.name, String(row.rate).replace('.', ',') + ' %', TAX_TYPE_LABELS[row.type], TAX_REPORT_LABELS[operation],
      balanceMoney(Number(row.salesAmount)), balanceMoney(Number(row.amount)),
    ] };
  });
  const url = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) url.set(key, value); });
  const columns: DirectoryColumn<typeof rows[number]>[] = columnList.map(({ label, sort: key, width }, index) => ({
    key: label, width,
    title: key ? (
      <FastPressable accessibilityRole="button" onPress={() => { setSort(key); setDesc(sort === key && !desc); }}>
        <Text style={styles.heading} translate>{label}{sort === key ? desc ? ' ↓' : ' ↑' : ''}</Text>
      </FastPressable>
    ) : label,
    cell: ({ cells }) => <WarehouseDirectoryValue>{cells[index]}</WarehouseDirectoryValue>,
  }));

  async function print() {
    if (printing || !rows.length) return;
    setPrinting(true);
    setError('');
    const header = columnList.map(({ label }) => `<th>${escape(label)}</th>`).join('');
    const body = rows.map(({ cells }) => `<tr>${cells.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('');
    try {
      await waitForNativePrintReturn(() => Print.printAsync({ orientation: Print.Orientation.landscape,
        html: `<!doctype html><html lang="ru"><meta charset="utf-8"><style>body{font:14px sans-serif;padding:16px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #bbb;text-align:left}tr{break-inside:avoid}</style><h1>Налоги с продаж</h1><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></html>`,
      }));
    } catch (failure) { setError(apiError(failure)); }
    finally { setPrinting(false); }
  }

  return (
    <AnchoredSelectScope><ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.toolbar}>
        <Select title="Период отчёта" value={period} options={periodOptions} onChange={setPeriod} />
        <Select title="Операции с налогом" value={kind} options={[
          { value: '', label: 'Все операции' }, ...Object.entries(TAX_REPORT_LABELS).map(([value, label]) => ({ value, label })),
        ]} onChange={setKind} />
        {canExport && <WarehouseWorkbook url={`${TAX_REPORT_ENDPOINT}/export.xlsx?${url}`} filename="Налоги с продаж.xlsx" disabled={!rows.length} />}
        <Button title="Печать" size="md" variant="secondary" disabled={!rows.length} loading={printing} onPress={() => void print()} />
      </View>
      {period === 'custom' && <View style={styles.toolbar}>
        <DateField value={from} accessibilityLabel="Начало периода" onChangeText={(next) => { setFrom(next); if (next > to) setTo(next); }} />
        <DateField value={to} accessibilityLabel="Конец периода" onChangeText={(next) => { setTo(next); if (next < from) setFrom(next); }} />
      </View>}
      {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      {report.isPending ? <Loading /> : report.isError ? <View style={styles.toolbar}>
        <Text style={styles.error}>{apiError(report.error)}</Text><Button title="Повторить" size="md" variant="secondary" onPress={() => void report.refetch()} />
      </View> : rows.length ? <WarehouseDirectoryTable columns={columns} rows={rows} />
        : <EmptyState text="За этот период нет операций с налогом" />}
    </ScrollView></AnchoredSelectScope>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  heading: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.danger },
});
