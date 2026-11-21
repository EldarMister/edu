import { useColumnPreference } from '@/hooks/useColumnPreference';
import React, { Fragment, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { DateField } from '@/components/DateField';
import { Select, type SelectOption } from '@/components/Select';
import { Button, Card } from '@/components/ui';
import { apiError } from '@/lib/api';
import { movementWorkbookUrl, useIngredients, useWarehouseReport, type WarehouseItemKind, type WarehouseLocation, type WarehouseMovementSummaryRow, type WarehouseReportFilter, type WarehouseReportMovementRow } from '@/services/api/warehouse';
import { usePermissions } from '@/hooks/usePermissions';
import { colors, radius, spacing } from '@/theme';
import { isAllowedDate, parseIsoDate } from '@/utils/calendarDate';
import { balanceMoney, balanceQuantity } from '@/utils/warehouseBalance';
import { warehouseLocalTime, warehouseReportRange, warehouseTimeDisplay, type WarehousePeriod } from '@/utils/warehouseTiming';
import { movementPeriods, WarehouseMovementJournal } from './WarehouseMovementJournal';
import { MovementSourceLink, MovementSourcePage } from './WarehouseMovementSource';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';
import { WarehouseWorkbook } from './WarehouseWorkbook';

const summaryPageSize = 50;
const detailPageSize = 20;
const kindLabels: Record<WarehouseItemKind, string> = {
  raw: 'Ингредиент', beverage: 'Товар', goods: 'Товар',
  preparation: 'Полуфабрикат', prepared_dish: 'Заготовленное блюдо', consumable: 'Расходник',
};
const kindOptions: SelectOption<WarehouseItemKind>[] = [
  { value: 'raw', label: 'Ингредиент' },
  { value: 'goods', label: 'Товар' },
  { value: 'preparation', label: 'Полуфабрикат' },
  { value: 'prepared_dish', label: 'Заготовленное блюдо' },
  { value: 'consumable', label: 'Расходник' },
];
const price = (value: number | null | undefined) => value == null ? '—' : balanceMoney(value);
const qty = (value: number, unit: string) => balanceQuantity(value, unit, ['шт', 'шт.', 'pcs'].includes(unit) ? 'count' : 'mass');
const boundaryCost = (cost: number | null, quantity: number, value: number | null) =>
  price(quantity === 0 && value === 0 ? 0 : cost);
const metrics = [
  { value: 'openingQuantity', label: 'Нач. остаток', get: (row: WarehouseMovementSummaryRow) => qty(row.openingQuantity, row.unit) },
  { value: 'openingAvgCost', label: 'Средняя себест. на начало', get: (row: WarehouseMovementSummaryRow) => boundaryCost(row.openingAvgCost, row.openingQuantity, row.openingValue) },
  { value: 'openingValue', label: 'Нач. сумма', get: (row: WarehouseMovementSummaryRow) => price(row.openingValue) },
  { value: 'incomingQuantity', label: 'Поступления', get: (row: WarehouseMovementSummaryRow) => qty(row.incomingQuantity, row.unit) },
  { value: 'outgoingQuantity', label: 'Расход', get: (row: WarehouseMovementSummaryRow) => qty(row.outgoingQuantity, row.unit) },
  { value: 'closingQuantity', label: 'Итог. остаток', get: (row: WarehouseMovementSummaryRow) => qty(row.closingQuantity, row.unit) },
  { value: 'closingAvgCost', label: 'Средняя себест. на конец', get: (row: WarehouseMovementSummaryRow) => boundaryCost(row.closingAvgCost, row.closingQuantity, row.closingValue) },
  { value: 'closingValue', label: 'Итог. сумма', get: (row: WarehouseMovementSummaryRow) => price(row.closingValue) },
];
const columnOptions = [{ value: 'kind', label: 'Тип' }, ...metrics];
const defaultColumns = columnOptions.map(({ value }) => value);
type NameCondition = NonNullable<WarehouseReportFilter<'movement_summary'>['nameCondition']>;
const nameConditions: SelectOption<NameCondition>[] = [
  { value: 'equals', label: 'Равно' }, { value: 'notEquals', label: 'Не равно' },
  { value: 'contains', label: 'Содержит' }, { value: 'empty', label: 'Пусто' },
  { value: 'notEmpty', label: 'Не пусто' },
];
const movementOptions: SelectOption<'' | 'true' | 'false'>[] = [
  { value: 'true', label: 'Только продукты с движением' },
  { value: 'false', label: 'Все продукты, в т.ч. без движения' },
];

function Pages({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  if (total <= pageSize && page === 1) return null;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return <View style={styles.pagination}>
    <Text style={styles.muted}>{Math.min(total, (page - 1) * pageSize + 1)}–{Math.min(total, page * pageSize)} из {total}</Text>
    <PageControl glyph="«" label="Первая страница" disabled={page <= 1} onPress={() => onChange(1)} />
    <PageControl glyph="‹" label="Предыдущая страница" disabled={page <= 1} onPress={() => onChange(page - 1)} />
    <Text style={styles.muted}>Страница {page} из {lastPage}</Text>
    <PageControl glyph="›" label="Следующая страница" disabled={page >= lastPage} onPress={() => onChange(page + 1)} />
    <PageControl glyph="»" label="Последняя страница" disabled={page >= lastPage} onPress={() => onChange(lastPage)} />
  </View>;
}

function PageControl({ glyph, label, disabled, onPress }: { glyph: string; label: string; disabled: boolean; onPress: () => void }) {
  return <FastPressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.pageControl, disabled && styles.disabledControl]}>
    <Text style={styles.pageGlyph}>{glyph}</Text>
  </FastPressable>;
}

