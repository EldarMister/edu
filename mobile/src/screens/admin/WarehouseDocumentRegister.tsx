import React, { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { DateField } from '@/components/DateField';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Alert, Text, TextInput } from '@/components/typography';
import { Button } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useStockDocuments, type StockDocument } from '@/services/api/stockDocuments';
import type { WarehouseLocation } from '@/services/api/warehouse';
import { colors, spacing, useThemeColors } from '@/theme';
import { balanceMoney } from '@/utils/warehouseBalance';
import { documentDisplayStatus, documentOperationDate, STOCK_DOCUMENT_STATUS } from '@/utils/warehouseDocumentForm';
import { warehouseLocalTime, warehouseReportRange, warehouseTimeDisplay, type WarehousePeriod } from '@/utils/warehouseTiming';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';
import { shareCsv } from './print';
import { noWriteoffReason, useWriteoffReasonOptions, writeoffReasonLabel } from './WarehouseWriteoffReasonField';


const PERIODS: { value: WarehousePeriod; label: string }[] = [
  { value: 'all', label: 'За всё время' }, { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' }, { value: 'week', label: 'Последние 7 дней' },
  { value: 'month', label: 'Последние 30 дней' }, { value: 'currentMonth', label: 'Этот месяц' },
  { value: 'lastMonth', label: 'Прошлый месяц' }, { value: 'custom', label: 'Выбрать период' },
];
const PAGE_SIZE = 25;
const products = (document: StockDocument) => document.productNames?.length
  ? document.productNames.join(', ') + (document.itemsCount > document.productNames.length ? '…' : '')
  : document.itemsCount ? document.itemsCount + ' позиций' : 'Без продуктов';
const actor = (document: StockDocument) => document.postedByName ?? document.createdByName ?? '—';
const mode = (document: StockDocument) => document.mode === 'full' ? 'Полная' : 'Частичная';
const sign = (amount: number) => amount > 0 ? '+' : amount < 0 ? '−' : '';

function displayDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  const includeYear = warehouseLocalTime(date).date.slice(0, 4) !== warehouseLocalTime().date.slice(0, 4);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', ...(includeYear ? { year: 'numeric' } : {}), timeZone: 'Asia/Bishkek',
  }) + ', ' + warehouseLocalTime(date).time;
}

export interface DocumentRegisterScope {
  warehouseId?: string;
  locations: WarehouseLocation[];
  warehouseFilter?: ReactNode;
  onResetWarehouse?: () => void;
}

