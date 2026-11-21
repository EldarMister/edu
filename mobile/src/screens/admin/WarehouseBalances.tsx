import React, { useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { AnchoredDropdown } from '@/components/AnchoredDropdown';
import { Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useIngredients, useIngredientSupplies, type Ingredient, type WarehouseLocation } from '@/services/api/warehouse';
import { UNIT_OPTIONS } from '@/services/api/warehouseUnits';
import { colors, radius, spacing, useThemeColors } from '@/theme';
import { balanceMoney, balanceQuantity, balanceValue } from '@/utils/warehouseBalance';
import { warehouseTimeDisplay } from '@/utils/warehouseTiming';
import { PurchaseEditor } from './WarehousePurchaseEditor';
import { CatalogueIngredientEditor } from './MenuStockCatalogue';
import { WarehouseMovementJournal } from './WarehouseMovementJournal';
import { WarehouseWorkbook } from './WarehouseWorkbook';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';

const PAGE_SIZE = 25;
const KINDS = [
  { value: 'raw', label: 'Ингредиент' },
  { value: 'goods', label: 'Товар' }, { value: 'preparation', label: 'Полуфабрикат' },
];
const STOCK = [
  { value: '', label: 'Все остатки' }, { value: 'low', label: 'Ниже лимита' },
  { value: 'empty', label: 'Закончилось' },
];
const SUPPLY_COLUMNS = ['Дата поставки', 'Склад', 'Поставщик', 'Количество', 'Цена за единицу', 'Сумма'] as const;

const columns = [
  { value: 'warehouse', label: 'Склад' }, { value: 'kind', label: 'Тип' },
  { value: 'category', label: 'Категория' }, { value: 'stock', label: 'Остатки' },
  { value: 'unit', label: 'Ед. измерения' }, { value: 'cost', label: 'Себестоимость' },
  { value: 'total', label: 'Сумма' }, { value: 'limit', label: 'Лимит' },
] as const;
type BalanceColumn = typeof columns[number]['value'];
const defaults: BalanceColumn[] = ['kind', 'category', 'stock', 'cost', 'total', 'limit'];
const valueColumns: BalanceColumn[] = ['stock', 'cost', 'total', 'limit'];

function itemKind(item: Ingredient) {
  if (item.isPrepared) return 'preparation';
  return item.kind === 'goods' || item.kind === 'beverage' ? 'goods' : 'raw';
}

export function WarehouseBalances({ warehouseId, warehouseFilter, locations, onResetWarehouse }: {
  warehouseId?: string; warehouseFilter?: ReactNode; locations: WarehouseLocation[]; onResetWarehouse: () => void;
}) {
  const { canAction } = usePermissions();
  const palette = useThemeColors();
  const wide = useWindowDimensions().width >= 768;
  const query = useIngredients('', warehouseId);
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [stockFilter, setStockFilter] = useState('');
  const [unit, setUnit] = useState('');
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Ingredient | null>(null);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [purchase, setPurchase] = useState<string | null>(null);
  const costs = canAction('warehouseCosts');
  const [selectedColumns, setSelectedColumns] = useColumnPreference('warehouse-balances', defaults);
  const availableColumns = columns.filter(({ value }) => costs || value !== 'cost' && value !== 'total');
  const visibleColumns = availableColumns.filter(({ value }) => selectedColumns.includes(value));
  const canExport = costs && canAction('exportReports');
  const canSeeHistory = costs && canAction('warehouseReports');
  const warehouse = locations.find((item) => item.id === warehouseId);
  const searchText = search.trim().toLocaleLowerCase();
  const categories = [...new Set((query.data ?? []).flatMap((item) => item.category ? [item.category] : []))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const rows = (query.data ?? []).filter((item) =>
    (!searchText || [item.name, item.category].some((value) => value?.toLocaleLowerCase().includes(searchText))) &&
    (!kinds.length || kinds.includes(itemKind(item))) && (!selectedCategories.length || selectedCategories.includes(item.category ?? '')) &&
    (!unit || item.displayUnit === unit) &&
    (!stockFilter || (stockFilter === 'empty' ? item.stock <= 0 : item.isLow && item.stock > 0)),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru') * (ascending ? 1 : -1));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const filtered = !!(searchText || kinds.length || selectedCategories.length || stockFilter || unit || warehouseId);
  const valuedRows = rows.filter((item) => !(item.isPrepared && item.preparationMode === 'virtual'));
  const valuations = valuedRows.map(balanceValue);
  const totalValue = valuations.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
    setExpandedId(null);
  };

  const params = new URLSearchParams({
    columns: ['name', ...visibleColumns.map(({ value }) => value)].join(','),
    sort: ascending ? 'asc' : 'desc',
  });
  if (warehouseId) params.set('warehouseId', warehouseId);
  if (searchText) params.set('search', search.trim());
  if (unit) params.set('unit', unit);
  if (stockFilter) params.set('stockFilter', stockFilter);
  kinds.forEach((kind) => params.append('kinds', kind === 'raw' ? 'ingredient' : kind));
  selectedCategories.forEach((category) => params.append('categories', category));

  const body = <>
    {wide ? <View style={styles.tableHeader}>
      <FastPressable onPress={() => { setAscending(!ascending); setPage(1); }} style={styles.nameCell} accessibilityRole="button">
        <Text style={styles.muted}>Название {ascending ? '↑' : '↓'}</Text>
      </FastPressable>
      {visibleColumns.map(({ value, label }) => (
        <Text key={value} numberOfLines={1} style={[styles.muted, valueColumns.includes(value) ? styles.valueCell : styles.cell]} translate>{label}</Text>
      ))}
    </View> : null}
    {rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((item) => {
      const open = expandedId === item.id;
      const type = KINDS.find((option) => option.value === itemKind(item))?.label ?? '';
      const virtual = item.isPrepared && item.preparationMode === 'virtual';
      const separateUnit = visibleColumns.some(({ value }) => value === 'unit');
      const stock = virtual ? 'По рецепту' : separateUnit ? balanceQuantity(item.stock, '', item.unitType).trim() : balanceQuantity(item.stock, item.unit, item.unitType);
      const threshold = virtual ? '—' : balanceQuantity(item.lowStockThreshold, separateUnit ? '' : item.unit, 'mass').trim();
      const value = virtual ? null : balanceValue(item);
      const unitCost = virtual ? item.recipeUnitCost : item.avgCost;
      const values: Record<BalanceColumn, string> = {
        warehouse: warehouse?.name ?? 'Все склады', kind: type, category: item.category || '—', stock, unit: item.unit,
        limit: threshold, cost: unitCost == null ? '—' : balanceMoney(unitCost), total: value == null ? '—' : balanceMoney(value),
      };
      const canEdit = itemKind(item) === 'raw' && canAction('warehouseSettings');
      return <View style={styles.record} key={item.id}>
        <View style={wide ? undefined : styles.mobileSummary}>
          <FastPressable style={wide ? styles.tableRow : styles.rowTitle} accessibilityRole="button"
            accessibilityLabel={item.name} accessibilityState={{ expanded: open }}
            onPress={() => setExpandedId(open ? null : item.id)}>
            <View style={wide ? [styles.rowTitle, styles.nameCell] : styles.rowTitle}>
              <PwaIcon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={colors.textMuted} />
              <Text numberOfLines={wide ? 1 : undefined} style={styles.name}>{item.name}</Text>
            </View>
            {wide && visibleColumns.map(({ value: column }) => {
              const numeric = valueColumns.includes(column);
              return <Text key={column} numberOfLines={1} translate={column === 'kind' || column === 'stock' && virtual}
                style={[numeric ? [styles.value, styles.valueCell] : [styles.muted, styles.cell], column === 'stock' && item.isLow && styles.low]}>
                {values[column]}
              </Text>;
            })}
          </FastPressable>
          {!wide && visibleColumns.some(({ value }) => value === 'kind' || value === 'category') ? (
            <Text style={styles.mobileMeta}>
              {visibleColumns.some(({ value }) => value === 'kind') ? <Text translate>{type}</Text> : null}
              {visibleColumns.some(({ value }) => value === 'category') && item.category
                ? (visibleColumns.some(({ value }) => value === 'kind') ? ' · ' : '') + item.category : null}
            </Text>
          ) : null}
          {!wide && <View style={styles.metrics}>
            {visibleColumns.filter(({ value }) => value !== 'kind' && value !== 'category').map(({ value, label }) => (
              <Metric key={value} label={label} value={values[value]} warning={value === 'stock' && item.isLow}
                translateValue={value === 'stock' && virtual || value === 'warehouse' && !warehouse} />
            ))}
          </View>}
        </View>
        {open && (canSeeHistory || canEdit) ? <View style={[styles.detail, { backgroundColor: palette.inset }]}>
          <View style={styles.detailHeading}>
            {canSeeHistory ? <Text style={styles.detailTitle} accessibilityRole="header" translate>Поставки</Text> : null}
            <View style={styles.actions}>
              {canSeeHistory ? <DetailAction label="История" onPress={() => setHistory(item)} /> : null}
              {canEdit ? <DetailAction label="Изменить" onPress={() => setEditing(item)} /> : null}
            </View>
          </View>
          {canSeeHistory ? <Supplies key={(warehouseId ?? 'all') + item.id} item={item} warehouseId={warehouseId} wide={wide}
            onOpen={canAction('warehouseReceive') ? setPurchase : undefined} /> : null}
        </View> : null}
      </View>;
    })}
  </>;

  return <View style={styles.surface}>
    <View style={styles.toolbar}>
      <View style={styles.search}>
        <PwaIcon name="search" size={15} color={colors.textMuted} />
        <TextInput accessibilityLabel="Поиск позиции" placeholder="Поиск..." style={styles.searchInput}
          value={search} maxLength={160} onChangeText={changeFilter(setSearch)} />
      </View>
      <View style={styles.filters}>
        {warehouseFilter}
        <WarehouseMultiSelect label="Тип" value={kinds} options={KINDS} onChange={changeFilter(setKinds)} style={styles.filter} />
        <WarehouseMultiSelect label="Категория" value={selectedCategories} options={[{ value: '', label: 'Без категории' }, ...categories.map((name) => ({
          value: name, label: name, translate: false,
        }))]} onChange={changeFilter(setSelectedCategories)} style={styles.filter} />
        <AnchoredDropdown label="Дополнительные фильтры остатков" width={240} height={100} buttonStyle={styles.reset}
          trigger={() => <Text style={styles.resetText}><Text translate>+ Фильтр</Text>{stockFilter || unit ? ' •' : ''}</Text>}>
          {() => <View style={styles.extraFilters}>
            <Select title="Единица измерения" value={unit} options={[{ value: '', label: 'Ед. измерения' }, ...UNIT_OPTIONS]}
              onChange={changeFilter(setUnit)} style={styles.filter} />
            <Select title="Остатки" value={stockFilter} options={STOCK} onChange={changeFilter(setStockFilter)} style={styles.filter} />
          </View>}
        </AnchoredDropdown>
      </View>
      <WarehouseMultiSelect label="Столбцы" value={visibleColumns.map(({ value }) => value)} options={[...availableColumns]}
        onChange={(values) => setSelectedColumns([...values, ...selectedColumns.filter((value) => !availableColumns.some((column) => column.value === value))])}
        style={styles.filter} />
      {canExport && <WarehouseWorkbook url={`/admin/warehouse/ingredients/export.xlsx?${params}`}
        filename="Остатки.xlsx" disabled={query.isPending || query.isError || !rows.length} />}
      {filtered ? <FastPressable accessibilityRole="button" style={styles.reset} onPress={() => {
        setSearch(''); setKinds([]); setSelectedCategories([]); setStockFilter(''); setUnit(''); onResetWarehouse(); setPage(1); setExpandedId(null);
      }}><Text style={styles.resetText} translate>Сбросить всё</Text></FastPressable> : null}
    </View>
    {query.isPending ? <ActivityIndicator color={colors.primary} /> : query.isError ? <View style={styles.detail}>
      <Text style={styles.low} accessibilityRole="alert">{apiError(query.error)}</Text>
      <Button title="Повторить" size="md" variant="secondary" onPress={() => void query.refetch()} />
    </View> : <>
      {wide ? <ScrollView horizontal keyboardShouldPersistTaps="handled"><View style={styles.table}>{body}</View></ScrollView> : body}
      {!rows.length ? <Text style={styles.empty} translate>{filtered ? 'Ничего не найдено' : 'Здесь будут остатки на складе'}</Text> : null}
      {costs && valuedRows.length > 0 ? <View style={styles.footer}>
        <Text style={styles.muted} translate>Стоимость остатков</Text>
        <Text style={styles.value}>{balanceMoney(totalValue)}{valuations.includes(null) ? ' + …' : ''}</Text>
      </View> : null}
      <Pages page={currentPage} pages={pages} onPage={setPage} />
    </>}
    {history && canSeeHistory ? <WarehouseMovementJournal ingredientId={history.id} ingredientName={history.name}
      warehouseId={warehouseId} locations={locations} onClose={() => setHistory(null)} /> : null}
    {editing ? <CatalogueIngredientEditor item={editing} warehouse={warehouse} onClose={() => setEditing(null)} /> : null}
    {purchase ? <PurchaseEditor purchaseId={purchase} warehouse={warehouse} warehouseLabel={(id) =>
      locations.find((location) => location.id === id)?.name ?? locations.find((location) => location.isDefault)?.name ?? '—'
    } onClose={() => setPurchase(null)} /> : null}
  </View>;
}

function Metric({ label, value, warning, translateValue }: { label: string; value: string; warning?: boolean; translateValue?: boolean }) {
  return <View style={styles.metric}>
    <Text style={styles.metricLabel} translate>{label}</Text>
    <Text style={[styles.metricValue, warning && styles.low]} translate={translateValue}>{value}</Text>
  </View>;
}

function DetailAction({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <FastPressable style={styles.detailAction} accessibilityRole="button" accessibilityState={{ disabled }}
    disabled={disabled} hitSlop={4} onPress={onPress}>
    <Text style={[styles.actionText, disabled && styles.muted]} translate>{label}</Text>
  </FastPressable>;
}

function Pages({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return pages > 1 ? <View style={styles.footer}>
    <Button title="Назад" size="md" variant="secondary" disabled={page <= 1} onPress={() => onPage(page - 1)} />
    <Text style={styles.muted}>{page} / {pages}</Text>
    <Button title="Далее" size="md" variant="secondary" disabled={page >= pages} onPress={() => onPage(page + 1)} />
  </View> : null;
}

function Supplies({ item, warehouseId, wide, onOpen }: {
  item: Ingredient; warehouseId?: string; wide: boolean; onOpen?: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const query = useIngredientSupplies(item.id, warehouseId, page);
  if (query.isPending) return <ActivityIndicator style={styles.supplyLoading} color={colors.primary} accessibilityLabel="Загрузка поставок" />;
  if (query.isError) return <>
    <Text style={styles.low} accessibilityRole="alert">{apiError(query.error)}</Text>
    <DetailAction label="Повторить загрузку" onPress={() => void query.refetch()} />
  </>;
  const { rows, pageSize, total } = query.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <View>
    <View style={styles.supplyList}>
      {wide ? <View style={styles.supplyTableHeader}>
        {SUPPLY_COLUMNS.map((label, index) => <Text key={label} style={[styles.supplyColumn, styles.muted, index >= 3 && styles.alignRight]} translate>{label}</Text>)}
      </View> : null}
      {!rows.length ? <Text style={styles.empty} translate>Поставок пока нет</Text> : null}
      {rows.map((supply, index) => {
        const date = warehouseTimeDisplay(supply.date);
        const dateLabel = <Text style={[styles.supplyDate, onOpen && styles.supplyLink]}>{date}</Text>;
        const values = [
          supply.warehouseName,
          supply.supplier || '—',
          balanceQuantity(supply.quantity, supply.unit, item.unitType),
          supply.unitPrice == null ? '—' : balanceMoney(supply.unitPrice),
          supply.total == null ? '—' : balanceMoney(supply.total),
        ];
        return <View key={supply.purchaseId} style={[styles.supply, wide && styles.supplyTableRow, index < rows.length - 1 && styles.supplyDivider]}>
          <View style={wide ? styles.supplyColumn : styles.supplyDateBlock}>
            {onOpen ? <FastPressable accessibilityRole="button" accessibilityLabel={'Поставка от ' + date} hitSlop={3}
              onPress={() => onOpen(supply.purchaseId)}>{dateLabel}</FastPressable> : dateLabel}
          </View>
          {wide ? values.map((value, i) => <Text key={SUPPLY_COLUMNS[i + 1]}
            style={[styles.supplyColumn, styles.value, i >= 2 && styles.alignRight]}>{value}</Text>) :
            <View style={styles.supplyFields}>
              {values.map((value, i) => <View style={styles.supplyField} key={SUPPLY_COLUMNS[i + 1]}>
                <Text style={styles.supplyLabel} translate>{SUPPLY_COLUMNS[i + 1]}</Text>
                <Text style={styles.supplyValue}>{value}</Text>
              </View>)}
            </View>}
        </View>;
      })}
    </View>
    {pages > 1 ? <View style={styles.supplyPages}>
      <Text style={styles.muted}>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} из {total}</Text>
      <DetailAction label="Назад" disabled={page <= 1} onPress={() => setPage(page - 1)} />
      <Text style={styles.muted}>{page} / {pages}</Text>
      <DetailAction label="Далее" disabled={page >= pages} onPress={() => setPage(page + 1)} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  surface: { padding: 0, borderRadius: radius.lg, backgroundColor: colors.card, overflow: 'hidden' },
  toolbar: { padding: spacing.md, gap: spacing.sm },
  search: { minHeight: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, paddingVertical: 4 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filter: { height: 36, borderRadius: radius.sm, paddingHorizontal: 9 },
  reset: { minHeight: 32, alignSelf: 'flex-start', justifyContent: 'center' },
  resetText: { color: colors.primary, fontSize: 13 },
  extraFilters: { padding: 5, gap: spacing.xs },
  record: { borderTopWidth: 1, borderTopColor: colors.border },
  mobileSummary: { paddingHorizontal: spacing.md, paddingVertical: 14 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { flexShrink: 1, color: '#334155', fontSize: 15, lineHeight: 21 },
  mobileMeta: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginLeft: 26, marginTop: spacing.xs, marginBottom: 10 },
  muted: { color: colors.textMuted, fontSize: 13 },
  value: { color: colors.textPrimary, fontSize: 14 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginLeft: 26 },
  metric: { width: '50%', paddingRight: spacing.sm },
  metricLabel: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  metricValue: { color: '#334155', fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  low: { color: colors.danger },
  table: { minWidth: 1020 },
  tableHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, minHeight: 48 },
  tableRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 48 },
  nameCell: { width: 245, paddingRight: spacing.sm },
  cell: { width: 135, paddingRight: spacing.sm },
  valueCell: { width: 115, textAlign: 'right' },
  detail: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, gap: spacing.sm },
  detailHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: spacing.md, rowGap: spacing.xs },
  detailTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 28, fontWeight: '500' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', columnGap: spacing.lg, marginLeft: 'auto' },
  detailAction: { minHeight: 32, justifyContent: 'center' },
  actionText: { color: colors.primary, fontSize: 13, lineHeight: 18 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  empty: { padding: spacing.lg, color: colors.textMuted, textAlign: 'center' },
  supplyLoading: { marginVertical: spacing.lg },
  supplyList: { overflow: 'hidden', borderRadius: radius.sm, backgroundColor: colors.card },
  supply: { padding: spacing.md },
  supplyDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  supplyDateBlock: { marginBottom: spacing.sm },
  supplyDate: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  supplyLink: { color: colors.primary },
  supplyFields: { gap: 5 },
  supplyField: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  supplyLabel: { color: colors.textMuted, fontSize: 12, lineHeight: 16, flex: 1, minWidth: 0 },
  supplyValue: { color: colors.textPrimary, fontSize: 12, lineHeight: 16, flex: 1.3, minWidth: 0, textAlign: 'right', fontVariant: ['tabular-nums'] },
  supplyTableHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  supplyTableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  supplyColumn: { flex: 1, minWidth: 0, paddingHorizontal: spacing.xs },
  alignRight: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  supplyPages: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.lg, paddingTop: spacing.md },
});
