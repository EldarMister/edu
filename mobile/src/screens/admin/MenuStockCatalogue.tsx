import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { Alert, Text } from '@/components/typography';
import { Button, Field, Toggle } from '@/components/ui';
import { Select } from '@/components/Select';
import { FastPressable } from '@/components/FastPressable';
import { usePermissions } from '@/hooks/usePermissions';
import { useCatalogueIngredients, useCatalogueIngredientMutations, type CatalogueIngredient } from '@/services/api/menuCatalogue';
import type { WarehouseLocation } from '@/services/api/warehouse';
import { UNIT_OPTIONS, unitsForType, type UnitCode } from '@/services/api/warehouseUnits';
import { apiError } from '@/lib/api';
import { money } from '@/utils/format';
import { colors, spacing } from '@/theme';
import { WarehouseWorkspace } from './WarehouseWorkspace';

export function rawCatalogueItems(items: CatalogueIngredient[]) {
  return items.filter(item => !item.isPrepared && item.kind !== 'preparation' && item.kind !== 'prepared_dish' && item.kind !== 'goods' && item.kind !== 'beverage');
}
export function MenuStockCatalogue({ initialCategory = '' }: { initialCategory?: string }) {
  const { canSection, canAction } = usePermissions();
  const allowed = canSection('warehouse');
  const query = useCatalogueIngredients(allowed);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(initialCategory);
  const [status, setStatus] = useState('active');
  const [editor, setEditor] = useState<CatalogueIngredient | 'new' | null>(null);
  const items = rawCatalogueItems(query.data ?? []);
  const categories = [...new Set(items.flatMap(item => item.category ? [item.category] : []))].sort((a, b) => a.localeCompare(b, 'ru'));
  const rows = items.filter(item => (!category || item.category === category) && (status === 'all' || item.isActive === (status === 'active')) && `${item.name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a,b) => a.name.localeCompare(b.name, 'ru'));
  if (!allowed) return <Text style={styles.notice} translate>Нет доступа к ингредиентам склада</Text>;
  return <>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.toolbar}><Field containerStyle={{ flex: 1 }} value={search} onChangeText={setSearch} placeholder="Поиск ингредиентов" />
        {canAction('warehouseReceive') && <Button title="Добавить" size="md" onPress={() => setEditor('new')} />}</View>
      <View style={styles.toolbar}><View style={styles.flex}><Select value={category} onChange={setCategory} title="Категория" options={[{ value: '', label: 'Все категории' }, ...categories.map(value => ({ value, label: value, translate: false }))]} /></View>
        <View style={styles.flex}><Select value={status} onChange={setStatus} title="Статус" options={[{ value: 'active', label: 'Активные' }, { value: 'archived', label: 'В архиве' }, { value: 'all', label: 'Все' }]} /></View></View>
      {query.isLoading ? <ActivityIndicator color={colors.primary} /> : query.isError ? <CatalogueError error={query.error} retry={() => void query.refetch()} /> : <ScrollView horizontal>
        <View style={styles.table}><View style={styles.row}><Text style={[styles.heading, styles.name]} translate>Название</Text><Text style={[styles.heading, styles.category]} translate>Категория</Text><Text style={[styles.heading, styles.unit]} translate>Ед.</Text>{canAction('warehouseCosts') && <Text style={[styles.heading, styles.cost]} translate>Себестоимость</Text>}</View>
          {rows.map(item => <FastPressable key={item.id} onPress={() => setEditor(item)} style={styles.row} accessibilityRole="button" accessibilityLabel={`Открыть: ${item.name}`}><Text style={[styles.text, styles.name, styles.link]}>{item.name}{!item.isActive ? ' · В архиве' : ''}</Text><Text style={[styles.text, styles.category]}>{item.category ?? '—'}</Text><Text style={[styles.text, styles.unit]}>{item.unit}</Text>{canAction('warehouseCosts') && <Text style={[styles.text, styles.cost]}>{item.avgCost == null ? '—' : money(item.avgCost)}</Text>}</FastPressable>)}
          {!rows.length && <Text style={styles.notice} translate>Ингредиенты не найдены</Text>}
        </View>
      </ScrollView>}
    </ScrollView>
    {editor && <CatalogueIngredientEditor item={editor === 'new' ? null : editor} onClose={() => setEditor(null)} />}
  </>;
}

export function CatalogueIngredientEditor({ item, warehouse, onClose }: {
  item: CatalogueIngredient | null;
  warehouse?: WarehouseLocation;
  onClose: () => void;
}) {
  const { canAction } = usePermissions();
  const editable = canAction(item ? 'warehouseSettings' : 'warehouseReceive');
  const { save } = useCatalogueIngredientMutations();
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<UnitCode>(item?.displayUnit ?? 'kg');
  const [category, setCategory] = useState(item?.category ?? '');
  const [threshold, setThreshold] = useState(String(item?.lowStockThreshold ?? 0));
  const [active, setActive] = useState(item?.isActive ?? true);
  const [error, setError] = useState('');
  const signature = JSON.stringify([name, unit, category, threshold, active]);
  const baseline = React.useRef(signature);
  const close = () => {
    if (save.isPending) return;
    if (!editable || baseline.current === signature) onClose();
    else Alert.alert('Есть несохранённые изменения', 'Выйти без сохранения?', [{ text: 'Продолжить', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: onClose }]);
  };
  async function submit() {
    if (!editable || save.isPending) return;
    const minimum = Number(threshold.trim().replace(',', '.'));
    if (!name.trim() || threshold.trim() === '' || !Number.isFinite(minimum) || minimum < 0) { setError('Укажите название и минимальный остаток не меньше нуля'); return; }
    setError('');
    try { await save.mutateAsync({ id: item?.id, warehouseId: warehouse?.id, name: name.trim(), unit, category: category.trim() || null, lowStockThreshold: minimum, ...(item ? { isActive: active } : {}) }); onClose(); }
    catch (cause) { setError(apiError(cause)); }
  }
  return <WarehouseWorkspace title={item ? 'Карточка ингредиента' : 'Новый ингредиент'} onClose={close} footer={editable ? <Button title="Сохранить" loading={save.isPending} onPress={() => void submit()} /> : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View pointerEvents={editable && !save.isPending ? 'auto' : 'none'} style={styles.stack}>
      {warehouse && <Text style={styles.notice}>{warehouse.name}</Text>}
      <Field label="Название" value={name} onChangeText={setName} maxLength={120} editable={editable} />
      <Field label="Категория" value={category} onChangeText={setCategory} maxLength={120} editable={editable} />
      <Text style={styles.heading} translate>Единица измерения</Text><Select title="Единица измерения" disabled={!editable || save.isPending} value={unit} onChange={setUnit} options={item ? unitsForType(item.unitType) : UNIT_OPTIONS} />
      <Field label="Минимальный остаток" value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" editable={editable} />
      {item && <View style={styles.toolbar}><Text style={styles.text} translate>Активен</Text><Toggle checked={active} onChange={setActive} /></View>}
    </View>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</ScrollView>
  </WarehouseWorkspace>;
}

export function IngredientCategoriesPage() {
  const { canAction, canSection } = usePermissions();
  const query = useCatalogueIngredients(canSection('warehouse'));
  const { renameCategory } = useCatalogueIngredientMutations();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [name, setName] = useState('');
  const counts = new Map<string, number>();
  for (const item of rawCatalogueItems(query.data ?? [])) if (item.category) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const rows = [...counts].filter(([category]) => category.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort(([a],[b]) => a.localeCompare(b,'ru'));
  if (!canSection('warehouse')) return <Text style={styles.notice} translate>Нет доступа к ингредиентам склада</Text>;
  if (opened) return <View style={styles.flex}><View style={styles.content}><Button title="Назад к категориям" variant="secondary" size="md" onPress={() => setOpened(null)} /></View><MenuStockCatalogue initialCategory={opened} /></View>;
  return <>
    <ScrollView contentContainerStyle={styles.content}><Field value={search} onChangeText={setSearch} placeholder="Поиск категории" />
      {query.isLoading ? <ActivityIndicator color={colors.primary} /> : query.isError ? <CatalogueError error={query.error} retry={() => void query.refetch()} /> : rows.map(([category,count]) => <View key={category} style={styles.categoryRow}><FastPressable style={styles.flex} onPress={() => setOpened(category)}><Text style={[styles.text, styles.link]}>{category}</Text><Text style={styles.muted}>{count} ингредиентов</Text></FastPressable>{canAction('warehouseSettings') && <Button title="Ред." variant="secondary" size="md" onPress={() => { setEditing(category); setName(category); renameCategory.reset(); }} />}</View>)}
      {!query.isLoading && !query.isError && !rows.length && <Text style={styles.notice} translate>Категории пока не добавлены. Укажите категорию в карточке ингредиента.</Text>}
    </ScrollView>
    {editing && <WarehouseWorkspace title="Категория ингредиентов" onClose={() => { if (!renameCategory.isPending) setEditing(null); }} footer={<Button title="Сохранить" disabled={!name.trim() || !canAction('warehouseSettings')} loading={renameCategory.isPending} onPress={() => { if (name.trim()) void renameCategory.mutateAsync({ from: editing, to: name.trim() }).then(() => setEditing(null)).catch(() => undefined); }} />}><ScrollView contentContainerStyle={styles.content}><Field label="Название" value={name} onChangeText={setName} maxLength={120} editable={!renameCategory.isPending} />{renameCategory.isError && <Text style={styles.error}>{apiError(renameCategory.error)}</Text>}</ScrollView></WarehouseWorkspace>}
  </>;
}

function CatalogueError({ error, retry }: { error: unknown; retry: () => void }) {
  return <View style={styles.stack}><Text accessibilityRole="alert" style={styles.error}>{apiError(error)}</Text><Button title="Повторить" variant="secondary" onPress={retry} /></View>;
}
const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md }, stack: { gap: spacing.md }, flex: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  table: { minWidth: 620, borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading: { color: colors.textMuted, fontSize: 13, fontWeight: '500' }, text: { color: colors.textPrimary, fontSize: 14 },
  name: { width: 245, paddingRight: 16 }, category: { width: 150 }, unit: { width: 56 }, cost: { width: 130, textAlign: 'right' },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  link: { color: colors.primary }, muted: { color: colors.textMuted, fontSize: 12 }, notice: { padding: spacing.lg, color: colors.textMuted }, error: { color: colors.danger, fontSize: 14 },
});