export function WarehouseDocumentRegister({
  kind, warehouseId, locations, warehouseFilter, onResetWarehouse, showCost, canCreate, onCreate, onOpen, onCopy, canExport,
}: DocumentRegisterScope & {
  kind: 'inventory' | 'transfer' | 'writeoff'; showCost: boolean; canCreate: boolean;
  onCreate?: () => void; onOpen: (id: string) => void;
  onCopy?: (id: string) => void; canExport?: boolean;
}) {
  const inventory = kind === 'inventory';
  const transfer = kind === 'transfer';
  const { options: reasonOptions } = useWriteoffReasonOptions(kind === 'writeoff');
  const defaultPeriod = transfer ? 'month' : 'all';
  const { width } = useWindowDimensions();
  const palette = useThemeColors();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [transferLocations, setTransferLocations] = useState<string[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);
  const [period, setPeriod] = useState<WarehousePeriod>(defaultPeriod);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [warehouseId]);
  const range = warehouseReportRange(period, new Date(), custom);
  const validDates = period !== 'custom' || (!!custom.from && !!custom.to && custom.from <= custom.to);
  const query = useStockDocuments(kind, warehouseId, search);
  const names = new Map(locations.map(({ id, name }) => [id, name]));
  const warehouseName = (document: StockDocument) => (names.get(document.warehouseId) ?? 'Склад')
    + (document.destinationWarehouseId ? ' → ' + (names.get(document.destinationWarehouseId) ?? 'Склад') : '');
  const options = [...new Set([...categories, ...(query.data ?? []).flatMap((document) => document.categories ?? [])])]
    .sort((a, b) => a.localeCompare(b, 'ru')).map((value) => ({ value, label: value, translate: false }));
  const employeeOptions = [...new Set([...employees, ...(query.data ?? []).map(actor).filter((name) => name !== '—')])]
    .sort((a, b) => a.localeCompare(b, 'ru')).map((value) => ({ value, label: value, translate: false }));
  const rows = validDates ? (query.data ?? []).filter((document) => {
    const date = warehouseLocalTime(documentOperationDate(document)).date;
    return (!status || documentDisplayStatus(document) === status) && (!reason || (document.writeoffReasonId ?? document.reason ?? noWriteoffReason) === reason)
      && (!categories.length || document.categories?.some((category) => categories.includes(category)))
      && (!employees.length || employees.includes(actor(document)))
      && (!transferLocations.length || transferLocations.includes(document.warehouseId)
        || (!!document.destinationWarehouseId && transferLocations.includes(document.destinationWarehouseId)))
      && (!range.from || date >= range.from) && (!range.to || date <= range.to);
  }).sort((a, b) => (Date.parse(documentOperationDate(a)) - Date.parse(documentOperationDate(b))) * (ascending ? 1 : -1)) : [];
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(1, pages));
  const visible = inventory ? rows : rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtered = !!(search || status || reason || categories.length || employees.length || transferLocations.length || warehouseId || period !== 'all');
  const amount = (value: number | null) => value == null ? '—' : (inventory ? sign(value) : '') + balanceMoney(Math.abs(value));
  const total = rows.some((document) => document.varianceValue == null) ? null
    : rows.reduce((sum, document) => sum + (inventory ? document.varianceValue! : Math.abs(document.varianceValue!)), 0);
  const filter = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  const reset = () => {
    setSearch(''); setStatus(''); setReason(''); setCategories([]); setPeriod('all');
    setEmployees([]); setTransferLocations([]);
    setCustom({ from: '', to: '' }); setPage(1); onResetWarehouse?.();
  };
  const columns = inventory
    ? ['Склад', 'Проверка остатков на', 'Дата и время проведения', 'Тип', ...(showCost ? ['Результат'] : []), 'Статус', '']
    : transfer
      ? ['Дата', 'Наименование', ...(showCost ? ['Сумма'] : []), 'Сотрудник', 'Склады', '']
      : ['Дата', 'Склад', 'Товары', ...(showCost ? ['Сумма'] : []), 'Сотрудник', 'Причина', ''];
  const dateColumn = inventory ? 1 : 0;
  const columnWidth = (index: number) => (columns[index] === 'Товары' || columns[index] === 'Наименование') ? 200 : columns[index] ? 125 : 75;
  const cells = (document: StockDocument) => inventory
    ? [warehouseName(document), document.countedAt || document.postedAt ? displayDate(document.countedAt ?? document.postedAt) : 'При проведении',
      displayDate(document.postedAt), mode(document), ...(showCost ? [amount(document.varianceValue)] : []), STOCK_DOCUMENT_STATUS[documentDisplayStatus(document)]]
    : [displayDate(documentOperationDate(document)), ...(!transfer ? [warehouseName(document)] : []), products(document),
      ...(showCost ? [amount(document.varianceValue)] : []), actor(document), transfer ? warehouseName(document) : writeoffReasonLabel(document)];
  const periodControl = <Select title="Период" value={period} options={PERIODS} onChange={filter(setPeriod)} style={styles.filter} />;
  const canAdd = canCreate && !!onCreate;
  const copyButton = (document: StockDocument) => onCopy && <FastPressable style={[styles.textAction, styles.copyButton]}
    accessibilityRole="button" onPress={() => onCopy(document.id)}><Text style={styles.link} translate>Копировать</Text></FastPressable>;

  return <View style={[styles.surface, { backgroundColor: palette.card, borderColor: palette.border }]}>
    {(inventory || canCreate || canExport) && <View style={[styles.toolbar, styles.actions]}>
      <View style={styles.wrap}>
        {inventory && query.isSuccess ? <Text style={styles.muted}>Всего: {rows.length}</Text> : null}
        {inventory ? periodControl : null}
        {canExport && <Button icon="export" title="Экспорт CSV" variant="secondary" size="md" disabled={!rows.length} onPress={() => {
          void shareCsv('Перемещения', [columns.slice(0, -1), ...rows.map(cells)])
            .catch((error) => Alert.alert('Экспорт перемещений', apiError(error)));
        }} />}
      </View>
      {canCreate ? <Button title="Добавить" size="md" disabled={!canAdd} onPress={() => onCreate?.()} /> : null}
    </View>}
    <View style={styles.toolbar}>
      <View style={styles.search}>
        <PwaIcon name="search" size={15} color={colors.textMuted} />
        <TextInput accessibilityLabel="Поиск документов" placeholder={inventory ? 'Быстрый поиск' : 'Поиск...'} value={search}
          onChangeText={filter(setSearch)} maxLength={200} style={styles.searchInput} />
      </View>
      <View style={styles.wrap}>
        {!inventory ? periodControl : null}
        {transfer ? <>
          <WarehouseMultiSelect label="Склады" value={transferLocations} options={locations.map(({ id, name }) => ({ value: id, label: name, translate: false }))}
            style={styles.filter} onChange={filter(setTransferLocations)} />
          <WarehouseMultiSelect label="Сотрудник" value={employees} options={employeeOptions} style={styles.filter} onChange={filter(setEmployees)} />
        </> : warehouseFilter}
        {kind === 'writeoff' ? <>
          <WarehouseMultiSelect label="Категории" value={categories} options={options} style={styles.filter} onChange={filter(setCategories)} />
          <Select title="Причина списания" value={reason} options={[{ value: '', label: 'Причина' },
            { value: noWriteoffReason, label: 'Без причины' }, ...reasonOptions]} onChange={filter(setReason)} style={styles.filter} />
        </> : null}
        <Select title="Статус документа" value={status} options={[{ value: '', label: status ? 'Все статусы' : '+ Фильтр' },
          ...Object.entries(STOCK_DOCUMENT_STATUS).filter(([value]) => inventory || value !== 'reopened')
            .map(([value, label]) => ({ value, label }))]} style={styles.filter} onChange={filter(setStatus)} />
      </View>
      {period === 'custom' ? <View style={styles.wrap}>
        <DateField label="С даты" value={custom.from} containerStyle={styles.dateField} onChangeText={(from) => filter(setCustom)({ ...custom, from })} />
        <DateField label="По дату" value={custom.to} containerStyle={styles.dateField} onChangeText={(to) => filter(setCustom)({ ...custom, to })} />
      </View> : null}
      {filtered ? <FastPressable style={styles.textAction} accessibilityRole="button" onPress={reset}>
        <Text style={styles.muted} translate>Сбросить всё</Text>
      </FastPressable> : null}
    </View>
    {!validDates ? <Text style={[styles.empty, styles.error]} translate>Укажите начало и конец периода.</Text>
      : query.isPending ? <ActivityIndicator color={colors.primary} />
      : query.isError && !query.data ? <View style={styles.toolbar}>
        <Text style={styles.error} accessibilityRole="alert">{apiError(query.error)}</Text>
        <Button title="Повторить" variant="secondary" size="md" onPress={() => void query.refetch()} />
      </View> : !rows.length ? <Text style={styles.empty} translate>{filtered ? 'Ничего не найдено' : inventory ? 'Здесь будут инвентаризации' : transfer ? 'Здесь будут перемещения' : 'Здесь будут списания'}</Text>
      : width >= 768 ? <ScrollView horizontal keyboardShouldPersistTaps="handled">
        <View>
          <View style={styles.tableRow}>
            {columns.map((column, index) => index === dateColumn
              ? <FastPressable key={column} accessibilityRole="button" style={[styles.cell, { width: columnWidth(index) }]} onPress={() => filter(setAscending)(!ascending)}>
                <Text style={styles.muted}>{column} {ascending ? '↑' : '↓'}</Text>
              </FastPressable>
              : <Text key={column} style={[styles.muted, styles.cell, { width: columnWidth(index) }]} translate>{column}</Text>)}
          </View>
          {visible.map((document) => <View key={document.id} style={styles.tableRow}>
            <FastPressable accessibilityRole="button" style={styles.tableCells} onPress={() => onOpen(document.id)}>
              {[...cells(document), document.status === 'draft' ? 'Ред.' : 'Открыть'].map((value, index) =>
                <Text key={index} numberOfLines={2} style={[styles.cell, { width: columnWidth(index) }, (index === 0 || index === columns.length - 1) && styles.link]}>{value}</Text>)}
            </FastPressable>
            {copyButton(document)}
          </View>)}
        </View>
      </ScrollView> : visible.map((document) => <View key={document.id} style={styles.entry}>
        <FastPressable accessibilityRole="button" style={styles.entryContent} onPress={() => onOpen(document.id)}>
        <View style={styles.actions}>
          <Text style={[styles.link, styles.entryTitle]}>{inventory ? warehouseName(document) : products(document)}</Text>
          {showCost ? <Text>{amount(document.varianceValue)}</Text> : null}
        </View>
        <Text style={styles.muted}>{inventory && !document.countedAt && !document.postedAt ? 'При проведении' : displayDate(documentOperationDate(document))} · {inventory ? mode(document) : warehouseName(document)}</Text>
        {kind === 'writeoff' ? <Text style={styles.muted}>Причина: {writeoffReasonLabel(document)}</Text> : null}
        <View style={styles.actions}>
          <Text style={[styles.status, document.status === 'posted' && styles.posted]} translate>{STOCK_DOCUMENT_STATUS[documentDisplayStatus(document)]}</Text>
          <Text style={styles.muted}>{inventory && document.postedAt && !document.reopenedAt ? 'Проведена ' + warehouseTimeDisplay(document.postedAt) : actor(document)}</Text>
        </View>
        </FastPressable>
        {copyButton(document)}
      </View>)}
    {rows.length > 0 && <View style={[styles.footer, styles.wrap]}>
      {!inventory ? <>
        <PageButton label="Первая страница" caption="«" disabled={currentPage <= 1} onPress={() => setPage(1)} />
        <PageButton label="Предыдущая страница" caption="‹" disabled={currentPage <= 1} onPress={() => setPage(currentPage - 1)} />
        <Text style={styles.muted}>Страница {currentPage} из {pages}</Text>
        <PageButton label="Следующая страница" caption="›" disabled={currentPage >= pages} onPress={() => setPage(currentPage + 1)} />
        <PageButton label="Последняя страница" caption="»" disabled={currentPage >= pages} onPress={() => setPage(pages)} />
      </> : null}
      {showCost ? <Text style={styles.muted}>{inventory ? 'Результат' : 'Сумма'}: {amount(total)}</Text> : null}
    </View>}
  </View>;
}

