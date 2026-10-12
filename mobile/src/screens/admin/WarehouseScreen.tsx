import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Alert, Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { DateField } from '@/components/DateField';
import { Button, Card } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { money } from '@/utils/format';
import { normalizeUnitLabel } from '@/utils/units';
import {
  purchaseNumber,
  qty,
  useIngredients,
  useIngredientsOverview,
  useIngredientMutations,
  useMovements,
  useMovementsSummary,
  usePurchases,
  usePurchasesOverview,
  useWarehouseDashboard,
  useWarehouseItems,
  useWarehouseItemsOverview,
  type PurchaseStatus,
  type StockMovementType,
  type WarehouseTab,
  type Ingredient,
} from '@/services/api/warehouse';
import { useAdminCategories, useDishMutations, type AdminDish } from '@/services/api/admin';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { usePermissions } from '@/hooks/usePermissions';
import { IngredientAdjustment, IngredientEditor, PurchaseEditor, RecipeEditor } from './WarehouseEditors';
import { DishModal } from './MenuScreen';
import { DashboardGrid, RevenueChart } from './StatisticsScreen';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

const TABS: { key: WarehouseTab; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'dishes', label: 'Блюда' },
  { key: 'ingredients', label: 'Сырьё' },
  { key: 'purchases', label: 'Закупки' },
  { key: 'movements', label: 'Движения' },
];

const PERIODS: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'custom', label: 'Период' },
];

const PURCHASE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'completed', label: 'Проведённые' },
  { value: 'draft', label: 'Черновики' },
  { value: 'cancelled', label: 'Отменённые' },
];

const MOVEMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Все типы' },
  { value: 'purchase', label: 'Приход' },
  { value: 'sale', label: 'Списание' },
  { value: 'return', label: 'Возврат' },
  { value: 'correction', label: 'Коррекция' },
  { value: 'cancel', label: 'Отмена' },
];

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Все источники' },
  { value: 'purchase', label: 'Закупка' },
  { value: 'order', label: 'Заказ' },
  { value: 'manual', label: 'Вручную' },
];

const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  purchase: 'Приход',
  sale: 'Списание',
  return: 'Возврат',
  correction: 'Коррекция',
  cancel: 'Отмена',
};

const PURCHASE_STATUS: Record<PurchaseStatus, { label: string; tone: Tone }> = {
  completed: { label: 'Проведена', tone: 'success' },
  draft: { label: 'Черновик', tone: 'warning' },
  cancelled: { label: 'Отменена', tone: 'muted' },
};

/** Раздел «Склад» — mobile-порт PWA WarehouseSection. */
export function WarehouseScreen() {
  const [tab, setTab] = useState<WarehouseTab>('overview');
  const [period, setPeriod] = useState<PeriodPreset>('week');
  const [from, setFrom] = useState(() => localDate(addDays(new Date(), -6)));
  const [to, setTo] = useState(() => localDate(new Date()));
  const range = useMemo(() => period === 'custom' ? { dateFrom: from, dateTo: to } : periodRange(period), [period, from, to]);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.warehouseToolbar}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.warehouseTabs}>{TABS.map(item => <FastPressable key={item.key} onPress={() => setTab(item.key)} style={[styles.warehouseTab, tab === item.key && styles.warehouseTabActive]}><Text style={[styles.warehouseTabLabel, tab === item.key && { color: colors.primary }]} translate>{item.label}</Text></FastPressable>)}</ScrollView>
      {tab === 'overview' ? <View style={styles.periodTabs}>{PERIODS.map(item => <FastPressable key={item.key} onPress={() => setPeriod(item.key)} style={[styles.periodTab, period === item.key && styles.periodTabActive]}><Text style={[styles.periodLabel, period === item.key && { color: colors.white }]} translate>{item.label}</Text></FastPressable>)}</View> : null}</View>
      {tab === 'overview' ? (
        <>
          {period === 'custom' ? <View style={styles.rowBetween}><View style={{ flex: 1 }}><DateField label="С даты" value={from} onChangeText={setFrom} /></View><View style={{ flex: 1 }}><DateField label="По дату" value={to} onChangeText={setTo} /></View></View> : null}
          <OverviewTab range={range} />
        </>
      ) : tab === 'dishes' ? (
        <DishesTab />
      ) : tab === 'ingredients' ? (
        <IngredientsTab />
      ) : tab === 'purchases' ? (
        <PurchasesTab />
      ) : (
        <MovementsTab />
      )}
    </ScrollView>
  );
}