const movementSections = [
  { direction: 'incoming', title: 'Поставки', types: [
    ['purchase', 'Поставка'], ['inventory', 'Инвентаризация'], ['processing', 'Переработка'],
  ] },
  { direction: 'outgoing', title: 'Расход', types: [
    ['order', 'Продажи'], ['writeoff', 'Ручное списание'], ['production', 'Производство'],
    ['inventory', 'Инвентаризация'], ['processing', 'Переработка'],
  ] },
] as const;

function Detail({ row, warehouseId, warehouseIds, from, to, onOpenJournal, onOpenSource }: {
  row: WarehouseMovementSummaryRow; warehouseId?: string; warehouseIds?: string[]; from?: string; to?: string;
  onOpenJournal: () => void;
  onOpenSource: (row: WarehouseReportMovementRow) => void;
}) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState({ incoming: true, outgoing: true });
  const [documents, setDocuments] = useState(false);
  const report = useWarehouseReport({ view: 'movements', warehouseId, warehouseIds, ingredientId: row.ingredientId, from, to, page, pageSize: detailPageSize });
  if (report.isPending) return <View style={styles.detail}><ActivityIndicator /></View>;
  if (report.isError) return <View style={styles.detail}>
    <Text style={styles.error}>{apiError(report.error)}</Text>
    <Button title="Повторить" variant="secondary" size="md" onPress={() => void report.refetch()} />
  </View>;
  return <View style={styles.detail}>
    <View style={styles.detailTable}>
    <View style={styles.detailRow}>
      <Text style={[styles.tableHeading, styles.documentName]} translate>Тип</Text>
      <Text style={[styles.tableHeading, styles.groupQuantity]} translate>Количество</Text>
      <Text style={[styles.tableHeading, styles.groupCost]} translate>Себестоимость</Text>
    </View>
    {movementSections.map(({ direction, title, types }) => {
      const groups = (report.data.movementGroups ?? []).filter((group) => group.direction === direction);
      const known = new Set<string>(types.map(([type]) => type));
      const rows = [
        ...types.map(([type, label]) => ({ type, label, group: groups.find((group) => group.sourceType === type) })),
        ...groups.filter((group) => !known.has(group.sourceType)).map((group) => ({
          type: group.sourceType, group,
          label: direction === 'incoming' && group.sourceType === 'order' ? 'Возврат продажи'
            : direction === 'outgoing' && group.sourceType === 'purchase' ? 'Отмена поставки' : group.label,
        })),
      ];
      return <Fragment key={direction}>
        <FastPressable accessibilityRole="button" accessibilityState={{ expanded: open[direction] }}
          onPress={() => setOpen((current) => ({ ...current, [direction]: !current[direction] }))} style={styles.groupHeading}>
          <PwaIcon name={open[direction] ? 'chevronDown' : 'chevronRight'} size={16} color={colors.textMuted} />
          <Text translate style={styles.label}>{title}</Text>
        </FastPressable>
        {open[direction] && rows.map(({ type, label, group }) => (
          <View key={type} style={styles.detailRow}>
            <Text translate style={[styles.body, styles.documentName]}>{label}</Text>
            <Text style={[styles.body, styles.groupQuantity]}>{group ? qty(group.quantity, group.unit) : '—'}</Text>
            <Text style={[styles.body, styles.groupCost]}>{group ? price(group.averageCost) : '—'}</Text>
          </View>
        ))}
      </Fragment>;
    })}
    </View>
    <View style={styles.journalActions}>
      <FastPressable accessibilityRole="button" accessibilityState={{ expanded: documents }}
        style={styles.linkControl} onPress={() => setDocuments(!documents)}>
        <PwaIcon name={documents ? 'chevronDown' : 'chevronRight'} size={14} color={colors.primary} />
        <Text style={styles.linkText}><Text translate>Документы</Text>{` · ${report.data.totalRows}`}</Text>
      </FastPressable>
      <FastPressable accessibilityRole="button" style={styles.linkControl} onPress={onOpenJournal}>
        <Text style={styles.linkText} translate>Открыть журнал</Text>
      </FastPressable>
    </View>
    {documents && <>
      {report.data.rows.length > 0 ? <ScrollView horizontal keyboardShouldPersistTaps="handled">
        <View style={styles.documentTable}>
          <View style={styles.detailRow}>
            <Text style={[styles.tableHeading, styles.documentDate]} translate>Дата</Text>
            <Text style={[styles.tableHeading, styles.documentName]} translate>Документ</Text>
            <Text style={[styles.tableHeading, styles.groupQuantity]} translate>Количество</Text>
            <Text style={[styles.tableHeading, styles.groupCost]} translate>Сумма</Text>
          </View>
          {report.data.rows.map((movement) => <View key={movement.id} style={styles.detailRow}>
            <Text style={[styles.body, styles.documentDate]}>{movement.createdAt ? warehouseTimeDisplay(movement.createdAt) : '—'}</Text>
            <View style={styles.documentName}>
              <MovementSourceLink movement={movement} fallback={movement.warehouseName} onOpen={() => onOpenSource(movement)} />
            </View>
            <Text style={[styles.body, styles.groupQuantity]}>{qty(movement.quantity, movement.unit)}</Text>
            <Text style={[styles.body, styles.groupCost]}>{price(movement.totalCost)}</Text>
          </View>)}
        </View>
      </ScrollView> : <Text style={styles.muted} translate>За этот период движений нет.</Text>}
      <Pages page={page} total={report.data.totalRows} pageSize={detailPageSize} onChange={setPage} />
    </>}
  </View>;
}

