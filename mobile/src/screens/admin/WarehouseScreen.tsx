import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Alert, Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { DateField } from '@/components/DateField';
import { Button, Card, PillTabs } from '@/components/ui';
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
import Svg, { Line, Polyline } from 'react-native-svg';

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
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <PillTabs items={TABS} value={tab} onChange={setTab} />
      {tab === 'overview' ? (
        <>
          <PillTabs items={PERIODS} value={period} onChange={setPeriod} />
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
  const q = useWarehouseDashboard(range);
  const data = q.data;
  if (q.isLoading) return <LoadingBox />;
  if (q.isError) return <Text style={{ color: colors.danger }}>{apiError(q.error)}</Text>;
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        <Metric label="Стоимость остатков" value={money(data?.stockValue ?? 0)} />
        <Metric label="Низкий остаток" value={String(data?.lowStockCount ?? 0)} />
        <Metric label="Закупки за период" value={money(data?.purchasesTotal ?? 0)} />
        <Metric label="Списания сырья" value={money(data?.ingredientWriteOffTotal ?? 0)} />
      </View>
      <Panel title="Стоимость остатков за период" empty="Нет данных за период"><StockTrend points={data?.stockValueTrend ?? []} /></Panel>
      <Panel title="Низкий остаток" empty="Низких остатков нет">
        {(data?.lowStockItems ?? []).map((item) => (
          <InfoRow
            key={item.id}
            title={item.name}
            subtitle={`Порог: ${qty(item.lowStockThreshold, item.unit)}`}
            value={qty(item.stock, item.unit)}
            tone="warning"
          />
        ))}
      </Panel>
      <Panel title="Топ расходуемых ингредиентов" empty="Нет списаний за период">
        {(data?.topConsumedIngredients ?? []).map((item) => (
          <InfoRow key={item.ingredientId} title={item.name} subtitle={qty(item.quantity, item.unit)} value={money(item.cost)} />
        ))}
      </Panel>
      <Panel title="Последние движения" empty="Движений пока нет">
        {(data?.recentMovements ?? []).map((item) => (
          <InfoRow
            key={item.id}
            title={item.ingredientName}
            subtitle={`${formatShortDate(item.createdAt)} · ${MOVEMENT_LABEL[item.type] ?? item.type}`}
            value={`${item.change > 0 ? '+' : ''}${qty(item.change, item.unit)}`}
            tone={item.change > 0 ? 'success' : item.change < 0 ? 'danger' : 'muted'}
          />
        ))}
      </Panel>
      <Panel title="Закупки по поставщикам" empty="Нет закупок за период">
        {(data?.suppliersTop ?? []).map((item) => (
          <InfoRow key={item.supplier} title={item.supplier} value={money(item.total)} />
        ))}
      </Panel>
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
        <Metric label="Низкий остаток" value={overview.data?.lowStockCount ?? '—'} />
      </View>
      <Search value={search} onChangeText={setSearch} placeholder="Поиск по складу" />
      {canEditMenu ? <><Select value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'Все категории' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name , translate: false }))]} title="Категория" /><Button title="+ Добавить товар" onPress={() => setEditing('new')} /></> : <Text style={styles.itemSub} translate>Для изменения товаров нужен доступ к разделу «Меню».</Text>}
      {itemsQ.isLoading ? <LoadingBox /> : null}
      {itemsQ.isError ? <View style={styles.stack}><Text style={{ color: colors.danger }}>{apiError(itemsQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void itemsQ.refetch()} /></View> : null}
      {(itemsQ.data ?? []).map((item) => {
        const aggregate = aggregateInventory(item);
        const hasVariants = item.variants.length > 0;
        const open = !!expanded[item.id];
        return (
          <Card key={item.id} style={styles.itemCard}>
            <FastPressable
              disabled={!hasVariants}
              onPress={() => setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }))}
              style={styles.itemHead}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.itemTitle}>{item.name}</Text>
                <Text style={styles.itemSub} translate>{hasVariants ? `${item.variants.length} вариант(ов)` : item.category.name}</Text>
              </View>
              <View style={styles.itemRight}>
                <Text style={styles.itemValue}>{aggregate.stock}</Text>
                <Text style={styles.itemSub}>{aggregate.unit}</Text>
              </View>
              {hasVariants ? (
                <View style={open ? styles.chevronUp : undefined}>
                  <PwaIcon name="chevronDown" size={18} color={colors.textMuted} />
                </View>
              ) : null}
            </FastPressable>
            <Badge tone={aggregate.tone}>{aggregate.label}</Badge>
            <Button title="Техкарта" variant="secondary" size="md" onPress={() => setRecipe(item)} />
            {canEditMenu ? <View style={styles.rowBetween}><Button title="Изменить" variant="secondary" size="md" onPress={() => setEditing(item)} /><Button title="Удалить" variant="danger" size="md" onPress={() => Alert.alert('Удалить товар?', item.name, [{ text: 'Назад', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => void remove.mutateAsync(item.id).catch((error) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() })) }])} /></View> : null}
            {open ? (
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
            ) : null}
          </Card>
        );
      })}
      {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 ? <Empty text="Складские товары не найдены" /> : null}
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
      <Search value={search} onChangeText={setSearch} placeholder="Поиск по сырью" />
      <Button title="+ Добавить сырьё" onPress={() => setEditing('new')} />
      {itemsQ.isLoading ? <LoadingBox /> : null}
      {itemsQ.isError ? <View style={styles.stack}><Text style={{ color: colors.danger }}>{apiError(itemsQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void itemsQ.refetch()} /></View> : null}
      {(itemsQ.data ?? []).map((item) => (
        <Card key={item.id} style={styles.itemCard}>
          <InfoRow
            title={item.name}
            subtitle={`Себестоимость: ${money(item.avgCost)}/${item.unit}`}
            value={qty(item.stock, item.unit)}
            tone={item.isLow ? 'warning' : 'success'}
          />
          <Text style={styles.itemSub} translate>Порог низкого остатка: {qty(item.lowStockThreshold, item.unit)}</Text>
          <Badge tone={item.isLow ? 'warning' : 'success'}>{item.isLow ? 'Низкий' : 'Норма'}</Badge>
          <View style={styles.rowBetween}><Button title="Изменить" variant="secondary" size="md" onPress={() => setEditing(item)} /><Button title="Остаток" variant="secondary" size="md" onPress={() => setAdjustment(item)} /></View>
          <Button title="Удалить" variant="danger" size="md" onPress={() => Alert.alert('Удалить сырьё?', item.name, [{ text: 'Назад', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => void remove.mutateAsync(item.id).catch((error) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() })) }])} />
        </Card>
      ))}
      {!itemsQ.isLoading && (itemsQ.data ?? []).length === 0 ? <Empty text="Сырьё не найдено" /> : null}
      {editing ? <IngredientEditor ingredient={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {adjustment ? <IngredientAdjustment ingredient={adjustment} onClose={() => setAdjustment(null)} /> : null}
    </View>
  );
}

function PurchasesTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const overview = usePurchasesOverview();
  const purchasesQ = usePurchases({ status, search });
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        <Metric label="Закупок за период" value={overview.data?.count ?? '—'} />
        <Metric label="Поставщиков" value={overview.data?.suppliers ?? '—'} />
        <Metric label="Сумма закупок" value={overview.data ? money(overview.data.sum) : '—'} />
      </View>
      <Search value={search} onChangeText={setSearch} placeholder="Поиск по поставщику" />
      <Select value={status} options={PURCHASE_STATUS_OPTIONS} onChange={setStatus} title="Статус закупки" />
      <Button title="+ Новая закупка" onPress={() => setEditing('new')} />
      {purchasesQ.isLoading ? <LoadingBox /> : null}
      {purchasesQ.isError ? <View style={styles.stack}><Text style={{ color: colors.danger }}>{apiError(purchasesQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void purchasesQ.refetch()} /></View> : null}
      {(purchasesQ.data ?? []).map((purchase) => {
        const statusMeta = PURCHASE_STATUS[purchase.status];
        return (
          <Card key={purchase.id} style={styles.itemCard} onPress={() => setEditing(purchase.id)}>
            <InfoRow
              title={purchaseNumber(purchase.number)}
              subtitle={`${formatDate(purchase.date)} · ${purchase.supplier}`}
              value={money(purchase.totalAmount)}
            />
            <View style={styles.rowBetween}>
              <Text style={styles.itemSub} translate>Позиций: {purchase.itemsCount}</Text>
              <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
            </View>
          </Card>
        );
      })}
      {!purchasesQ.isLoading && (purchasesQ.data ?? []).length === 0 ? <Empty text="Закупки не найдены" /> : null}
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
      {(movementsQ.data ?? []).map((movement) => (
        <Card key={movement.id} style={styles.itemCard}>
          <InfoRow
            title={movement.ingredientName}
            subtitle={`${formatDateTime(movement.createdAt)} · ${MOVEMENT_LABEL[movement.type] ?? movement.type}`}
            value={`${movement.change > 0 ? '+' : ''}${qty(movement.change, movement.unit)}`}
            tone={movement.change > 0 ? 'success' : movement.change < 0 ? 'danger' : 'muted'}
          />
          <Text style={styles.itemSub} translate>
            Было {qty(movement.beforeStock, movement.unit)} · Стало {qty(movement.afterStock, movement.unit)}
          </Text>
          <Text style={styles.itemSub}>
            {movement.documentLabel ?? '—'} · {movement.comment ?? '—'}
          </Text>
        </Card>
      ))}
      {!movementsQ.isLoading && (movementsQ.data ?? []).length === 0 ? <Empty text="Движений не найдено" /> : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card style={styles.metric}>
      <Text style={styles.metricLabel} translate>{label}</Text>
      <Text style={styles.metricValue}>{String(value)}</Text>
    </Card>
  );
}

function StockTrend({ points }: { points: { date: string; value: number }[] }) {
  if (!points.length) return <Empty text="Нет данных за период" />;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const range = max - min || 1;
  const coordinates = points.map((p, i) => `${10 + i * 280 / Math.max(1, points.length - 1)},${110 - (p.value - min) * 90 / range}`).join(' ');
  return <View><Text style={styles.itemSub}>{money(max)}</Text><Svg width="100%" height={130} viewBox="0 0 300 130"><Line x1={10} x2={290} y1={110} y2={110} stroke={colors.border} /><Polyline points={coordinates} fill="none" stroke={colors.primary} strokeWidth={3} /></Svg><View style={styles.rowBetween}><Text style={styles.itemSub}>{formatDate(points[0].date)}</Text><Text style={styles.itemSub}>{formatDate(points[points.length - 1].date)}</Text></View><Text style={styles.itemSub} translate>Текущий остаток: {money(points[points.length - 1].value)}</Text></View>;
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
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  stack: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { width: '48%', gap: 4, padding: spacing.md },
  metricLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  metricValue: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  panel: { gap: spacing.md },
  panelTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
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
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  loading: { minHeight: 140, alignItems: 'center', justifyContent: 'center' },
  emptyText: { paddingVertical: spacing.xl, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  chevronUp: { transform: [{ rotate: '180deg' }] },
});