function OverviewTab({ range }: { range: { dateFrom: string; dateTo: string } }) {
  const { width } = useWindowDimensions();
  const wide = width >= 1280;
  const q = useWarehouseDashboard(range);
  const data = q.data;
  if (q.isLoading) return <LoadingBox />;
  if (q.isError) return <Text style={{ color: colors.danger }}>{apiError(q.error)}</Text>;
  return (
    <View style={styles.stack}>
      <DashboardGrid columns={wide ? 4 : 2}>
        <Metric large label="Стоимость остатков" value={money(data?.stockValue ?? 0)} />
        <Metric large label="Низкий остаток" value={String(data?.lowStockCount ?? 0)} />
        <Metric large label="Закупки за период" value={money(data?.purchasesTotal ?? 0)} />
        <Metric large label="Списания сырья" value={money(data?.ingredientWriteOffTotal ?? 0)} />
      </DashboardGrid>
      <View style={[styles.overviewTrendGrid, wide && { flexDirection: 'row' }]}>
      <View style={wide ? { flex: 1.25, minWidth: 0 } : undefined}><Panel title="Динамика остатков" empty="Нет данных за период"><StockTrend points={data?.stockValueTrend ?? []} /></Panel></View>
      <View style={wide ? { flex: 0.75, minWidth: 360 } : undefined}>
      <Panel title="Низкий остаток" empty="Низких остатков нет">
        <CompactTable columns={[{ label: 'Товар' }, { label: 'Остаток', width: 80, align: 'right' }, { label: 'Ед.', width: 60, align: 'right' }]} rows={(data?.lowStockItems ?? []).map(item => [item.name, String(Math.round(item.stock * 1000) / 1000).replace('.', ','), item.unit])} empty="Низких остатков нет" />
      </Panel>
      </View></View>
      <DashboardGrid columns={wide ? 3 : 1} gap={16}>
      <Panel title="Топ расходуемых ингредиентов" empty="Нет списаний за период">
        <CompactTable columns={[{ label: 'Ингредиент' }, { label: 'Расход', width: 95, align: 'right' }, { label: 'Сумма', width: 100, align: 'right' }]} rows={(data?.topConsumedIngredients ?? []).map(item => [item.name, qty(item.quantity, item.unit), money(item.cost)])} empty="Нет списаний за период" />
      </Panel>
      <Panel title="Последние движения" empty="Движений пока нет">
        <CompactTable minWidth={540} columns={[{ label: 'Время', width: 100 }, { label: 'Тип', width: 105 }, { label: 'Ингредиент' }, { label: 'Изменение', width: 110, align: 'right' }, { label: 'После', width: 95, align: 'right' }]} rows={(data?.recentMovements ?? []).map(item => [formatMovementTime(item.createdAt), <Badge tone={item.type === 'purchase' || item.type === 'return' ? 'success' : item.type === 'sale' ? 'danger' : item.type === 'correction' ? 'warning' : 'muted'}>{MOVEMENT_LABEL[item.type] ?? item.type}</Badge>, item.ingredientName, <Text style={[styles.compactText, styles.compactStrong, toneText(item.change > 0 ? 'success' : item.change < 0 ? 'danger' : 'muted')]}>{`${item.change > 0 ? '+' : ''}${qty(item.change, item.unit)}`}</Text>, qty(item.after, item.unit)])} empty="Движений пока нет" />
      </Panel>
      <Panel title="Закупки по поставщикам" empty="Нет закупок за период">
        <CompactTable columns={[{ label: 'Поставщик' }, { label: 'Сумма', width: 110, align: 'right' }]} rows={(data?.suppliersTop ?? []).map(item => [item.supplier, money(item.total)])} empty="Нет закупок за период" />
      </Panel>
      </DashboardGrid>
    </View>
  );
}

