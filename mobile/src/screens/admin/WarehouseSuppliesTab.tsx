import { useColumnPreference } from '@/hooks/useColumnPreference';
import React, { useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button, Card } from '@/components/ui';
import { DateField } from '@/components/DateField';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import {
  purchaseNumber, purchaseWorkbookUrl, useIngredients, usePurchase, usePurchases, useWarehouseSuppliers,
  type Purchase, type PurchaseListFilter, type WarehouseLocation,
} from '@/services/api/warehouse';
import { colors, radius, spacing } from '@/theme';
import { balanceMoney, balanceQuantity } from '@/utils/warehouseBalance';
import { warehouseLocalTime, warehouseReportRange, warehouseTimeDisplay, type WarehousePeriod } from '@/utils/warehouseTiming';
import { isAllowedDate, parseIsoDate } from '@/utils/calendarDate';
import { PurchaseEditor } from './WarehousePurchaseEditor';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';
import { WarehouseWorkbook } from './WarehouseWorkbook';

const PAGE_SIZE = 25;
const columns = [
  { value: 'number', label: '№', width: 92 },
  { value: 'date', label: 'Дата', width: 124 },
  { value: 'supplier', label: 'Поставщик', width: 130 },
  { value: 'warehouse', label: 'Склад', width: 115 },
  { value: 'products', label: 'Товары', width: 152 },
  { value: 'note', label: 'Комментарий', width: 160 },
  { value: 'status', label: 'Статус', width: 110 },
  { value: 'totalAmount', label: 'Сумма', width: 105 },
] as const;
type Column = typeof columns[number]['value'];
const defaults: Column[] = columns.map(({ value }) => value);
const statuses = [
  { value: '', label: 'Все статусы' }, { value: 'completed', label: 'Проведённые' },
  { value: 'draft', label: 'Черновики' }, { value: 'cancelled', label: 'Отменённые' },
];
const periods: { value: WarehousePeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' }, { value: 'week', label: 'Последние 7 дней' },
  { value: 'month', label: 'Последние 30 дней' }, { value: 'currentMonth', label: 'Этот месяц' },
  { value: 'lastMonth', label: 'Прошлый месяц' }, { value: 'all', label: 'За всё время' },
  { value: 'custom', label: 'Выбрать период' },
];
const uniqueOptions = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => !!value))]
  .sort((a, b) => a.localeCompare(b, 'ru')).map((value) => ({ value, label: value, translate: false }));