export function WarehouseMovementReport({ warehouseId, locations = [] }: {
  warehouseId?: string; locations?: WarehouseLocation[];
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 1024;
  const { canAction } = usePermissions();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<WarehousePeriod>('week');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [kinds, setKinds] = useState<WarehouseItemKind[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const [columns, setColumns] = useColumnPreference('warehouse-movements', defaultColumns);
  const [movement, setMovement] = useState<'' | 'true' | 'false'>('');
  const [nameCondition, setNameCondition] = useState<NameCondition | ''>('');
  const [nameValue, setNameValue] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sort, setSort] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [journal, setJournal] = useState<WarehouseMovementSummaryRow | null>(null);
  const [source, setSource] = useState<WarehouseReportMovementRow | null>(null);
  const now = new Date();
  const today = warehouseLocalTime(now).date;
  const range = warehouseReportRange(period, now, custom);
  const rangeReady = period !== 'custom' || (isAllowedDate(custom.from, undefined, custom.to) && isAllowedDate(custom.to, custom.from, today));
  const catalogue = useIngredients('', warehouseId);
  const categories = [...new Set((catalogue.data ?? []).map((item) => item.category).filter((name): name is string => !!name))].sort((a, b) => a.localeCompare(b, 'ru'));
  const scope = { warehouseId, warehouseIds: warehouses.length === 1 ? undefined : warehouses };
  if (warehouses.length === 1) scope.warehouseId = warehouses[0];
  const filters: WarehouseReportFilter<'movement_summary'> = {
    view: 'movement_summary', ...scope, ...range, search: search.trim() || undefined,
    kinds: kinds.includes('goods') ? [...kinds, 'beverage'] : kinds,
    categories: selectedCategories, onlyWithMovement: movement === 'true', nameSort: sort,
    nameCondition: nameCondition || undefined,
    nameValue: nameCondition && nameCondition !== 'empty' && nameCondition !== 'notEmpty' ? nameValue.trim() || undefined : undefined,
  };
  const report = useWarehouseReport({ ...filters, page, pageSize: summaryPageSize }, rangeReady);
  const visibleMetrics = metrics.filter(({ value }) => columns.includes(value));
  const showKind = columns.includes('kind');
  function refreshFilters() { setPage(1); setSelected(null); }

  return <Card style={styles.report}>
    <View style={styles.toolbar}>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <PwaIcon name="search" size={16} color={colors.textMuted} />
          <TextInput accessibilityLabel="Поиск продукта в движении" placeholder="Поиск…" value={search} maxLength={160}
            style={styles.searchInput} onChangeText={(value) => { setSearch(value); refreshFilters(); }} />
          {search ? <FastPressable accessibilityRole="button" accessibilityLabel="Очистить поиск" onPress={() => { setSearch(''); refreshFilters(); }} style={styles.clearSearch}>
            <PwaIcon name="close" size={14} color={colors.textMuted} />
          </FastPressable> : null}
        </View>
        <FastPressable accessibilityRole="button" accessibilityLabel="Действия отчёта" accessibilityState={{ expanded: actionsOpen }}
          style={styles.pageControl} onPress={() => setActionsOpen(!actionsOpen)}>
          <PwaIcon name="dotsVertical" size={22} color={colors.primary} />
        </FastPressable>
      </View>
      {actionsOpen && <View style={styles.actionPanel}>
        {!wide ? <FastPressable accessibilityRole="button" style={styles.linkControl}
          onPress={() => { setSort(sort === 'asc' ? 'desc' : 'asc'); refreshFilters(); }}>
          <Text style={styles.linkText}>Название {sort === 'asc' ? '↑' : '↓'}</Text>
        </FastPressable> : null}
        <WarehouseMultiSelect label="Столбцы" value={columns} options={columnOptions} style={styles.compactControl} onChange={setColumns} />
        {canAction('exportReports') ? <WarehouseWorkbook
          url={movementWorkbookUrl(filters, ['name', ...defaultColumns.filter((column) => columns.includes(column))])}
          filename="Движение-продуктов.xlsx" disabled={!rangeReady} /> : null}
      </View>}
      <View style={styles.filters}>
        <Select title="Период отчёта" value={period} options={movementPeriods} style={{ ...styles.compactControl, width: 166 }}
          onChange={(value) => { setPeriod(value); refreshFilters(); }} />
        {locations.length > 1 && <WarehouseMultiSelect label="Склад" value={warehouses} style={styles.compactControl}
          options={locations.map(({ id, name }) => ({ value: id, label: name, translate: false }))}
          onChange={(value) => { setWarehouses(value); refreshFilters(); }} />}
        <WarehouseMultiSelect label="Тип" value={kinds} options={kindOptions} style={styles.compactControl}
          onChange={(value) => { setKinds(value); refreshFilters(); }} />
        <WarehouseMultiSelect label="Категория" value={selectedCategories} style={styles.compactControl}
          options={categories.map((value) => ({ value, label: value, translate: false }))}
          onChange={(value) => { setSelectedCategories(value); refreshFilters(); }} />
        <Select title="Движение продуктов" placeholder="Движение продуктов" value={movement} options={movementOptions}
          style={{ ...styles.compactControl, width: movement ? 254 : 167 }}
          onChange={(value) => { setMovement(value); refreshFilters(); }} />
        {!nameCondition && <Select title="Добавить фильтр" placeholder="+ Фильтр" value=""
          options={[{ value: 'name', label: 'Название' }]} style={{ ...styles.compactControl, width: 104 }}
          onChange={() => { setNameCondition('equals'); refreshFilters(); }} />}
      </View>
      {nameCondition ? <View style={styles.filters}>
        <FastPressable accessibilityRole="button" accessibilityLabel="Убрать фильтр по названию"
          style={[styles.compactControl, styles.conditionLabel]} onPress={() => { setNameCondition(''); setNameValue(''); refreshFilters(); }}>
          <Text style={styles.body} translate>Название</Text>
          <PwaIcon name="close" size={14} color={colors.textMuted} />
        </FastPressable>
        <Select title="Условие по названию" options={nameConditions} value={nameCondition} style={{ ...styles.compactControl, width: 112 }}
          onChange={(value) => { setNameCondition(value); refreshFilters(); }} />
        {nameCondition !== 'empty' && nameCondition !== 'notEmpty' ? <TextInput accessibilityLabel="Значение названия"
          placeholder="Введите название" value={nameValue} maxLength={160} style={styles.conditionInput}
          onChangeText={(value) => { setNameValue(value); refreshFilters(); }} /> : null}
      </View> : null}
      {period === 'custom' && <View style={styles.filters}>
        <DateField label="С даты" value={custom.from} maximumDate={parseIsoDate(today) ?? undefined}
          containerStyle={styles.dateFilter} onChangeText={(from) => { setCustom({ ...custom, from }); refreshFilters(); }} />
        <DateField label="По дату" value={custom.to} minimumDate={parseIsoDate(custom.from) ?? undefined} maximumDate={parseIsoDate(today) ?? undefined}
          containerStyle={styles.dateFilter} onChangeText={(to) => { setCustom({ ...custom, to }); refreshFilters(); }} />
      </View>}
      {(search || period !== 'week' || kinds.length > 0 || selectedCategories.length > 0 || warehouses.length > 0 || movement || nameCondition || sort !== 'asc' || columns.length !== defaultColumns.length) && (
        <FastPressable accessibilityRole="button" style={[styles.linkControl, styles.reset]} onPress={() => {
          setSearch(''); setPeriod('week'); setCustom({ from: '', to: '' }); setKinds([]); setSelectedCategories([]); setWarehouses([]);
          setMovement(''); setNameCondition(''); setNameValue(''); setSort('asc'); setColumns(defaultColumns); refreshFilters();
        }}>
          <Text style={styles.linkText} translate>Сбросить всё</Text>
        </FastPressable>
      )}
    </View>
    {!rangeReady ? <Text style={[styles.muted, styles.empty]} translate>Укажите начало и конец периода.</Text>
      : report.isPending ? <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
      : report.isError ? <View style={styles.detail}>
        <Text style={styles.error}>{apiError(report.error)}</Text>
        <Button title="Повторить" variant="secondary" size="md" onPress={() => void report.refetch()} />
      </View> : <>
        <ScrollView horizontal={wide} scrollEnabled={wide}>
          <View style={wide ? [styles.wideTable, { width: 205 + (showKind ? 105 : 0) + visibleMetrics.length * 110 }] : styles.narrowTable}>
            {wide && <View style={[styles.headers, styles.tableHeader]}>
              <FastPressable accessibilityRole="button" style={styles.name}
                accessibilityLabel={sort === 'asc' ? 'Сортировать по названию по убыванию' : 'Сортировать по названию по возрастанию'}
                onPress={() => { setSort(sort === 'asc' ? 'desc' : 'asc'); refreshFilters(); }}>
                <Text style={styles.tableHeading}>Название {sort === 'asc' ? '↑' : '↓'}</Text>
              </FastPressable>
              {showKind && <Text style={[styles.kind, styles.tableHeading]} translate>Тип</Text>}
              {visibleMetrics.map(({ label }) => <Text key={label} style={[styles.metric, styles.tableHeading]} translate>{label}</Text>)}
            </View>}
            {report.data.rows.map((row) => <View key={row.id} style={wide ? undefined : styles.article}>
              <FastPressable accessibilityRole="button" accessibilityState={{ expanded: selected === row.id }} accessibilityLabel={row.name}
                onPress={() => setSelected((current) => current === row.id ? null : row.id)} style={wide ? styles.record : styles.articleTitle}>
                <View style={wide ? styles.headers : styles.group}>
                  <View style={[styles.group, wide ? styles.name : styles.documentName,
                    wide && selected === row.id && styles.expandedName]}>
                    <PwaIcon name={selected === row.id ? 'chevronDown' : 'chevronRight'} size={16} color={colors.textMuted} />
                    <Text numberOfLines={1} style={[styles.label, styles.documentName]}>{row.name}</Text>
                  </View>
                  {wide && showKind && <Text style={[styles.kind, styles.body]} translate>{kindLabels[row.kind] ?? row.kind}</Text>}
                  {wide && visibleMetrics.map(({ label, get }) => <Text key={label} style={[styles.metric, styles.body]}>{get(row)}</Text>)}
                </View>
              </FastPressable>
              {!wide && (showKind || visibleMetrics.length > 0) ? <View style={styles.cardMetrics}>
                {showKind && <View style={styles.pair}><Text style={styles.muted} translate>Тип</Text><Text style={styles.figure} translate>{kindLabels[row.kind] ?? row.kind}</Text></View>}
                {visibleMetrics.map(({ label, get }) => <View key={label} style={styles.pair}>
                  <Text style={styles.muted} translate>{label}</Text>
                  <Text style={styles.figure}>{get(row)}</Text>
                </View>)}
              </View> : null}
              {selected === row.id && <Detail key={`${row.id}:${range.from}:${range.to}`} row={row} {...scope} {...range}
                onOpenJournal={() => setJournal(row)} onOpenSource={setSource} />}
            </View>)}
            {!report.data.rows.length && <Text style={[styles.muted, styles.empty]} translate>По выбранным условиям продуктов нет.</Text>}
          </View>
        </ScrollView>
        {columns.includes('openingValue') && <View style={styles.total}>
          <Text style={styles.figure} translate>Начальная стоимость</Text>
          <Text style={styles.figure}>{price(report.data.openingValue)}</Text>
        </View>}
        {columns.includes('closingValue') && <View style={styles.total}>
          <Text style={styles.figure} translate>Итоговая стоимость</Text>
          <Text style={styles.figure}>{price(report.data.closingValue)}</Text>
        </View>}
        {report.data.totalValuationAdjustment !== 0 && <Text style={[styles.muted, styles.adjustment]}>Корректировка оценки: {price(report.data.totalValuationAdjustment)}</Text>}
        <Pages page={page} total={report.data.totalRows} pageSize={summaryPageSize} onChange={(value) => { setPage(value); setSelected(null); }} />
      </>}
    {journal && <WarehouseMovementJournal ingredientId={journal.ingredientId} ingredientName={journal.name}
      {...scope} locations={locations} initialPeriod={period} initialCustom={custom} onClose={() => setJournal(null)} />}
    {source && <MovementSourcePage movement={source} locations={locations} onClose={() => setSource(null)} />}
  </Card>;
}

const styles = StyleSheet.create({
  report: { padding: 0, overflow: 'hidden', elevation: 0, shadowOpacity: 0 },
  toolbar: { padding: spacing.md, gap: spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  search: { flex: 1, height: 34, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchInput: { flex: 1, minWidth: 0, height: '100%', padding: 0, fontSize: 14 },
  clearSearch: { width: 22, height: 28, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  dateFilter: { flex: 1, minWidth: 120 },
  compactControl: { height: 34, maxWidth: '100%', borderRadius: 4, paddingHorizontal: 8, gap: 6 },
  conditionLabel: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  conditionInput: { flex: 1, minWidth: 110, height: 34, borderColor: colors.border, borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 0, fontSize: 14 },
  actionPanel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.background },
  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  groupQuantity: { width: '25%', textAlign: 'right', fontVariant: ['tabular-nums'] },
  groupCost: { width: '31%', textAlign: 'right', fontVariant: ['tabular-nums'] },
  groupHeading: { minHeight: 42, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  detailTable: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
  detailRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 5, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tableHeading: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  documentTable: { width: 640, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.card },
  documentDate: { width: 142 },
  headers: { flexDirection: 'row', alignItems: 'center' },
  tableHeader: { minHeight: 48, backgroundColor: colors.background },
  wideTable: { width: 1190 },
  narrowTable: { flex: 1, width: '100%' },
  name: { width: 205, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  expandedName: { backgroundColor: '#F1F6FF' },
  kind: { width: 105 },
  metric: { width: 110, textAlign: 'right', paddingHorizontal: spacing.sm, fontVariant: ['tabular-nums'] },
  record: { minHeight: 48, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  article: { padding: spacing.lg, gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  articleTitle: { minHeight: 24, justifyContent: 'center' },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  body: { color: colors.textPrimary, fontSize: 13 },
  figure: { color: colors.textPrimary, fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  muted: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13 },
  cardMetrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  pair: { width: '50%', paddingRight: spacing.sm },
  detail: { gap: spacing.sm, backgroundColor: colors.slate100, padding: spacing.sm },
  documentName: { flex: 1, minWidth: 0 },
  journalActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  linkControl: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { color: colors.primary, fontSize: 13 },
  reset: { alignSelf: 'flex-start', minHeight: 28 },
  total: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  adjustment: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  empty: { padding: spacing.xl, textAlign: 'center', alignItems: 'center' },
  pagination: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 6, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pageControl: { minWidth: 32, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  disabledControl: { opacity: 0.4 },
  pageGlyph: { color: colors.textSecondary, fontSize: 18 },
});