function DishesTab() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<AdminDish | null | 'new'>(null);
  const [recipe, setRecipe] = useState<AdminDish | null>(null);
  const { canSection } = usePermissions();
  const canEditMenu = canSection('menu');
  const categories = useAdminCategories(canEditMenu);
  const { remove } = useDishMutations();
  const push = useNotifications((s) => s.push);
  const overview = useWarehouseItemsOverview();
  const itemsQ = useWarehouseItems(search, canEditMenu ? categoryId : '');
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        <Metric label="Напитков" value={overview.data?.totalDrinks ?? '—'} />
        <Metric label="Всего единиц" value={overview.data?.totalUnits ?? '—'} />
      </View>
      <View style={styles.tableCard}><View style={styles.tableToolbar}><Search value={search} onChangeText={setSearch} placeholder="Поиск по складу" />
      {canEditMenu ? <AddAction label="Добавить товар" onPress={() => setEditing('new')} /> : <Text style={styles.itemSub} translate>Для изменения товаров нужен доступ к разделу «Меню».</Text>}</View>
      {itemsQ.isLoading ? <LoadingBox /> : null}
      {itemsQ.isError ? <View style={styles.stack}><Text style={{ color: colors.danger }}>{apiError(itemsQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void itemsQ.refetch()} /></View> : null}
      <WarehouseTable columns={[{ label: 'Товар', width: 240 }, { label: 'Остаток', width: 110, align: 'center' }, { label: 'Ед. изм.', width: 110, align: 'center' }, { label: 'Статус', width: 160 }, { label: 'Действия', width: 200, align: 'right' }]} rows={(itemsQ.data ?? []).map((item) => {
        const aggregate = aggregateInventory(item);
        const hasVariants = item.variants.length > 0;
        const open = !!expanded[item.id];
        return { key: item.id, onPress: hasVariants ? () => setExpanded((current) => ({ ...current, [item.id]: !current[item.id] })) : undefined, cells: [
              <View style={styles.itemHead}>
                {hasVariants ? <View style={open ? styles.chevronUp : undefined}><PwaIcon name="chevronDown" size={16} color={colors.textMuted} /></View> : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{item.name}</Text>
                <Text style={styles.itemSub} translate>{hasVariants ? `${item.variants.length} вариант(ов)` : item.category.name}</Text>
              </View>
              </View>, String(aggregate.stock), aggregate.unit, <Badge tone={aggregate.tone}>{aggregate.label}</Badge>, <View style={styles.tableActions}><FastPressable style={styles.tableAction} accessibilityLabel="Техкарта" onPress={() => setRecipe(item)}><PwaIcon name="menu" size={16} color={colors.textMuted} /></FastPressable>{canEditMenu ? <><FastPressable style={styles.tableAction} onPress={() => setEditing(item)}><PwaIcon name="pencil" size={16} color={colors.textMuted} /><Text style={styles.tableActionLabel} translate>Изменить</Text></FastPressable><FastPressable style={styles.tableAction} accessibilityLabel="Удалить товар" onPress={() => Alert.alert('Удалить товар?', item.name, [{ text: 'Назад', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => void remove.mutateAsync(item.id).catch((error) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() })) }])}><PwaIcon name="trash" size={16} color={colors.danger} /></FastPressable></> : null}</View>], detail: open ? (
              <View style={styles.subRows}>
                {item.variants.map((variant) => {
                  const stock = variant.stock ?? 0;
                  const initial = variant.initialStock ?? stock;
                  const low = stock > 0 && initial > 0 && stock <= 0.2 * initial;
                  return (
                    <InfoRow
                      key={variant.id}
                      title={variant.name}
                      value={`${stock} ${normalizeUnitLabel(variant.unit)}`}
                      tone={stock === 0 ? 'danger' : low ? 'warning' : 'success'}
                    />
                  );
                })}
              </View>
            ) : undefined };
      })} />
      {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 ? <Empty text="Складские товары не найдены" /> : null}
      </View>
      {canEditMenu && editing ? <DishModal dish={editing === 'new' ? null : editing} categories={categories.data ?? []} defaultCategoryId={categoryId} presetInventory onClose={() => setEditing(null)} onRecipe={editing === 'new' ? undefined : () => { setRecipe(editing); setEditing(null); }} /> : null}
      {recipe ? <RecipeEditor dish={recipe} onClose={() => setRecipe(null)} /> : null}
    </View>
  );
}

