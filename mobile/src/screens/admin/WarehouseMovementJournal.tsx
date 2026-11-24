import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { DateField } from '@/components/DateField';
import { Select, type SelectOption } from '@/components/Select';
import { Button, Card } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useStaff } from '@/services/api/admin';
import { getMovementCsv, useWarehouseReport, type StockMovementType, type WarehouseLocation, type WarehouseReportFilter, type WarehouseReportMovementRow } from '@/services/api/warehouse';
import { colors, spacing } from '@/theme';
import { isAllowedDate, parseIsoDate } from '@/utils/calendarDate';
import { balanceMoney } from '@/utils/warehouseBalance';
import { warehouseLocalTime, warehouseReportRange, warehouseTimeDisplay, type WarehousePeriod } from '@/utils/warehouseTiming';
import { WarehouseWorkspace } from './WarehouseWorkspace';
import { MovementSourceLink, MovementSourcePage } from './WarehouseMovementSource';
import { shareCsvText } from './print';
import { journalColumns as columns, journalCost as cost, journalMovementValues, printWarehouseMovement } from './warehouseMovementPrint';

export const movementPeriods: SelectOption<WarehousePeriod>[] = [
  { value: 'today', label: 'Сегодня' }, { value: 'yesterday', label: 'Вчера' },
  { value: 'week', label: 'Последние 7 дней' }, { value: 'month', label: 'Последние 30 дней' },
  { value: 'currentMonth', label: 'Этот месяц' }, { value: 'lastMonth', label: 'Прошлый месяц' },
  { value: 'all', label: 'Всё время' }, { value: 'custom', label: 'Свой период' },
];
const movementTypes: SelectOption<StockMovementType | ''>[] = [
  { value: '', label: 'Все типы движения' },
  { value: 'purchase', label: 'Приход' },
  { value: 'sale', label: 'Продажа' },
  { value: 'return', label: 'Возврат' },
  { value: 'writeoff', label: 'Списание' },
  { value: 'inventory', label: 'Инвентаризация' },
  { value: 'correction', label: 'Корректировка' },
  { value: 'transfer', label: 'Перемещение' },
  { value: 'supplier_return', label: 'Возврат поставщику' },
  { value: 'production', label: 'Производство' },
  { value: 'processing', label: 'Переработка' },
  { value: 'cancel', label: 'Отмена' },
];
const pageSize = 100;

type Scope = Pick<WarehouseReportFilter<'movements'>, 'warehouseId' | 'warehouseIds'>;
type Props = Scope & {
  ingredientId: string;
  ingredientName: string;
  locations: WarehouseLocation[];
  initialPeriod?: WarehousePeriod;
  initialCustom?: { from: string; to: string };
  onClose: () => void;
};

function EmployeeFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const staff = useStaff('', '');
  return <Select title="Сотрудник" value={value} onChange={onChange} style={{ ...styles.filter, width: 144 }}
    options={[{ value: '', label: 'Все сотрудники' }, ...(staff.data ?? []).map(({ id, name }) => ({ value: id, label: name, translate: false }))]} />;
}