export function WarehouseSuppliesTab({ warehouseId, warehouseFilter, defaultWarehouse, locationName, onResetWarehouse }: {
  warehouseId?: string; warehouseFilter?: ReactNode; defaultWarehouse?: WarehouseLocation;
  locationName: (id?: string | null) => string; onResetWarehouse: () => void;
}) {
  const { canAction } = usePermissions();
  const canEdit = canAction('warehouseReceive') && canAction('warehouseCosts');
  const wide = useWindowDimensions().width >= 1024;
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<{ id: string | null; correcting?: boolean } | null>(null);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [search, setSearch] = useState('');
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [showStatus, setShowStatus] = useState(false);
  const [period, setPeriod] = useState<WarehousePeriod>('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [ascending, setAscending] = useState(false);
  const [selectedColumns, setSelectedColumns] = useColumnPreference('warehouse-supplies', defaults);
  const today = warehouseLocalTime().date;
  const range = warehouseReportRange(period, new Date(), custom);
  const validDates = period !== 'custom'
    || isAllowedDate(custom.from, undefined, custom.to || today) && isAllowedDate(custom.to, custom.from, today);
  const filters: PurchaseListFilter = {
    ...range, search: search.trim() || undefined, warehouseId, status: status || undefined,
    suppliers: selectedSuppliers, categories: selectedCategories, dateSort: ascending ? 'asc' : 'desc',
  };
  const query = usePurchases(filters, validDates);
  const suppliers = useWarehouseSuppliers();
  const items = useIngredients('');
  const records = validDates ? query.data ?? [] : [];
  const filtered = search || status || warehouseId || period !== 'all' || selectedSuppliers.length || selectedCategories.length;
  const actualColumns = columns.filter(({ value }) => value === 'number' || selectedColumns.includes(value));
  const selectedTotal = selectedColumns.includes('totalAmount');
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const currentRows = records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const update = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
    setExpanded(new Set());
  };
  function choosePeriod(next: WarehousePeriod) {
    if (next === 'custom' && !custom.from && !custom.to) {
      const startingRange = period === 'all' ? warehouseReportRange('month') : range;
      setCustom({ from: startingRange.from ?? today, to: startingRange.to ?? today });
    }
    update(setPeriod)(next);
  }

  function cell(purchase: Purchase, key: Column) {
    switch (key) {
      case 'number': return purchaseNumber(purchase.number);
      case 'date': return warehouseTimeDisplay(purchase.effectiveAt ?? purchase.date);
      case 'supplier': return purchase.supplier;
      case 'warehouse': return locationName(purchase.warehouseId);
      case 'products': return purchase.productNames?.length
        ? purchase.productNames.join(', ') + (purchase.itemsCount > purchase.productNames.length ? '…' : '')
        : '—';
      case 'note': return purchase.note || '—';
      case 'status': return purchase.status === 'completed' ? 'Проведена' : purchase.status === 'draft' ? 'Черновик' : 'Отменена';
      case 'totalAmount': return balanceMoney(purchase.totalAmount);
    }
  }

  function toggleLines(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function actions(purchase: Purchase) {
    const isExpanded = expanded.has(purchase.id);
    return <View style={styles.actions}>
      <FastPressable style={styles.linkAction} accessibilityRole="button" accessibilityState={{ expanded: isExpanded }}
        onPress={() => toggleLines(purchase.id)}>
        <Text style={[styles.link, isExpanded && styles.strong]} translate>Детали</Text>
      </FastPressable>
      {canEdit && purchase.status !== 'cancelled' && <FastPressable style={styles.linkAction} accessibilityRole="button"
        accessibilityLabel={'Редактировать поставку ' + purchase.number}
        onPress={() => setOpened({ id: purchase.id, correcting: purchase.status === 'completed' })}>
        <Text style={styles.link} translate>Ред.</Text>
      </FastPressable>}
    </View>;
  }

  return <Card style={styles.surface}>
    <View style={styles.toolbar}>
      <View style={styles.actions}>
        <WarehouseMultiSelect label="Столбцы" value={selectedColumns.filter((value) => value !== 'number')}
          options={columns.filter((column) => column.value !== 'number').map(({ value, label }) => ({ value, label }))}
          style={styles.control} onChange={(value) => setSelectedColumns(['number', ...value])} />
        {canEdit && canAction('exportReports') && <WarehouseWorkbook disabled={!validDates}
          url={purchaseWorkbookUrl(filters, actualColumns.map(({ value }) => value))} filename="Поставки.xlsx" />}
        <Select title="Период поставок" value={period} options={periods} onChange={choosePeriod} style={styles.control} />
        {canEdit && <Button title="Добавить" size="md" disabled={!defaultWarehouse} onPress={() => setOpened({ id: null })} />}
      </View>
      <View style={styles.search}>
        <PwaIcon name="search" size={15} color={colors.textMuted} />
        <TextInput accessibilityLabel="Поиск поставок" maxLength={160} placeholder="Быстрый поиск" style={styles.searchInput}
          value={search} onChangeText={update(setSearch)} />
      </View>
      <View style={styles.actions}>
        <WarehouseMultiSelect label="Поставщик" value={selectedSuppliers} style={styles.control}
          options={uniqueOptions([...selectedSuppliers, ...(suppliers.data ?? []).map((entry) => entry.name), ...records.map((entry) => entry.supplier)])}
          onChange={update(setSelectedSuppliers)} />
        {warehouseFilter}
        <WarehouseMultiSelect label="Категории" value={selectedCategories} style={styles.control}
          options={uniqueOptions([...selectedCategories, ...(items.data ?? []).map((entry) => entry.category)])} onChange={update(setSelectedCategories)} />
        {showStatus || status ? <View style={styles.actions}>
          <Select title="Статус" value={status} options={statuses} onChange={update(setStatus)} style={styles.control} />
          <FastPressable style={styles.linkAction} accessibilityRole="button" accessibilityLabel="Убрать фильтр статуса"
            onPress={() => { setShowStatus(false); update(setStatus)(''); }}><Text style={styles.muted}>×</Text></FastPressable>
        </View> : <Select title="Добавить фильтр поставки" placeholder="+ Фильтр" value="" style={styles.control}
          options={[{ value: 'status', label: 'Статус' }]} onChange={() => setShowStatus(true)} />}
      </View>
      {period === 'custom' ? <View style={styles.actions}>
        <DateField label="С даты" value={custom.from} containerStyle={styles.filter}
          maximumDate={parseIsoDate(custom.to || today) ?? undefined}
          onChangeText={(from) => update(setCustom)({ ...custom, from })} />
        <DateField label="По дату" value={custom.to} containerStyle={styles.filter}
          minimumDate={parseIsoDate(custom.from) ?? undefined} maximumDate={parseIsoDate(today) ?? undefined}
          onChangeText={(to) => update(setCustom)({ ...custom, to })} />
      </View> : null}
      {filtered ? <FastPressable accessibilityRole="button" style={styles.linkAction} onPress={() => {
        setSearch(''); setSelectedSuppliers([]); setSelectedCategories([]); setStatus(''); setShowStatus(false); setPeriod('all');
        setCustom({ from: '', to: '' }); onResetWarehouse(); setPage(1); setExpanded(new Set());
      }}><Text style={styles.link} translate>Сбросить всё</Text></FastPressable> : null}
    </View>
    {!validDates ? <Text style={styles.empty} translate>Укажите начало и конец периода.</Text>
      : query.isPending ? <ActivityIndicator color={colors.primary} />
      : query.isError ? <View style={styles.toolbar}>
        <Text style={styles.error} accessibilityRole="alert">{apiError(query.error)}</Text>
        <Button title="Повторить" size="md" variant="secondary" onPress={() => void query.refetch()} />
      </View> : <>
        {!records.length ? <Text style={styles.empty} translate>{filtered ? 'Поставки не найдены' : 'Поставок пока нет.'}</Text> : null}
        {wide && currentRows.length > 0 ? <ScrollView horizontal keyboardShouldPersistTaps="handled">
          <View>
            <View style={styles.tableRow}>
              {actualColumns.map(({ value, label, width }) => value === 'date'
                ? <FastPressable key={value} accessibilityRole="button" style={{ width }} onPress={() => update(setAscending)(!ascending)}>
                  <Text style={styles.muted}>Дата {ascending ? '↑' : '↓'}</Text>
                </FastPressable>
                : <Text key={value} style={[styles.muted, { width }]} translate>{label}</Text>)}
              <View style={styles.tableActions} />
            </View>
            {currentRows.map((purchase) => <View key={purchase.id}>
              <View style={styles.tableRow}>
                {actualColumns.map(({ value, width }) => value === 'number'
                  ? <FastPressable accessibilityRole="button" key={value} style={{ width }} onPress={() => setOpened({ id: purchase.id })}>
                    <Text style={styles.link}>{cell(purchase, value)}</Text></FastPressable>
                  : <Text key={value} numberOfLines={2} style={[styles.value, { width, paddingRight: spacing.sm }]}>{cell(purchase, value)}</Text>)}
                <View style={styles.tableActions}>{actions(purchase)}</View>
              </View>
              {expanded.has(purchase.id) && <SupplyLines id={purchase.id} />}
            </View>)}
          </View>
        </ScrollView> : currentRows.map((purchase) => <View style={styles.card} key={purchase.id}>
          <View style={styles.spread}>
            <FastPressable onPress={() => setOpened({ id: purchase.id })} accessibilityRole="button">
              <Text style={styles.link}>Поставка {purchaseNumber(purchase.number)}</Text>
            </FastPressable>
            {selectedTotal ? <Text style={[styles.value, styles.strong]}>{balanceMoney(purchase.totalAmount)}</Text> : null}
          </View>
          <View style={styles.values}>
            {actualColumns.filter(({ value }) => value !== 'number' && value !== 'totalAmount').map(({ value, label }) =>
              <View style={styles.metric} key={value}><Text style={styles.muted} translate>{label}</Text>
                <Text style={styles.value}>{cell(purchase, value)}</Text>
              </View>)}
          </View>
          {actions(purchase)}
          {expanded.has(purchase.id) && <SupplyLines id={purchase.id} />}
        </View>)}
        {!!records.length && selectedTotal && <View style={[styles.spread, styles.footer]}>
          <Text style={styles.value} translate>Итого</Text>
          <Text style={styles.value}>{balanceMoney(records.reduce((total, purchase) => total + purchase.totalAmount, 0))}</Text>
        </View>}
        {pages > 1 ? <View style={[styles.spread, styles.footer]}>
          <Button title="Назад" size="md" variant="secondary" disabled={currentPage === 1} onPress={() => setPage(currentPage - 1)} />
          <Text style={styles.muted}>{currentPage} / {pages}</Text>
          <Button title="Далее" size="md" variant="secondary" disabled={currentPage === pages} onPress={() => setPage(currentPage + 1)} />
        </View> : null}
      </>}
    {opened ? <PurchaseEditor key={opened.id ?? 'new'} purchaseId={opened.id} initialCorrecting={opened.correcting} warehouse={defaultWarehouse}
      warehouseLabel={locationName} onClose={() => setOpened(null)} /> : null}
  </Card>;
}

function SupplyLines({ id }: { id: string }) {
  const query = usePurchase(id);
  return <View style={styles.details}>
    {query.isPending ? <ActivityIndicator color={colors.primary} /> : query.isError ? <>
      <Text style={styles.error} accessibilityRole="alert">{apiError(query.error)}</Text>
      <Button title="Повторить" size="md" variant="secondary" onPress={() => void query.refetch()} />
    </> : <>
      <View style={[styles.spread, styles.detailRow]}>
        <Text style={[styles.muted, styles.lineName]} translate>Товар</Text>
        <Text style={[styles.muted, styles.lineNumber]} translate>Количество</Text>
        <Text style={[styles.muted, styles.lineNumber]} translate>Сумма</Text>
      </View>
      {!query.data.items?.length && <Text style={styles.muted} translate>В поставке нет позиций.</Text>}
      {query.data.items?.map((item) => <View style={[styles.spread, styles.detailRow]} key={item.id}>
        <Text style={[styles.value, styles.lineName]}>{item.ingredientName}</Text>
        <Text style={[styles.value, styles.lineNumber]}>{balanceQuantity(item.quantity, item.unit, item.packageId ? 'count' : undefined)}</Text>
        <Text style={[styles.value, styles.lineNumber]}>{balanceMoney(item.total)}</Text>
      </View>)}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  surface: { padding: 0, overflow: 'hidden' },
  toolbar: { padding: spacing.md, gap: spacing.sm },
  search: { minHeight: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, paddingVertical: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  control: { height: 36, borderRadius: radius.sm, paddingHorizontal: 9 },
  filter: { flex: 1, minWidth: 132 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  card: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 14, paddingHorizontal: 10, gap: 9 },
  tableRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 48, borderTopWidth: 1, borderTopColor: colors.border },
  tableActions: { width: 160 },
  values: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
  metric: { width: '50%', paddingRight: 14, gap: 2 },
  value: { fontSize: 14, color: colors.textPrimary },
  muted: { fontSize: 12, color: colors.textMuted },
  link: { color: colors.primary, fontWeight: '500', fontSize: 14 },
  linkAction: { minHeight: 32, minWidth: 28, alignItems: 'flex-start', justifyContent: 'center' },
  strong: { fontWeight: '600' },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  details: { paddingHorizontal: spacing.sm, backgroundColor: colors.background },
  detailRow: { minHeight: 33, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lineName: { flex: 1 },
  lineNumber: { width: '26%', textAlign: 'right', fontVariant: ['tabular-nums'] },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  error: { color: colors.danger },
});