function PageButton({ label, caption, disabled, onPress }: { label: string; caption: string; disabled: boolean; onPress: () => void }) {
  return <FastPressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.pageButton, disabled && { opacity: 0.35 }]}><Text>{caption}</Text></FastPressable>;
}

const styles = StyleSheet.create({
  surface: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  toolbar: { gap: spacing.sm, padding: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  filter: { height: 36, borderRadius: 6, paddingHorizontal: 9 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 20 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, paddingVertical: 4 },
  dateField: { flex: 1, minWidth: 120 },
  entry: { gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  entryContent: { gap: 8 },
  entryTitle: { flexShrink: 1, fontWeight: '500' },
  link: { color: colors.primary },
  muted: { color: colors.textMuted, fontSize: 12 },
  status: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  posted: { color: colors.success },
  error: { color: colors.danger },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  tableCells: { flexDirection: 'row', alignItems: 'center' },
  copyButton: { paddingHorizontal: 10, alignSelf: 'center' },
  cell: { paddingHorizontal: 10, paddingVertical: 11, fontSize: 13 },
  empty: { padding: spacing.lg, textAlign: 'center', color: colors.textMuted },
  textAction: { alignSelf: 'flex-start', minHeight: 30, justifyContent: 'center' },
  footer: { paddingHorizontal: 12, paddingVertical: 7, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  pageButton: { minHeight: 32, minWidth: 24, alignItems: 'center', justifyContent: 'center' },
});