export function WarehouseMovementJournal({
  ingredientId, ingredientName, locations, warehouseId, warehouseIds, initialPeriod = 'week',
  initialCustom = { from: '', to: '' }, onClose,
}: Props) {
  const { width } = useWindowDimensions();
  const { canSection, canAction } = usePermissions();
  const canExport = canAction('exportReports');
  const [period, setPeriod] = useState(initialPeriod);
  const [custom, setCustom] = useState(initialCustom);
  const [type, setType] = useState<StockMovementType | ''>('');
  const [employee, setEmployee] = useState('');
  const [page, setPage] = useState(1);
  const [source, setSource] = useState<WarehouseReportMovementRow | null>(null);
  const [outputAction, setOutputAction] = useState<'csv' | 'print' | null>(null);
  const [outputError, setOutputError] = useState('');
  const output = useRef<AbortController | null>(null);
  useEffect(() => () => output.current?.abort(), []);
  const now = new Date();
  const today = warehouseLocalTime(now).date;
  const range = warehouseReportRange(period, now, custom);
  const rangeReady = period !== 'custom' || (isAllowedDate(custom.from, undefined, custom.to) && isAllowedDate(custom.to, custom.from, today));
  const params: WarehouseReportFilter<'movements'> = {
    view: 'movements', warehouseId, warehouseIds, ingredientId, ...range, type: type || undefined,
    employeeId: employee || undefined, page, pageSize,
  };
  const report = useWarehouseReport(params, rangeReady);
  const selectedWarehouses = locations.filter(({ id }) => warehouseIds?.length ? warehouseIds.includes(id) : id === warehouseId);
  const warehouseLabel = selectedWarehouses.length
    ? 'Склады: ' + selectedWarehouses.map(({ name }) => name).join(', ')
    : 'Все склады';
  const cellWidth = (index: number) => width < 1024 ? Math.round(columns[index].width * 0.87) : columns[index].width;

  async function runOutput(action: 'csv' | 'print') {
    if (output.current || !rangeReady || !report.isSuccess || (action === 'csv' && !canExport)) return;
    const controller = new AbortController();
    output.current = controller;
    setOutputAction(action);
    setOutputError('');
    try {
      if (action === 'csv') {
        const csv = await getMovementCsv(params, controller.signal);
        await shareCsvText(`Склад-movements-${range.from ?? 'всё-время'}`, csv, controller.signal);
      } else {
        await printWarehouseMovement(report.data, { ingredientName, warehouseLabel }, controller.signal);
      }
    } catch (error) {
      if (!controller.signal.aborted) setOutputError(apiError(error));
    } finally {
      output.current = null;
      if (!controller.signal.aborted) setOutputAction(null);
    }
  }

  function close() {
    output.current?.abort();
    onClose();
  }

  return <WarehouseWorkspace title="Движение товара" onClose={close}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.context}>
        <Text style={styles.name}>{ingredientName}</Text>
        <Text style={styles.muted}>{warehouseLabel}</Text>
      </View>
      <Card style={styles.card}>
        <View style={styles.toolbar}>
        <View style={styles.filters}>
          {canExport && <Button icon="export" title="Экспорт CSV" size="md" variant="secondary" style={styles.button} loading={outputAction === 'csv'}
            disabled={!rangeReady || !report.isSuccess || outputAction !== null} onPress={() => void runOutput('csv')} />}
          <Button icon="adminPrinter" title="Печать" size="md" variant="secondary" style={styles.button} loading={outputAction === 'print'}
            disabled={!rangeReady || !report.isSuccess || outputAction !== null} onPress={() => void runOutput('print')} />
        </View>
        <View style={styles.filters}>
          <Select title="Период отчёта" value={period} options={movementPeriods} style={{ ...styles.filter, width: 166 }}
            onChange={(value) => { setPeriod(value); setPage(1); }} />
          {canSection('staff') && <EmployeeFilter value={employee} onChange={(value) => { setEmployee(value); setPage(1); }} />}
          <Select title="Тип движения" value={type} options={movementTypes} style={{ ...styles.filter, width: 178 }}
            onChange={(value) => { setType(value); setPage(1); }} />
        </View>
        {period === 'custom' && <View style={styles.filters}>
          <DateField label="С даты" value={custom.from} maximumDate={parseIsoDate(today) ?? undefined}
            containerStyle={styles.dateFilter} onChangeText={(from) => { setCustom({ ...custom, from }); setPage(1); }} />
          <DateField label="По дату" value={custom.to} minimumDate={parseIsoDate(custom.from) ?? undefined}
            maximumDate={parseIsoDate(today) ?? undefined} containerStyle={styles.dateFilter}
            onChangeText={(to) => { setCustom({ ...custom, to }); setPage(1); }} />
        </View>}
        {outputError ? <Text style={styles.error} accessibilityRole="alert">{outputError}</Text> : null}
        </View>
        {!rangeReady ? <Text style={[styles.muted, styles.empty]} translate>Укажите начало и конец периода.</Text>
          : report.isPending ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          : report.isError ? <View style={styles.toolbar}>
            <Text style={styles.error} accessibilityRole="alert">{apiError(report.error)}</Text>
            <Button title="Повторить" variant="secondary" size="md" onPress={() => void report.refetch()} />
          </View> : <>
            <View style={[styles.spread, styles.totals]}>
              <Text style={styles.muted}>{report.data.totalRows} строк</Text>
              <Text style={styles.total}>Итого: {cost(report.data.totalCost)}</Text>
              {!!report.data.totalValuationAdjustment && <Text style={[styles.muted, styles.adjustment]}>
                Корректировка оценки: {balanceMoney(report.data.totalValuationAdjustment)}
              </Text>}
            </View>
            {report.data.rows.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled">
              <View>
                <View style={[styles.row, styles.header]}>
                  {columns.map(({ label }, index) => <Text key={label} style={[styles.heading, styles.cell, { width: cellWidth(index) }]} translate>{label}</Text>)}
                </View>
                {report.data.rows.map((row) => {
                  const cells = journalMovementValues(row);
                  return <View key={row.id} style={styles.row}>
                    {cells.map((value, index) => <View key={columns[index].label} style={[styles.cell, { width: cellWidth(index) }]}>
                      <Text style={[styles.value, index >= 2 && styles.numeric]}>{value}</Text>
                      {index === 0 && row.createdAt && <Text style={styles.muted}>{warehouseTimeDisplay(row.createdAt)}</Text>}
                    </View>)}
                    <View style={[styles.cell, { width: cellWidth(6) }]}>
                      <MovementSourceLink movement={row} fallback="Текущий остаток" onOpen={() => setSource(row)} />
                      {row.employeeName && <Text style={styles.muted}>{row.employeeName}</Text>}
                    </View>
                  </View>;
                })}
              </View>
            </ScrollView> : <Text style={[styles.muted, styles.empty]} translate>По выбранным условиям движений нет.</Text>}
            {report.data.totalRows > pageSize || page > 1 ? <View style={[styles.spread, styles.totals]}>
              <Button title="Назад" size="md" variant="secondary" disabled={page === 1} onPress={() => setPage(page - 1)} />
              <Text style={styles.muted}>{page} / {Math.max(1, Math.ceil(report.data.totalRows / pageSize))}</Text>
              <Button title="Далее" size="md" variant="secondary" disabled={page * pageSize >= report.data.totalRows}
                onPress={() => setPage(page + 1)} />
            </View> : null}
          </>}
      </Card>
    </ScrollView>
    {source && <MovementSourcePage movement={source} locations={locations} onClose={() => setSource(null)} />}
  </WarehouseWorkspace>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.sm },
  context: { gap: 2, paddingHorizontal: spacing.xs },
  card: { padding: 0, overflow: 'hidden', elevation: 0, shadowOpacity: 0 },
  toolbar: { padding: spacing.md, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  filter: { height: 36, maxWidth: '100%', borderRadius: 6, paddingHorizontal: spacing.sm, gap: 6 },
  dateFilter: { flex: 1, minWidth: 130 },
  button: { height: 36, borderRadius: 6, paddingHorizontal: spacing.md },
  spread: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs },
  totals: { padding: spacing.md },
  total: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  adjustment: { width: '100%', textAlign: 'right' },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  header: { backgroundColor: colors.background },
  cell: { paddingVertical: spacing.sm, paddingHorizontal: 10 },
  heading: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  value: { color: colors.textPrimary, fontSize: 13 },
  numeric: { fontVariant: ['tabular-nums'] },
  muted: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13 },
  empty: { padding: spacing.xl, alignItems: 'center', textAlign: 'center' },
});