function IngredientsTab() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Ingredient | null | 'new'>(null);
  const [adjustment, setAdjustment] = useState<Ingredient | null>(null);
  const { remove } = useIngredientMutations();
  const push = useNotifications((s) => s.push);
  const overview = useIngredientsOverview();
  const itemsQ = useIngredients(search);
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        <Metric label="Всего ингредиентов" value={overview.data?.totalIngredients ?? '—'} />
        <Metric label="Низкий остаток" value={overview.data?.lowStockCount ?? '—'} />
        <Metric label="Средняя себестоимость" value={overview.data ? money(overview.data.avgCost) : '—'} />
      </View>
      <View style={styles.tableCard}><View style={styles.tableToolbar}><Search value={search} onChangeText={setSearch} placeholder="Поиск по сырью" /><AddAction label="Добавить сырьё" onPress={() => setEditing('new')} /></View>
      {itemsQ.isLoading ? <LoadingBox /> : null}
      {itemsQ.isError ? <View style={styles.stack}><Text style={{ color: colors.danger }}>{apiError(itemsQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void itemsQ.refetch()} /></View> : null}
      <WarehouseTable columns={[{ label: 'Ингредиент', width: 200 }, { label: 'Ед. изм.', width: 90, align: 'center' }, { label: 'Текущий остаток', width: 150, align: 'center' }, { label: 'Ср. себестоимость', width: 150, align: 'center' }, { label: 'Порог низкого остатка', width: 180, align: 'center' }, { label: 'Статус', width: 100 }, { label: 'Действия', width: 130, align: 'right' }]} rows={(itemsQ.data ?? []).map(item => ({ key: item.id, cells: [<Text style={styles.tableStrong}>{item.name}</Text>, item.unit, qty(item.stock, item.unit), `${money(item.avgCost)}/${item.unit}`, qty(item.lowStockThreshold, item.unit), <Badge tone={item.isLow ? 'warning' : 'success'}>{item.isLow ? 'Низкий' : 'Норма'}</Badge>, <View style={styles.tableActions}><FastPressable style={styles.tableAction} accessibilityLabel="Редактировать сырьё" onPress={() => setEditing(item)}><PwaIcon name="pencil" size={16} color={colors.textLight} /></FastPressable><FastPressable style={styles.tableAction} accessibilityLabel="Коррекция остатка" onPress={() => setAdjustment(item)}><PwaIcon name="rotateCcw" size={16} color={colors.textLight} /></FastPressable><FastPressable style={styles.tableAction} accessibilityLabel="Удалить сырьё" onPress={() => Alert.alert('Удалить сырьё?', item.name, [{ text: 'Назад', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => void remove.mutateAsync(item.id).catch((error) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() })) }])}><PwaIcon name="trash" size={16} color={colors.danger} /></FastPressable></View>] }))} />
      {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 ? <Empty text="Сырьё не найдено" /> : null}
      </View>
      <Card><Text style={styles.tableCellText} translate><Text style={{ fontWeight: '500', color: colors.textPrimary }} translate>Правило низкого остатка: </Text>сырьё помечается как «Низкий», когда текущий остаток меньше или равен заданному порогу низкого остатка.</Text></Card>
      {editing ? <IngredientEditor ingredient={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {adjustment ? <IngredientAdjustment ingredient={adjustment} onClose={() => setAdjustment(null)} /> : null}
    </View>
  );
}

function PurchasesTab() {
  const { width } = useWindowDimensions();
  const wide = width >= 1280;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [newPurchaseRevision, setNewPurchaseRevision] = useState(0);
  const overview = usePurchasesOverview();
  const purchasesQ = usePurchases({ status, search });
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        <Metric label="Закупок за период" value={overview.data?.count ?? '—'} />
        <Metric label="Поставщиков" value={overview.data?.suppliers ?? '—'} />
        <Metric label="Сумма закупок" value={overview.data ? money(overview.data.sum) : '—'} />
      </View>
      <View style={[styles.purchasesGrid, wide && { flexDirection: 'row' }]}>
      <View style={[styles.tableCard, wide && { flex: 1.4 }]}><View style={styles.tableToolbar}><Text style={styles.panelTitle} translate>История закупок</Text><Search value={search} onChangeText={setSearch} placeholder="Поиск по поставщику" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.purchaseFilters}>{PURCHASE_STATUS_OPTIONS.filter(option => option.value !== 'cancelled').map(option => <FastPressable key={option.value} onPress={() => setStatus(option.value)} style={[styles.purchaseFilter, status === option.value && styles.purchaseFilterActive]}><Text style={[styles.purchaseFilterText, status === option.value && { color: colors.primary }]} translate>{option.label}</Text></FastPressable>)}</ScrollView>
      </View>
      {purchasesQ.isLoading ? <LoadingBox /> : null}
      {purchasesQ.isError ? <View style={styles.stack}><Text style={{ color: colors.danger }}>{apiError(purchasesQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void purchasesQ.refetch()} /></View> : null}
      <WarehouseTable columns={[{ label: '№', width: 75 }, { label: 'Дата', width: 125 }, { label: 'Поставщик', width: 170 }, { label: 'Позиций', width: 85, align: 'center' }, { label: 'Сумма', width: 120, align: 'right' }, { label: 'Статус', width: 120 }, { label: 'Действия', width: 80, align: 'right' }]} rows={(purchasesQ.data ?? []).map((purchase) => {
        const statusMeta = PURCHASE_STATUS[purchase.status];
        return { key: purchase.id, onPress: () => setEditing(purchase.id), cells: [purchaseNumber(purchase.number), formatDate(purchase.date), purchase.supplier, String(purchase.itemsCount), <Text style={styles.tableStrong}>{money(purchase.totalAmount)}</Text>, <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>, <FastPressable style={styles.tableAction} accessibilityLabel="Редактировать закупку" onPress={() => setEditing(purchase.id)}><PwaIcon name="pencil" size={16} color={colors.textLight} /></FastPressable>] };
      })} />
      {!purchasesQ.isLoading && (purchasesQ.data ?? []).length === 0 ? <Empty text="Закупки не найдены" /> : null}
      </View>
      <View style={wide ? { flex: 1 } : undefined}><PurchaseEditor inline key={newPurchaseRevision} purchaseId={null} onClose={() => setNewPurchaseRevision(value => value + 1)} /></View>
      </View>
      <Card><Text style={styles.tableStrong} translate>Формула средневзвешенной себестоимости</Text><Text style={styles.tableCellText} translate>новая себестоимость = (старый остаток × старая себестоимость + кол-во × цена закупки) ÷ (старый остаток + кол-во)</Text></Card>
      {editing ? <PurchaseEditor purchaseId={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

function MovementsTab() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ingredientId, setIngredientId] = useState('');
  const ingredients = useIngredients('');
  const filter = { search, type, sourceType, from, to, ingredientId };
  const movementsQ = useMovements(filter);
  const summaryQ = useMovementsSummary(filter);
  return (
    <View style={styles.stack}>
      <Search value={search} onChangeText={setSearch} placeholder="Поиск по ингредиенту" />
      <Select value={type} options={MOVEMENT_TYPE_OPTIONS} onChange={setType} title="Тип движения" />
      <Select value={sourceType} options={SOURCE_OPTIONS} onChange={setSourceType} title="Источник" />
      <Select value={ingredientId} onChange={setIngredientId} options={[{ value: '', label: 'Все ингредиенты' }, ...(ingredients.data ?? []).map((i) => ({ value: i.id, label: i.name , translate: false }))]} title="Ингредиент" />
      <View style={styles.rowBetween}><View style={{ flex: 1 }}><DateField label="С даты" value={from} onChangeText={setFrom} /></View><View style={{ flex: 1 }}><DateField label="По дату" value={to} onChangeText={setTo} /></View></View>
      <View style={styles.grid}>
        <Metric label="Приход" value={summaryQ.data ? fmtNumber(summaryQ.data.income) : '—'} />
        <Metric label="Списание" value={summaryQ.data ? fmtNumber(summaryQ.data.writeoff) : '—'} />
        <Metric label="Возвраты" value={summaryQ.data ? fmtNumber(summaryQ.data.returns) : '—'} />
      </View>
      {movementsQ.isLoading ? <LoadingBox /> : null}
      {movementsQ.isError ? <View style={styles.stack}><Text style={{ color: colors.danger }}>{apiError(movementsQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void movementsQ.refetch()} /></View> : null}
      <View style={styles.tableCard}><WarehouseTable columns={[{ label: 'Дата и время', width: 165 }, { label: 'Ингредиент', width: 180 }, { label: 'Тип', width: 120 }, { label: 'До', width: 100, align: 'right' }, { label: 'Изменение', width: 120, align: 'right' }, { label: 'После', width: 100, align: 'right' }, { label: 'Документ', width: 150 }, { label: 'Комментарий', width: 180 }]} rows={(movementsQ.data ?? []).map(movement => ({ key: movement.id, cells: [formatDateTime(movement.createdAt), <Text style={styles.tableStrong}>{movement.ingredientName}</Text>, <Badge tone={movement.type === 'purchase' || movement.type === 'return' ? 'success' : movement.type === 'sale' ? 'danger' : movement.type === 'correction' ? 'warning' : 'muted'}>{MOVEMENT_LABEL[movement.type] ?? movement.type}</Badge>, qty(movement.beforeStock, movement.unit), <Text style={[styles.tableStrong, toneText(movement.change > 0 ? 'success' : movement.change < 0 ? 'danger' : 'muted')]}>{`${movement.change > 0 ? '+' : ''}${qty(movement.change, movement.unit)}`}</Text>, qty(movement.afterStock, movement.unit), movement.documentLabel ?? '—', movement.comment ?? '—'] }))} /></View>
      {!movementsQ.isLoading && (movementsQ.data ?? []).length === 0 ? <Empty text="Движений не найдено" /> : null}
    </View>
  );
}

type WarehouseColumn = { label: string; width: number; align?: 'left' | 'center' | 'right' };
type WarehouseRow = { key: string; cells: React.ReactNode[]; onPress?: () => void; detail?: React.ReactNode };
function WarehouseTable({ columns, rows }: { columns: WarehouseColumn[]; rows: WarehouseRow[] }) {
  const width = columns.reduce((total, column) => total + column.width, 0);
  return <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled"><View style={{ width }}>
    <View style={styles.tableHead}>{columns.map(column => <Text key={column.label} style={[styles.tableHeading, { width: column.width, textAlign: column.align ?? 'left' }]} translate>{column.label}</Text>)}</View>
    {rows.map(row => <View key={row.key}><FastPressable onPress={row.onPress} style={styles.tableRow}>{row.cells.map((cell, index) => <View key={index} style={[styles.tableCell, { width: columns[index].width, alignItems: columns[index].align === 'right' ? 'flex-end' : columns[index].align === 'center' ? 'center' : 'flex-start' }]}>{typeof cell === 'string' || typeof cell === 'number' ? <Text style={styles.tableCellText}>{cell}</Text> : cell}</View>)}</FastPressable>{row.detail ? <View style={styles.tableDetail}>{row.detail}</View> : null}</View>)}
  </View></ScrollView>;
}

function AddAction({ label, onPress }: { label: string; onPress: () => void }) {
  return <FastPressable style={styles.addAction} onPress={onPress}><PwaIcon name="plus" size={16} color={colors.white} /><Text style={styles.addActionText} translate>{label}</Text></FastPressable>;
}

function Metric({ label, value, large = false }: { label: string; value: string | number; large?: boolean }) {
  return (
    <Card style={{ ...styles.metric, ...(large ? { ...styles.metricLarge, width: '100%' } : {}) }}>
      <Text style={[styles.metricLabel, large && styles.metricLargeLabel]} translate>{label}</Text>
      <Text style={[styles.metricValue, large && styles.metricLargeValue]}>{String(value)}</Text>
    </Card>
  );
}

function StockTrend({ points }: { points: { date: string; value: number }[] }) {
  return <RevenueChart stock data={points.map(point => ({ label: point.date, amount: point.value }))} />;
}

function CompactTable({ columns, rows, empty, minWidth = 280 }: { columns: { label: string; width?: number; align?: 'left' | 'right' }[]; rows: React.ReactNode[][]; empty: string; minWidth?: number }) {
  const [width, setWidth] = useState(0);
  if (!rows.length) return <Text style={styles.compactEmpty} translate>{empty}</Text>;
  const cellStyle = (index: number) => ({ width: columns[index].width, flex: columns[index].width ? undefined : 1, alignItems: columns[index].align === 'right' ? 'flex-end' as const : 'flex-start' as const });
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)}><ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled"><View style={{ width: Math.max(width, minWidth) }}>
    <View style={styles.compactHeader}>{columns.map((column, index) => <View key={column.label} style={[styles.compactCell, cellStyle(index), { paddingVertical: 8 }]}><Text style={styles.compactHeading} translate>{column.label}</Text></View>)}</View>
    {rows.map((row, rowIndex) => <View key={rowIndex} style={[styles.compactRow, rowIndex < rows.length - 1 && styles.compactBorder]}>{row.map((cell, index) => <View key={index} style={[styles.compactCell, cellStyle(index)]}>{typeof cell === 'string' || typeof cell === 'number' ? <Text style={[styles.compactText, index === 0 && styles.compactStrong]}>{cell}</Text> : cell}</View>)}</View>)}
  </View></ScrollView></View>;
}

function formatMovementTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function Panel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const rows = React.Children.toArray(children);
  return (
    <Card style={styles.panel}>
      <Text style={styles.panelTitle} translate>{title}</Text>
      {rows.length > 0 ? <View style={styles.panelRows}>{rows}</View> : <Text style={styles.emptyText}>{empty}</Text>}
    </Card>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'primary' | 'muted';

function InfoRow({
  title,
  subtitle,
  value,
  tone,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  tone?: Tone;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1} translate>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, tone && toneText(tone)]}>{value}</Text> : null}
    </View>
  );
}

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <View style={[styles.badge, toneBg(tone)]}>
      <Text style={[styles.badgeText, toneText(tone)]}>{children}</Text>
    </View>
  );
}

function Search({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textLight}
      style={styles.search}
    />
  );
}

function LoadingBox() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.emptyText} translate>{text}</Text>;
}

function aggregateInventory(item: AdminDish) {
  const hasVariants = item.variants.length > 0;
  const stock = hasVariants
    ? item.variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0)
    : (item.stock ?? 0);
  const initial = hasVariants
    ? item.variants.reduce((sum, variant) => sum + (variant.initialStock ?? variant.stock ?? 0), 0)
    : (item.initialStock ?? stock);
  const low = stock > 0 && initial > 0 && stock <= 0.2 * initial;
  const unit = hasVariants ? 'ед.' : normalizeUnitLabel(item.unit);
  if (stock === 0) return { stock, unit, label: 'Нет в наличии', tone: 'danger' as Tone };
  if (low) return { stock, unit, label: 'Мало осталось', tone: 'warning' as Tone };
  return { stock, unit, label: 'В наличии', tone: 'success' as Tone };
}

function periodRange(period: PeriodPreset) {
  const today = new Date();
  if (period === 'today') {
    const value = localDate(today);
    return { dateFrom: value, dateTo: value };
  }
  if (period === 'month') return { dateFrom: localDate(addDays(today, -29)), dateTo: localDate(today) };
  return { dateFrom: localDate(addDays(today, -6)), dateTo: localDate(today) };
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
}

function toneBg(tone: Tone) {
  switch (tone) {
    case 'success':
      return { backgroundColor: colors.successSoft };
    case 'warning':
      return { backgroundColor: colors.warningSoft };
    case 'danger':
      return { backgroundColor: colors.dangerSoft };
    case 'primary':
      return { backgroundColor: colors.primarySoft };
    default:
      return { backgroundColor: colors.slate100 };
  }
}

function toneText(tone: Tone) {
  switch (tone) {
    case 'success':
      return { color: colors.success };
    case 'warning':
      return { color: colors.warning };
    case 'danger':
      return { color: colors.danger };
    case 'primary':
      return { color: colors.primary };
    default:
      return { color: colors.textMuted };
  }
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: 16, paddingBottom: spacing.xl },
  stack: { gap: 16 },
  overviewTrendGrid: { gap: 16 },
  compactHeader: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border },
  compactRow: { flexDirection: 'row', alignItems: 'center' },
  compactBorder: { borderBottomWidth: 1, borderColor: colors.border },
  compactCell: { paddingHorizontal: 8, paddingVertical: 10, minWidth: 0 },
  compactHeading: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  compactText: { fontSize: 14, color: colors.textSecondary },
  compactStrong: { fontWeight: '500', color: colors.textPrimary },
  compactEmpty: { paddingVertical: 32, textAlign: 'center', fontSize: 14, color: colors.textMuted },
  warehouseToolbar: { gap: 8, borderBottomWidth: 1, borderColor: colors.border },
  warehouseTabs: { flexDirection: 'row', gap: 2 },
  warehouseTab: { borderBottomWidth: 2, borderColor: 'transparent', paddingHorizontal: 12, paddingVertical: 10 },
  warehouseTabActive: { borderColor: colors.primary },
  warehouseTabLabel: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  periodTabs: { flexDirection: 'row', alignSelf: 'flex-end', backgroundColor: colors.white, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 4, marginBottom: 8 },
  periodTab: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  periodTabActive: { backgroundColor: colors.primary },
  periodLabel: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  tableCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.white, overflow: 'hidden' },
  tableToolbar: { padding: 16, gap: 8, borderBottomWidth: 1, borderColor: colors.border },
  addAction: { height: 40, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary },
  addActionText: { fontSize: 14, fontWeight: '500', color: colors.white },
  tableHead: { flexDirection: 'row', backgroundColor: colors.background, borderBottomWidth: 1, borderColor: colors.border },
  tableHeading: { fontSize: 12, fontWeight: '500', color: colors.textMuted, paddingHorizontal: 16, paddingVertical: 12 },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border },
  tableCell: { paddingHorizontal: 16, paddingVertical: 12 },
  tableCellText: { fontSize: 14, color: colors.textSecondary },
  tableStrong: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  purchaseFilters: { flexDirection: 'row', gap: 4 },
  purchasesGrid: { gap: 16, alignItems: 'stretch' },
  purchaseFilter: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  purchaseFilterActive: { backgroundColor: colors.primarySoft },
  purchaseFilterText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  tableDetail: { backgroundColor: colors.background, paddingHorizontal: 16, paddingVertical: 12 },
  tableActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  tableAction: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  tableActionLabel: { fontSize: 14, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { width: '48%', gap: 8, padding: 12, borderRadius: 8 },
  metricLabel: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 1.1, color: colors.textMuted },
  metricValue: { fontSize: 22, fontWeight: '600', color: colors.textPrimary },
  metricLarge: { padding: 16, borderRadius: 12, gap: 6 },
  metricLargeLabel: { fontSize: 13, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  metricLargeValue: { fontSize: 24 },
  panel: { flexGrow: 1, gap: 12, padding: 16, borderRadius: 12 },
  panelTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  panelRows: { gap: spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  rowSub: { marginTop: 2, fontSize: fontSize.sm, color: colors.textMuted },
  rowValue: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  search: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
  itemCard: { gap: spacing.sm },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  itemSub: { fontSize: fontSize.sm, color: colors.textMuted },
  itemRight: { alignItems: 'flex-end' },
  itemValue: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  subRows: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm },
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '500' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  loading: { minHeight: 140, alignItems: 'center', justifyContent: 'center' },
  emptyText: { paddingVertical: spacing.xl, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  chevronUp: { transform: [{ rotate: '180deg' }] },
});
