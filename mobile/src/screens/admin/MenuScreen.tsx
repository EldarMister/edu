import { ScrollView, View } from '@/components/themed';
import React, { useState } from 'react';
import { Image, StyleSheet, type View as NativeView } from 'react-native';
import { Alert, Text, TextInput } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { useDeletionParticles } from '@/components/DeletionParticles';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { Button, Field as InputField, Toggle } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { API_BASE } from '@/config/env';
import { useNotifications } from '@/store/notifications';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { useT } from '@/lib/i18n';
import { useMenuEntry, useSaveMenuEntry, type MenuRecipeInput, type MenuEntry } from '@/services/api/menuEntries';
import { filterMenuDishes, menuKind, type MenuView } from './menuCatalogue';
import { MenuStockCatalogue, IngredientCategoriesPage } from './MenuStockCatalogue';
import { WarehousePreparationTab } from './WarehousePreparationTab';
import { useWarehouseLocations } from '@/services/api/warehouse';
export type { MenuView } from './menuCatalogue';
import { prepStationOptions, usePrepStations } from '@/services/api/prepStations';
import { minDishUnitPrice, money, variantNamesLine } from '@/utils/format';
import { normalizeUnitLabel, unitLabelOptions } from '@/utils/units';
import {
  useAdminCategories,
  useAdminDishes,
  useAdminGoods,
  useCategoryMutations,
  useDishMutations,
  useSetMutations,
  type AdminCategory,
  type AdminDish,
  type AdminGood,
  type AdminDishVariant,
} from '@/services/api/admin';
import type { PrepStation } from '@/types';
import { PrepStationsPage } from './PrepStationsPage';
import { dishVariantPayload, initialDishPrice } from './dishDraft';
import { DishRecipeFields, dishRecipePayload, hasRemovedVariantAmounts, initialDishRecipe } from './DishRecipeFields';
import { WarehouseWorkspace } from './WarehouseWorkspace';
import { AdminLoadingSkeleton } from './AdminLoadingSkeleton';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';
import { WarehouseWorkbook } from './WarehouseWorkbook';
import { GoodsColumnsEditor, goodsWorkbookUrl, initialMenuFilters, MenuAdditionalFilters, menuColumns, useGoodsColumns, type MenuColumn, type MenuFilters } from './MenuGoodsControls';
import { dishTaxInput, dishTaxValue, effectiveMenuTaxId, MenuTaxSelect, menuTaxLabel } from './MenuTaxSelect';
import { useMenuTaxOptions } from '@/services/api/taxes';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

function resolveApiImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('data:') || url.startsWith('http')) return url;
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
}

function weightedBaseLabel(dish: Pick<AdminDish, 'weightedMeasure' | 'weightedPriceBase'>) {
  const small = dish.weightedMeasure === 'volume' ? 'мл' : 'г';
  const large = dish.weightedMeasure === 'volume' ? 'л' : 'кг';
  const base = dish.weightedPriceBase ?? 100;
  return base === 1000 ? `1 ${large}` : `${base} ${small}`;
}

/** Меню (владелец/админ) — порт PWA MenuPage (блюда + категории + сеты). */
export function MenuScreen({ view = 'goods' }: { view?: MenuView } = {}) {
  if (view === 'ingredients') return <MenuStockCatalogue />;
  if (view === 'ingredientCategories') return <IngredientCategoriesPage />;
  if (view === 'preparations') return <MenuPreparations />;
  if (view === 'categories') return <MenuCategoriesPage />;
  if (view === 'stations') return <PrepStationsPage />;
  return <MenuDishList key={view} view={view} />;
}
function MenuPreparations() {
  const locations = useWarehouseLocations();
  if (locations.isLoading) return <AdminLoadingSkeleton />;
  return <SheetScrollView contentContainerStyle={styles.listContent}><WarehousePreparationTab locations={locations.data?.locations ?? []} /></SheetScrollView>;
}
function MenuCategoriesPage() {
  const query = useAdminCategories();
  if (query.isLoading) return <AdminLoadingSkeleton />;
  if (query.isError) return <View style={styles.center}><Text style={styles.error}>{apiError(query.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void query.refetch()} /></View>;
  return <CategoryDirectory categories={query.data ?? []} />;
}
function MenuDishList({ view }: { view: 'goods' | 'recipes' }) {
  const [filters, setFilters] = useState(initialMenuFilters);
  const [sort, setSort] = useState<'asc' | 'desc'>('asc');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const particles = useDeletionParticles();
  const updateFilters = (patch: Partial<MenuFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const { canAction } = usePermissions();
  const editable = canAction('editMenu');
  const isGoods = view === 'goods';
  const [search, setSearch] = useState('');
  const [dishModal, setDishModal] = useState<AdminDish | null | 'new'>(null);
  const [setModal, setSetModal] = useState<AdminDish | null | 'new'>(null);

  const categoriesQ = useAdminCategories();
  const { stations } = usePrepStations();
  const isOwner = useAuth((state) => state.user?.role === 'OWNER');
  const dishesQ = useAdminDishes('', search.trim(), !isGoods);
  const goodsQ = useAdminGoods(isGoods);
  const listQ = isGoods ? goodsQ : dishesQ;
  const taxes = useMenuTaxOptions().data ?? [];
  const savedColumns = useGoodsColumns();
  const visibleColumns: MenuColumn[] = isGoods ? savedColumns.columns : ['category', 'price', 'stock', 'availability', ...(taxes.length ? ['tax' as const] : [])];
  const tableColumns: MenuColumn[] = ['name', ...visibleColumns, 'actions'];
  const tableWidth = tableColumns.reduce((total, column) => total + menuColumns[column].width, 0);
  const { remove } = useDishMutations();
  const push = useNotifications((s) => s.push);
  const categories = categoriesQ.data ?? [];

  const stationByCat = new Map(categories.map((c) => [c.id, c.prepStation ?? 'kitchen']));
  const stationNames = new Map(stations.map((station) => [station.id, station.name]));
  const goodsById = new Map((goodsQ.data ?? []).map((good) => [good.id, good]));
  const dishStation = (d: AdminDish) => goodsById.get(d.id)?.goodsStation ?? d.prepStation ?? stationByCat.get(d.categoryId) ?? 'none';
  const stationOptions = prepStationOptions(stations);
  const taxNames = new Map(taxes.map((tax) => [tax.id, menuTaxLabel(tax)]));
  const units = [...new Set((goodsQ.data ?? []).flatMap((good) => good.goodsUnits))].sort((left, right) => left.localeCompare(right, 'ru'));
  const nameFilter = filters.name.trim().toLocaleLowerCase('ru');
  const searchTerm = search.trim().toLocaleLowerCase('ru');
  const rows = filterMenuDishes(listQ.data ?? [], view, filters.availability).filter((dish) => {
    const name = dish.name.toLocaleLowerCase('ru');
    return (!searchTerm || name.includes(searchTerm)) && (!nameFilter || name.includes(nameFilter))
      && (!filters.categories.length || filters.categories.includes(dish.categoryId))
      && (!filters.stations.length || filters.stations.includes(dishStation(dish)))
      && (!filters.tax || filters.tax === (effectiveMenuTaxId(dish) ?? 'none'))
      && (!filters.weighted || !!dish.isWeighted === (filters.weighted === 'yes'))
      && (!filters.units.length || goodsById.get(dish.id)?.goodsUnits.some((unit) => filters.units.includes(unit)));
  });
  if (sort === 'desc') rows.reverse();

  const onDelete = (d: AdminDish) => {
    const play = particles.capture(d.id);
    Alert.alert('Удалить блюдо?', `«${d.name}» будет удалено.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          remove
            .mutateAsync(d.id)
            .then(() => { play?.(); push({ message: isGoods ? 'Товар удалён' : 'Техкарта удалена', at: new Date().toISOString() }); })
            .catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() })),
      },
    ]);
  };

  const openEdit = (d: AdminDish) => {
    if (d.isSet) {
      setSetModal(d);
      return;
    }
    setDishModal(d);
  };

  return (
    <View style={styles.particleFrame}>
    <SheetScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.menuCard}>
      <View style={styles.headerWrap}>
      <TextInput
        style={styles.search}
        placeholder={isGoods ? "Поиск товаров" : "Поиск техкарт"}
        placeholderTextColor={colors.textLight}
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.filterRow}>
        <WarehouseMultiSelect label="Категория" options={categories.map(({ id, name }) => ({ value: id, label: name, translate: false }))}
          value={filters.categories} onChange={(selected) => updateFilters({ categories: selected })} />
        <WarehouseMultiSelect label="Цех" options={stationOptions}
          value={filters.stations} onChange={(selected) => updateFilters({ stations: selected })} />
      </View>
      <MenuAdditionalFilters filters={filters} update={updateFilters} goods={isGoods}
        taxes={[{ value: 'none', label: 'Без налога' }, ...Array.from(taxNames, ([value, label]) => ({ value, label, translate: false }))]}
        units={units.map((unit) => ({ value: unit, label: unit }))} />
      <View style={styles.directoryToolbar}>
        <Text style={styles.checkHint}>{rows.length} {isGoods ? 'товаров' : 'техкарт'}</Text>
        <View style={styles.filterRow}>
          {isGoods ? <Button title="Столбцы" variant="secondary" size="md" onPress={() => setColumnsOpen(true)} /> : null}
          {isGoods && canAction('exportReports') ? <WarehouseWorkbook filename="Товары.xlsx" disabled={!goodsQ.isSuccess}
            url={goodsWorkbookUrl(savedColumns.columns, search, filters, sort)} /> : null}
          {editable && !isGoods ? <Button title="Добавить сет" size="md" variant="secondary" onPress={() => setSetModal('new')} /> : null}
          {editable ? <Button title={isGoods ? 'Добавить товар' : 'Добавить техкарту'} size="md" onPress={() => setDishModal('new')} /> : null}
        </View>
      </View>
      </View>
      {listQ.isLoading ? <AdminLoadingSkeleton /> : listQ.isError ? (
            <View style={styles.center}><Text style={styles.error}>{apiError(listQ.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void listQ.refetch()} /></View>
          ) : !rows.length ? (
            <Text style={styles.empty} translate>{isGoods ? 'Товары не найдены' : 'Техкарты не найдены'}</Text>
          ) : (
            <SheetScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: tableWidth }}>
              <View style={{ width: tableWidth }}>
                <View style={styles.tableHead}>{tableColumns.map((key) => {
                  const column = menuColumns[key];
                  const style = [styles.tableHeading, { width: column.width, textAlign: 'right' in column && column.right ? 'right' as const : 'left' as const }];
                  return key === 'name' ? <FastPressable key={key} accessibilityRole="button" accessibilityLabel="Сортировать по названию"
                    onPress={() => setSort((value) => value === 'asc' ? 'desc' : 'asc')}>
                    <Text style={style} translate>Название {sort === 'asc' ? '↑' : '↓'}</Text>
                  </FastPressable> : <Text key={key} style={style} translate>{column.label}</Text>;
                })}</View>
                {rows.map(dish => {
                  const station = dishStation(dish);
                  return <DishRow key={dish.id} rowRef={(row) => particles.register(dish.id, row)} dish={dish} good={goodsById.get(dish.id)} columns={visibleColumns} taxName={taxNames.get(effectiveMenuTaxId(dish) ?? '')} station={station} stationName={stationNames.get(station)} editable={editable} onEdit={() => openEdit(dish)} onDelete={() => onDelete(dish)} />;
                })}
              </View>
            </SheetScrollView>
          )
      }
      </View>
    </SheetScrollView>

      {dishModal !== null ? (
        <DishModal
          catalogKind={isGoods ? 'goods' : 'recipe'}
          dish={dishModal === 'new' ? null : dishModal}
          categories={categories}
          defaultCategoryId={filters.categories.length === 1 ? filters.categories[0] : ''}
          onClose={() => setDishModal(null)}
        />
      ) : null}
      {columnsOpen ? <GoodsColumnsEditor columns={savedColumns.columns} onApply={savedColumns.apply} onClose={() => setColumnsOpen(false)} /> : null}
      {setModal !== null ? <SetModal set={setModal === 'new' ? null : setModal} onClose={() => setSetModal(null)} /> : null}
      {particles.overlay}
    </View>
  );
}

function DishRow({
  rowRef,
  dish: d,
  good,
  columns,
  taxName,
  station,
  stationName,
  onEdit,
  onDelete,
  editable,
}: {
  rowRef: (row: NativeView | null) => void;
  editable: boolean;
  dish: AdminDish;
  good?: AdminGood;
  columns: MenuColumn[];
  taxName?: string;
  station: PrepStation;
  stationName?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasVar = d.variants.length > 0;
  const stock = hasVar ? d.variants.reduce((a, v) => a + (v.stock ?? 0), 0) : d.stock ?? 0;
  const outOfStock = d.trackInventory && stock === 0;
  const status = outOfStock
    ? { label: 'Нет в наличии', bg: colors.dangerSoft, fg: colors.danger }
    : d.isActive && d.isAvailable
      ? { label: 'Активно', bg: colors.successSoft, fg: colors.success }
      : { label: 'Скрыто', bg: colors.slate100, fg: colors.textMuted };

  return (
    <View ref={rowRef} collapsable={false} style={styles.dishRow}>
      <View style={[styles.menuCell, { width: 250 }]}>
        <View style={styles.dishNameRow}>
          <Text style={styles.dishName} numberOfLines={1}>
            {d.name}
          </Text>
          {d.isSet ? <MiniBadge label="Сет" bg={colors.warningSoft} fg={colors.warning} /> : null}
          {d.isWeighted ? <MiniBadge label="Весовое" bg={colors.primarySoft} fg={colors.primary} /> : null}
          {station !== 'kitchen' && station !== 'none' && stationName ? <MiniBadge label={stationName} bg={colors.primarySoft} fg={colors.primary} /> : null}
          {station === 'none' ? <MiniBadge label="Без отправки" bg={colors.slate100} fg={colors.textMuted} /> : null}
        </View>
        {hasVar ? <Text style={styles.variantsLine}>{variantNamesLine(d.variants)}</Text> : null}
        {d.description ? (
          <Text style={styles.dishDesc} numberOfLines={1}>
            {d.description}
          </Text>
        ) : null}
      </View>
      {columns.map((column) => {
        const width = menuColumns[column].width;
        if (column === 'availability') return <View key={column} style={[styles.menuCell, { width }]}>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.fg }]} translate>{status.label}</Text>
          </View>
        </View>;
        const cells: Partial<Record<MenuColumn, string>> = {
          category: d.category.name,
          price: (hasVar ? 'от ' : '') + money(good?.goodsPrice ?? (hasVar ? minDishUnitPrice(d) : d.price)),
          station: stationName ?? (station === 'none' ? 'Без цеха' : station),
          stock: d.trackInventory ? stock + ' ' + (hasVar && new Set(d.variants.map((variant) => normalizeUnitLabel(variant.unit))).size !== 1 ? 'по вариантам' : normalizeUnitLabel(hasVar ? d.variants[0].unit : d.unit)) : '—',
          unit: good?.goodsUnits.join(', ') ?? normalizeUnitLabel(d.unit),
          weighted: d.isWeighted ? 'Да' : 'Нет',
          tax: taxName ?? '—',
        };
        const right = column === 'price' || column === 'stock';
        return <Text key={column} style={[styles.menuCellText, { width, textAlign: right ? 'right' : 'left' }, column === 'price' && styles.priceCell]}
          translate={column === 'weighted' || (column === 'station' && station === 'none')} numberOfLines={2}>{cells[column]}</Text>;
      })}
        <View style={[styles.dishActions, { width: 100 }]}>
          <FastPressable disabled={!editable} onPress={onEdit} hitSlop={6} style={[styles.iconBtn, !editable && { opacity: 0.4 }]}>
            <PwaIcon name="pencil" size={16} color={colors.textMuted} strokeWidth={2} />
          </FastPressable>
          <FastPressable disabled={!editable} onPress={onDelete} hitSlop={6} style={[styles.iconBtn, !editable && { opacity: 0.4 }]}>
            <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
          </FastPressable>
        </View>
    </View>
  );
}

/* ---------- Модалка блюда ---------- */

interface VariantDraft {
  uid: string;
  id?: string;
  name: string;
  price: string;
  unit: string;
}
interface SetCompDraft {
  uid: string;
  dishId: string;
  dishVariantId?: string;
  name: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
}
function variantDraft(v?: AdminDishVariant): VariantDraft {
  return {
    uid: v?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    id: v?.id,
    name: v?.name ?? '',
    price: v ? String(Number(v.price)) : '',
    unit: normalizeUnitLabel(v?.unit),
  };
}

type DishModalProps = {
  dish: AdminDish | null;
  categories: AdminCategory[];
  defaultCategoryId: string;
  onClose: () => void;
  catalogKind?: 'goods' | 'recipe';
};

export function DishModal(props: DishModalProps) {
  const [generation, setGeneration] = useState(0);
  const query = useMenuEntry(props.dish?.id);
  if (props.dish && !query.data) return <WarehouseWorkspace title="Позиция меню" onClose={props.onClose} pending={query.isPending}>
    {query.isError ? <View style={styles.center}><Text style={styles.error}>{apiError(query.error)}</Text>
      <Button title="Повторить" variant="secondary" onPress={() => void query.refetch()} /></View> : null}
  </WarehouseWorkspace>;
  return <DishForm key={props.dish?.id ?? generation} {...props} entry={query.data} onSaveAnother={() => setGeneration((current) => current + 1)} />;
}

function DishForm({
  categories,
  defaultCategoryId,
  onClose,
  catalogKind = 'recipe',
  entry,
  onSaveAnother,
}: Omit<DishModalProps, 'dish'> & { entry?: MenuEntry; onSaveAnother: () => void }) {
  const [snapshot] = useState(entry);
  const dish = snapshot?.dish ?? null;
  const isEdit = !!dish;
  const isGoods = (dish ? menuKind(dish) : catalogKind) === 'goods';
  const { canAction } = usePermissions();
  const editable = canAction('editMenu');
  const canEditRecipe = editable && !isGoods && canAction('warehouseRecipes');
  const weightedLocked = !!dish && isGoods && (!!dish.stockIngredientId || dish.variants.some(variant => !!variant.stockIngredientId));
  const requestKey = React.useRef(`native-menu-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const { stations } = usePrepStations();
  const saveEntry = useSaveMenuEntry();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(dish?.name ?? '');
  const [categoryId, setCategoryId] = useState(dish?.categoryId ?? defaultCategoryId);
  const [tax, setTax] = useState(() => dishTaxValue(dish));
  const [price, setPrice] = useState(() => initialDishPrice(dish));
  const [unit, setUnit] = useState(normalizeUnitLabel(dish?.unit));
  const [description, setDescription] = useState(dish?.description ?? '');
  const [voiceName, setVoiceName] = useState(dish?.voiceName ?? '');
  const [isAvailable, setIsAvailable] = useState(dish?.isAvailable ?? true);
  const [isWeighted, setIsWeighted] = useState(dish?.isWeighted ?? false);
  const [weightedMeasure, setWeightedMeasure] = useState<'weight' | 'volume'>(dish?.weightedMeasure ?? 'weight');
  const [weightedPriceBase, setWeightedPriceBase] = useState(dish?.weightedPriceBase ?? 100);
  const [prepStation, setPrepStation] = useState<PrepStation>(dish?.prepStation ?? '');
  const [variants, setVariants] = useState<VariantDraft[]>(() => dish?.variants.map(variantDraft) ?? []);
  const [tab, setTab] = useState<'main' | 'recipe'>('main');
  const [recipe, setRecipe] = useState(() => initialDishRecipe(snapshot?.recipe.items ?? [], snapshot?.recipe.metadata));
  const [originalRecipe] = useState(recipe);
  const [photoUrl, setPhotoUrl] = useState(dish?.imageUrl?.startsWith('http') ? dish.imageUrl : '');
  const [photoPayload, setPhotoPayload] = useState<string | undefined>(undefined);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = saveEntry.isPending;
  const saving = React.useRef(false);
  const recipeChanged = recipe !== originalRecipe && JSON.stringify(recipe) !== JSON.stringify(originalRecipe);
  const signature = JSON.stringify({ name, categoryId, tax, price, unit, description, voiceName, isAvailable, isWeighted, weightedMeasure, weightedPriceBase, prepStation, variants, photoUrl, photoPayload, recipeChanged });
  const initialSignature = React.useRef(signature);
  const confirmLeave = (leave: () => void) => {
    if (pending || saving.current) return;
    if (signature === initialSignature.current) leave();
    else Alert.alert('Есть несохранённые изменения', 'Выйти без сохранения?', [{ text: 'Продолжить', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: leave }]);
  };

  const initialPreview = resolveApiImage(dish?.imageUrl ?? null);
  const preview = photoPayload !== undefined ? photoPayload || null : photoUrl.trim() ? photoUrl.trim() : initialPreview;
  async function pickPhoto() {
    setPhotoLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/png', 'image/jpeg', 'image/webp'], copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(file.uri, (width, height) => resolve({ width, height }), reject));
      const scale = Math.min(1, 900 / Math.max(dimensions.width, dimensions.height));
      const photo = await manipulateAsync(file.uri, [{ resize: { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) } }], { compress: 0.82, format: SaveFormat.JPEG, base64: true });
      if (!photo.base64) throw new Error('Не удалось обработать фото');
      setPhotoPayload(`data:image/jpeg;base64,${photo.base64}`); setPhotoUrl('');
    } catch (error) { setError(apiError(error)); }
    finally { setPhotoLoading(false); }
  }

  const updateVariant = (uid: string, patch: Partial<VariantDraft>) =>
    setVariants((cur) => cur.map((v) => (v.uid === uid ? { ...v, ...patch } : v)));
  const moveVariant = (from: number, dir: -1 | 1) =>
    setVariants((cur) => {
      const to = from + dir;
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });

  const onSubmit = async (createAnother = false) => {
    if (pending || saving.current || photoLoading || !editable) return;
    function invalidMain(message: string) {
      setTab('main');
      setError(message);
    }
    setError('');
    if (!name.trim() || !categoryId) {
      invalidMain('Заполните название и категорию');
      return;
    }
    const filled = variants
      .map((v) => ({ id: v.id, uid: v.uid, name: v.name.trim(), price: v.price.trim(), unit: v.unit }))
      .filter((v) => v.name || v.price);
    for (const v of filled) {
      const p = Number(v.price.replace(',', '.'));
      if (!v.name || !v.price || !Number.isFinite(p) || p <= 0) {
        invalidMain('У каждого варианта должны быть название и цена больше 0');
        return;
      }
    }
    const priceValue = price.trim() ? Number(price.replace(',', '.')) : undefined;
    if (priceValue !== undefined && (!Number.isFinite(priceValue) || priceValue < 0)) {
      invalidMain('Цена блюда должна быть числом');
      return;
    }
    if ((filled.length === 0 || isWeighted) && priceValue === undefined) {
      invalidMain('Укажите цену блюда или добавьте варианты с ценами');
      return;
    }
    const trimmedUrl = photoUrl.trim();
    let imageUrl: string | undefined = photoPayload;
    if (trimmedUrl) {
      if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
        invalidMain('Ссылка на фото должна начинаться с https://');
        return;
      }
      if (trimmedUrl !== (dish?.imageUrl ?? '')) imageUrl = trimmedUrl;
    }
    const variantIds = filled.map((v) => v.id ?? v.uid);
    let recipeInput: MenuRecipeInput | undefined;
    if (canEditRecipe && (recipeChanged || hasRemovedVariantAmounts(recipe, variantIds))) {
      const result = dishRecipePayload(recipe, variantIds);
      if ('error' in result) {
        setTab('recipe');
        setError(result.error);
        return;
      }
      recipeInput = result.payload;
    }
    saving.current = true;
    try {
      const variantsPayload = dishVariantPayload({ unit, variants: filled }).variants;
      const body = {
        name: name.trim(),
        categoryId,
        ...(tax !== dishTaxValue(dish) ? dishTaxInput(tax) : {}),
        price: priceValue,
        description: description.trim() || undefined,
        voiceName: voiceName.trim() || null,
        isAvailable,
        isWeighted,
        weightedMeasure,
        weightedPriceBase,
        imageUrl,
        prepStation: prepStation === '' ? null : prepStation,
        unit,
        variants: variantsPayload.map((variant, index) => ({ ...variant, clientKey: filled[index].uid })),
      };
      await saveEntry.mutateAsync({ id: dish?.id, catalogKind: isGoods ? 'goods' : 'recipe', requestKey: requestKey.current, expectedVersion: snapshot?.recipe.version, dish: body, recipe: recipeInput });
      push({ message: isGoods ? 'Товар сохранён' : 'Техкарта сохранена', at: new Date().toISOString() });
      if (createAnother) onSaveAnother();
      else onClose();
    } catch (err) {
      setError(apiError(err));
    } finally {
      saving.current = false;
    }
  };

  return (
    <WarehouseWorkspace
      onClose={() => confirmLeave(onClose)}
      title={isGoods ? (isEdit ? 'Редактирование товара' : 'Добавление товара') : (isEdit ? 'Редактирование техкарты' : 'Добавление техкарты')}
      footer={editable ? <View style={styles.filterRow}>
        <Button title="Сохранить" disabled={photoLoading} loading={pending} onPress={() => void onSubmit()} />
        {!isEdit ? <Button title="Сохранить и создать ещё" variant="secondary" disabled={photoLoading || pending}
          onPress={() => void onSubmit(true)} /> : null}
      </View> : undefined}
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, padding: spacing.md }}>
        {canEditRecipe && <View style={styles.grid2}>
          <Button title="Основное" size="md" variant={tab === 'main' ? 'primary' : 'secondary'} onPress={() => setTab('main')} />
          <Button title="Состав" size="md" variant={tab === 'recipe' ? 'primary' : 'secondary'} onPress={() => setTab('recipe')} />
        </View>}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {tab === 'recipe' && canEditRecipe ? <DishRecipeFields draft={recipe} onChange={setRecipe} disabled={pending}
          variants={variants.filter((variant) => variant.name.trim()).map((variant) => ({ id: variant.id ?? variant.uid, name: variant.name.trim() }))} /> : <>
        <Field label="Название">
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Название блюда" placeholderTextColor={colors.textLight} />
        </Field>
        <Field label="Категория">
          <AnchoredSelectScope>
            <Select value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name, translate: false }))}
              title="Категория" placeholder="Выберите категорию" searchable disabled={!editable || pending} />
          </AnchoredSelectScope>
        </Field>
        <Field label="Направление">
          <Select value={prepStation} onChange={setPrepStation} options={[{ value: '', label: 'Из категории' }, ...prepStationOptions(stations, prepStation)]} title="Направление" />
        </Field>
        <Field label="Налог">
          <MenuTaxSelect value={tax} onChange={setTax} inherit categoryTaxId={categories.find(({ id }) => id === categoryId)?.taxId}
            disabled={!editable || pending} />
        </Field>
        <Field label="Цена">
          <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textLight} />
        </Field>

        <View style={styles.coverRow}>
          <View style={styles.cover}>
            <Text style={styles.fieldLabel} translate>Обложка</Text>
            {preview ? <Image source={{ uri: preview }} style={styles.photoPreview} resizeMode="contain" />
              : <View style={styles.coverPlaceholder}><PwaIcon name="menu" size={26} color={colors.textLight} /></View>}
            <Button title="Загрузить фото" variant="secondary" size="md" loading={photoLoading} disabled={!editable}
              onPress={() => void pickPhoto()} />
            {preview ? <Button title="Удалить фото" variant="secondary" size="md" disabled={!editable}
              onPress={() => { setPhotoPayload(''); setPhotoUrl(''); }} /> : null}
          </View>
          <View style={styles.coverOptions}>
            <View style={styles.switchEntry}>
              <Text style={[styles.checkLabel, { flex: 1 }]} translate>Доступно для заказа</Text>
              <Toggle accessibilityLabel="Доступно для заказа" checked={isAvailable} onChange={setIsAvailable} disabled={!editable} />
            </View>
            <View style={styles.switchEntry}>
              <Text style={[styles.checkLabel, { flex: 1 }]} translate>{isGoods ? 'Весовой товар' : 'Весовое блюдо'}</Text>
              <Toggle accessibilityLabel={isGoods ? 'Весовой товар' : 'Весовое блюдо'} checked={isWeighted}
                onChange={setIsWeighted} disabled={!editable || weightedLocked} />
            </View>
          </View>
        </View>
        <Field label="Фото по ссылке">
          <TextInput style={styles.input} value={photoUrl} onChangeText={(value) => { setPhotoUrl(value); setPhotoPayload(undefined); }}
            placeholder="https://…" placeholderTextColor={colors.textLight} autoCapitalize="none" editable={editable} />
        </Field>
        {isWeighted ? (
          <View style={styles.weightedBox}>
            <Text style={styles.weightedTitle} translate>Параметры весового блюда</Text>
            <View style={styles.grid2}>
              <Field label="Единица" style={{ flex: 1 }}>
                <Select
                  value={weightedMeasure}
                  disabled={weightedLocked}
                  onChange={(value) => setWeightedMeasure(value as 'weight' | 'volume')}
                  options={[{ value: 'weight', label: 'г / кг' }, { value: 'volume', label: 'мл / л' }]}
                  title="Единица"
                />
              </Field>
              <Field label="Цена за" style={{ flex: 1 }}>
                <Select
                  value={String(weightedPriceBase)}
                  onChange={(value) => setWeightedPriceBase(Number(value))}
                  options={[1, 100, 1000].map((base) => ({ value: String(base), label: weightedBaseLabel({ weightedMeasure, weightedPriceBase: base }) }))}
                  title="Цена за"
                />
              </Field>
            </View>
            <Text style={styles.weightedHint} translate>Покупатель задаёт точное количество; стоимость пересчитывается автоматически.</Text>
          </View>
        ) : null}

        {variants.length === 0 && !isWeighted && <Field label="Единица продажи"><Select value={unit} disabled={weightedLocked} onChange={setUnit} options={unitLabelOptions(unit)} title="Единица продажи" /></Field>}
        {isGoods && <Text style={styles.checkHint} translate>Остаток товара изменяется через поставки, списания и инвентаризации.</Text>}
        {weightedLocked && <Text style={styles.checkHint} translate>Единица и весовой режим связаны со складским учётом.</Text>}

        {/* Варианты */}
        <View>
          <View style={styles.varHead}>
            <Text style={styles.fieldLabel} translate>Варианты</Text>
            <FastPressable onPress={() => setVariants((c) => [...c, variantDraft()])} hitSlop={6}>
              <Text style={styles.addVarText} translate>+ Добавить</Text>
            </FastPressable>
          </View>
          {variants.map((v, i) => (
            <View key={v.uid} style={styles.varRow}>
              <View style={styles.varMove}>
                <FastPressable onPress={() => moveVariant(i, -1)} hitSlop={4} disabled={i === 0}>
                  <View style={{ transform: [{ rotate: '180deg' }], opacity: i === 0 ? 0.3 : 1 }}>
                    <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
                  </View>
                </FastPressable>
                <FastPressable onPress={() => moveVariant(i, 1)} hitSlop={4} disabled={i === variants.length - 1}>
                  <View style={{ opacity: i === variants.length - 1 ? 0.3 : 1 }}>
                    <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
                  </View>
                </FastPressable>
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <TextInput style={styles.inputSm} value={v.name} onChangeText={(t) => updateVariant(v.uid, { name: t })} placeholder="Вариант" placeholderTextColor={colors.textLight} />
                <View style={styles.grid2}>
                  <TextInput style={[styles.inputSm, { flex: 1 }]} value={v.price} onChangeText={(t) => updateVariant(v.uid, { price: t })} keyboardType="decimal-pad" placeholder="Цена" placeholderTextColor={colors.textLight} />
                  <View style={{ width: 90 }}>
                    <Select value={v.unit} onChange={(u) => updateVariant(v.uid, { unit: u })} options={unitLabelOptions(v.unit)} title="Ед." />
                  </View>
                </View>
              </View>
              <FastPressable onPress={() => setVariants((c) => c.filter((x) => x.uid !== v.uid))} hitSlop={6} style={styles.iconBtn}>
                <PwaIcon name="trash" size={15} color={colors.danger} strokeWidth={2} />
              </FastPressable>
            </View>
          ))}
        </View>

        <Field label="Описание">
          <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder="Необязательно" placeholderTextColor={colors.textLight} multiline maxLength={300} />
        </Field>
        <Field label="Название для озвучки">
          <TextInput style={styles.input} value={voiceName} onChangeText={setVoiceName} placeholder="Необязательно" placeholderTextColor={colors.textLight} />
        </Field>
        </>}
      </ScrollView>
    </WarehouseWorkspace>
  );
}

function SetModal({ set, onClose }: { set: AdminDish | null; onClose: () => void }) {
  const isEdit = !!set;
  const { create, update } = useSetMutations();
  const { stations } = usePrepStations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(set?.name ?? '');
  const [tax, setTax] = useState(() => dishTaxValue(set));
  const [price, setPrice] = useState(set ? String(Number(set.price)) : '');
  const [prepStation, setPrepStation] = useState<PrepStation>(set?.prepStation ?? '');
  const [components, setComponents] = useState<SetCompDraft[]>(() =>
    (set?.setComponents ?? [])
      .map((component): SetCompDraft | null => {
        const dish = component.dish ?? component.dishVariant?.dish;
        if (!dish) return null;
        return {
          uid: component.id,
          dishId: dish.id,
          name: component.dishVariant ? `${dish.name} ${component.dishVariant.name}` : dish.name,
          quantity: component.quantity,
          removable: component.removable,
          replaceable: component.replaceable,
          ...(component.dishVariant?.id ? { dishVariantId: component.dishVariant.id } : {}),
        };
      })
      .filter((component): component is SetCompDraft => component !== null),
  );
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const dishesQ = useAdminDishes('', search.trim());
  const pending = create.isPending || update.isPending;

  type Candidate = { dishId: string; dishVariantId?: string; name: string };
  const candidates: Candidate[] = (dishesQ.data ?? [])
    .filter((dish) => !dish.isSet && dish.isActive)
    .flatMap((dish): Candidate[] =>
      dish.variants.length > 0
        ? dish.variants.map((variant) => ({
            dishId: dish.id,
            dishVariantId: variant.id,
            name: `${dish.name} ${variant.name}`,
          }))
        : [{ dishId: dish.id, name: dish.name }],
    )
    .filter(
      (candidate) =>
        !components.some(
          (component) =>
            component.dishId === candidate.dishId && component.dishVariantId === candidate.dishVariantId,
        ),
    );

  const addComp = (candidate: Candidate) =>
    setComponents((current) => [
      ...current,
      {
        uid: `tmp-${candidate.dishId}-${candidate.dishVariantId ?? ''}-${Date.now()}`,
        dishId: candidate.dishId,
        dishVariantId: candidate.dishVariantId,
        name: candidate.name,
        quantity: 1,
        removable: true,
        replaceable: true,
      },
    ]);

  const patchComp = (uid: string, patch: Partial<SetCompDraft>) =>
    setComponents((current) => current.map((component) => (component.uid === uid ? { ...component, ...patch } : component)));

  const submit = async () => {
    setError('');
    const priceNum = Number(price.replace(',', '.'));
    if (!name.trim()) {
      setError('Укажите название сета');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError('Цена сета должна быть больше 0');
      return;
    }
    if (components.length === 0) {
      setError('Добавьте блюда в состав сета');
      return;
    }
    const body = {
      name: name.trim(),
      price: priceNum,
      ...(tax !== dishTaxValue(set) ? dishTaxInput(tax) : {}),
      prepStation: prepStation || null,
      components: components.map((component) => ({
        dishId: component.dishId,
        dishVariantId: component.dishVariantId,
        quantity: Math.max(1, component.quantity),
        removable: component.removable,
        replaceable: component.replaceable,
      })),
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: set!.id, ...body });
        push({ message: 'Сет обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Сет создан', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={isEdit ? 'Изменить сет' : 'Новый сет'}
      maxHeight="92%"
      footer={<Button title={isEdit ? 'Сохранить' : 'Создать сет'} size="lg" loading={pending} onPress={submit} />}
    >
      <SheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}>
        <View style={styles.grid2}>
          <Field label="Название" style={{ flex: 1 }}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Сет-6"
              placeholderTextColor={colors.textLight}
            />
          </Field>
          <Field label="Цена" style={{ width: 116 }}>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textLight}
            />
          </Field>
        </View>

        <Field label="Направление">
          <Select value={prepStation} onChange={setPrepStation}
            options={[{ value: '', label: 'Из категории' }, ...prepStationOptions(stations, prepStation)]} title="Направление" />
        </Field>

        <Field label="Налог">
          <MenuTaxSelect value={tax} onChange={setTax} inherit categoryTaxId={set?.category.taxId} disabled={pending} />
        </Field>
        <View>
          <Text style={styles.setSectionTitle} translate>Состав сета</Text>
          {components.length === 0 ? (
            <Text style={styles.setEmptyBox} translate>Добавьте блюда из списка ниже</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {components.map((component) => (
                <View key={component.uid} style={styles.setCompRow}>
                  <View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}>
                    <Text style={styles.setCompName} numberOfLines={1}>
                      {component.name}
                    </Text>
                    <View style={styles.setCompControls}>
                      <View style={styles.qtyControl}>
                        <FastPressable
                          onPress={() => patchComp(component.uid, { quantity: Math.max(1, component.quantity - 1) })}
                          hitSlop={6}
                          style={styles.qtyBtn}
                        >
                          <PwaIcon name="minus" size={14} color={colors.textSecondary} strokeWidth={2} />
                        </FastPressable>
                        <Text style={styles.qtyValue}>{component.quantity}</Text>
                        <FastPressable
                          onPress={() => patchComp(component.uid, { quantity: component.quantity + 1 })}
                          hitSlop={6}
                          style={styles.qtyBtn}
                        >
                          <PwaIcon name="plus" size={14} color={colors.textSecondary} strokeWidth={2} />
                        </FastPressable>
                      </View>
                      <View style={styles.setFlags}>
                        <View style={styles.setFlag}>
                          <Text style={styles.setFlagLabel} translate>убирать</Text>
                          <Toggle
                            checked={component.removable}
                            onChange={(removable) => patchComp(component.uid, { removable })}
                          />
                        </View>
                        <View style={styles.setFlag}>
                          <Text style={styles.setFlagLabel} translate>заменять</Text>
                          <Toggle
                            checked={component.replaceable}
                            onChange={(replaceable) => patchComp(component.uid, { replaceable })}
                          />
                        </View>
                      </View>
                    </View>
                  </View>
                  <FastPressable
                    onPress={() => setComponents((current) => current.filter((item) => item.uid !== component.uid))}
                    hitSlop={6}
                    style={styles.iconBtn}
                  >
                    <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
                  </FastPressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View>
          <Text style={styles.setSectionTitle} translate>Добавить блюдо</Text>
          <TextInput
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск блюда"
            placeholderTextColor={colors.textLight}
          />
          <View style={styles.candidateList}>
            {candidates.map((candidate) => (
              <FastPressable
                key={`${candidate.dishId}-${candidate.dishVariantId ?? ''}`}
                onPress={() => addComp(candidate)}
                style={styles.candidateRow}
              >
                <Text style={styles.candidateName} numberOfLines={1}>
                  {candidate.name}
                </Text>
                <PwaIcon name="plus" size={16} color={colors.primary} strokeWidth={2.4} />
              </FastPressable>
            ))}
            {!dishesQ.isLoading && candidates.length === 0 ? <Text style={styles.emptySmall} translate>Блюда не найдены</Text> : null}
            {dishesQ.isLoading ? (
              <View style={styles.loadingSmall}>
                <AdminLoadingSkeleton />
              </View>
            ) : null}
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

/* ---------- Категории ---------- */

function CategoryDirectory({ categories }: { categories: AdminCategory[] }) {
  const { canAction } = usePermissions();
  const { reorder } = useCategoryMutations();
  const { stations } = usePrepStations();
  const push = useNotifications((state) => state.push);
  const t = useT();
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<AdminCategory | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ category: AdminCategory; play?: () => void } | null>(null);
  const particles = useDeletionParticles();
  const editable = canAction('editMenu');
  const needle = search.trim().toLocaleLowerCase('ru');
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows = sorted.filter(({ name }) => name.toLocaleLowerCase('ru').includes(needle));

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (!editable || reorder.isPending || needle || next < 0 || next >= sorted.length) return;
    const ids = sorted.map(({ id }) => id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void reorder.mutateAsync(ids).catch((error) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() }));
  }

  return <View style={styles.particleFrame}>
    <SheetScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
      <View style={styles.menuCard}>
        <View style={styles.headerWrap}>
          <View style={styles.directoryToolbar}>
            <InputField containerStyle={styles.directorySearch} value={search} onChangeText={setSearch}
              accessibilityLabel={t('Поиск категории')} placeholder={t('Быстрый поиск')} />
            {editable && <Button title="Добавить" size="md" onPress={() => setEditor('new')} />}
          </View>
        </View>
        <View style={styles.directoryRow}><Text style={styles.checkHint} translate>Название</Text></View>
        {rows.map((category, index) => {
          const stationId = category.prepStation ?? 'kitchen';
          const station = stations.find(({ id }) => id === stationId);
          const stationLabel = station ? (station.isBuiltIn ? t(station.name) : station.name)
            : stationId === 'none' ? t('Без отправки') : '—';

          return <View key={category.id} ref={(row) => particles.register(category.id, row)} collapsable={false} style={styles.directoryRow}>
            {editable && !needle && <View style={styles.varMove}>
              <FastPressable accessibilityRole="button" accessibilityLabel={t('Поднять категорию')}
                disabled={index === 0 || reorder.isPending} onPress={() => move(index, -1)} hitSlop={4}>
                <View style={{ transform: [{ rotate: '180deg' }], opacity: index === 0 ? 0.3 : 1 }}>
                  <PwaIcon name="chevronDown" size={15} color={colors.textMuted} strokeWidth={2} />
                </View>
              </FastPressable>
              <FastPressable accessibilityRole="button" accessibilityLabel={t('Опустить категорию')}
                disabled={index === sorted.length - 1 || reorder.isPending} onPress={() => move(index, 1)} hitSlop={4}>
                <View style={{ opacity: index === sorted.length - 1 ? 0.3 : 1 }}>
                  <PwaIcon name="chevronDown" size={15} color={colors.textMuted} strokeWidth={2} />
                </View>
              </FastPressable>
            </View>}
            <View style={styles.directoryName}>
              <Text style={styles.catName}>{category.name}</Text>
              <Text style={styles.checkHint}>{stationLabel} · {t('Позиций')}: {category._count.dishes}</Text>
            </View>
            {editable && <>
              <FastPressable accessibilityRole="button" accessibilityLabel={t('Редактировать категорию') + ' ' + category.name}
                onPress={() => setEditor(category)} style={styles.directoryAction}>
                <Text style={styles.directoryLink} translate>Ред.</Text>
              </FastPressable>
              <FastPressable accessibilityRole="button" accessibilityLabel={t('Удалить категорию') + ' ' + category.name}
                onPress={() => setDeleteTarget({ category, play: particles.capture(category.id) })} style={styles.iconBtn} hitSlop={6}>
                <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
              </FastPressable>
            </>}
          </View>;
        })}
        {!rows.length && <Text style={styles.emptySmall} translate>{needle ? 'Категории не найдены' : 'Категорий пока нет'}</Text>}
      </View>
    </SheetScrollView>
    {editable && editor && <CategoryEditor category={editor === 'new' ? undefined : editor} categoryCount={sorted.length}
      position={editor === 'new' ? 1 : sorted.findIndex(({ id }) => editor.id === id) + 1} onClose={() => setEditor(null)} />}
    {editable && deleteTarget && <DeleteCategorySheet category={deleteTarget.category} categories={sorted} onRemoved={deleteTarget.play} onDone={() => setDeleteTarget(null)} />}
    {particles.overlay}
  </View>;
}

function CategoryEditor({ category, categoryCount, position, onClose }: { category?: AdminCategory; categoryCount: number; position: number; onClose: () => void }) {
  const { create, update } = useCategoryMutations();
  const { stations } = usePrepStations();
  const push = useNotifications((state) => state.push);
  const t = useT();
  const [name, setName] = useState(category?.name ?? '');
  const [tax, setTax] = useState(category?.taxId ?? '');
  const [initialPosition] = useState(position);
  const [newPosition, setNewPosition] = useState(String(position));
  const [station, setStation] = useState<PrepStation | undefined>(category ? category.prepStation ?? 'kitchen' : undefined);
  const [error, setError] = useState('');
  const busy = create.isPending || update.isPending;
  const prepStation = station ?? stations.find(({ isActive }) => isActive)?.id ?? 'none';

  async function save() {
    const normalized = name.trim();
    if (busy || !normalized) return;
    const nextPosition = Number(newPosition);
    if (category && (!Number.isInteger(nextPosition) || nextPosition < 1 || nextPosition > categoryCount)) {
      setError('Укажите позицию от 1 до ' + categoryCount);
      return;
    }
    const taxChange = tax !== (category?.taxId ?? '') ? { taxId: tax || null } : {};
    setError('');
    try {
      if (category) {
        const hasNewName = normalized !== category.name;
        const hasNewStation = prepStation !== (category.prepStation ?? 'kitchen');
        if (hasNewName || hasNewStation || 'taxId' in taxChange || nextPosition !== initialPosition) {
          await update.mutateAsync({
            id: category.id,
            ...(hasNewName ? { name: normalized } : {}),
            ...(hasNewStation ? { prepStation } : {}),
            ...taxChange,
            ...(nextPosition !== initialPosition ? { position: nextPosition } : {}),
          });
          push({ message: 'Категория сохранена', at: new Date().toISOString() });
        }
      } else {
        await create.mutateAsync({ name: normalized, prepStation, ...taxChange });
        push({ message: 'Категория добавлена', at: new Date().toISOString() });
      }
      onClose();
    } catch (cause) {
      setError(apiError(cause));
    }
  }

  const fields = <View style={styles.categoryFields}>
    <InputField label="Название" accessibilityLabel={t('Название категории')} maxLength={60}
      value={name} onChangeText={setName} editable={!busy} />
    <Field label="Цех">
      <AnchoredSelectScope><Select value={prepStation} onChange={setStation} options={prepStationOptions(stations, prepStation)}
        title="Цех" disabled={busy} /></AnchoredSelectScope>
    </Field>
    <Field label="Налог"><MenuTaxSelect value={tax} onChange={setTax} disabled={busy} /></Field>
    {category ? <Field label={'Позиция в списке · из ' + categoryCount}>
      <TextInput style={styles.input} value={newPosition} onChangeText={setNewPosition} editable={!busy}
        accessibilityLabel="Позиция в списке" keyboardType="number-pad" />
    </Field> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
  const footer = <Button title="Сохранить" disabled={!name.trim()} loading={busy} onPress={() => void save()} />;
  return category ? <BottomSheet visible title="Редактирование категории" onClose={onClose} footer={footer}>{fields}</BottomSheet>
    : <WarehouseWorkspace title="Новая категория" onClose={() => { if (!busy) onClose(); }} footer={footer}>
        <SheetScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">{fields}</SheetScrollView>
      </WarehouseWorkspace>;
}

function DeleteCategorySheet({ category, categories, onRemoved, onDone }: {
  category: AdminCategory;
  categories: AdminCategory[];
  onRemoved?: () => void;
  onDone: () => void;
}) {
  const { remove } = useCategoryMutations();
  const push = useNotifications((state) => state.push);
  const others = categories.filter(({ id }) => id !== category.id);
  const [strategy, setStrategy] = useState<'move' | 'delete'>();
  const [targetId, setTargetId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const hasDishes = category._count.dishes > 0;
  const canDelete = confirmation.trim() === category.name.trim()
    && (!hasDishes || strategy === 'delete' || (strategy === 'move' && !!targetId));

  async function run() {
    if (!canDelete || remove.isPending) return;
    setError('');
    try {
      await remove.mutateAsync({ id: category.id, strategy, targetCategoryId: strategy === 'move' ? targetId : undefined });
      push({ message: 'Категория удалена', at: new Date().toISOString() });
      onDone();
      onRemoved?.();
    } catch (failure) {
      setError(apiError(failure));
    }
  }

  return <BottomSheet visible onClose={onDone} title="Удалить категорию" footer={<View style={styles.filterRow}>
    <Button title="Отмена" variant="secondary" disabled={remove.isPending} onPress={onDone} />
    <Button title={strategy === 'move' ? 'Перенести и удалить' : 'Удалить'} variant="danger" disabled={!canDelete}
      loading={remove.isPending} onPress={() => void run()} />
  </View>}>
    <View style={styles.categoryFields}>
      <Text style={styles.fieldLabel}>«{category.name}»</Text>
      {hasDishes ? <>
        <Text style={styles.hint} translate>Позиций в категории: {category._count.dishes}. История заказов и чеки сохранятся.</Text>
        <View accessibilityRole="radiogroup">
          {others.length > 0 ? <FastPressable style={styles.checkRow} accessibilityRole="radio"
            accessibilityState={{ checked: strategy === 'move' }} onPress={() => setStrategy('move')}>
            <Text style={styles.checkLabel} translate>Перенести в другую категорию</Text>
            <PwaIcon name={strategy === 'move' ? 'check' : 'chevronRight'} size={18} color={strategy === 'move' ? colors.primary : colors.textLight} />
          </FastPressable> : null}
          {strategy === 'move' ? <AnchoredSelectScope><Select value={targetId} onChange={setTargetId} searchable
            title="Категория для переноса" placeholder="Выберите категорию"
            options={others.map(({ id, name }) => ({ value: id, label: name, translate: false }))} /></AnchoredSelectScope> : null}
          <FastPressable style={styles.checkRow} accessibilityRole="radio" accessibilityState={{ checked: strategy === 'delete' }} onPress={() => setStrategy('delete')}>
            <Text style={styles.checkLabel} translate>Удалить все позиции вместе с категорией</Text>
            <PwaIcon name={strategy === 'delete' ? 'check' : 'chevronRight'} size={18} color={strategy === 'delete' ? colors.primary : colors.textLight} />
          </FastPressable>
        </View>
      </> : null}
      <InputField label="Введите название категории для подтверждения" value={confirmation} onChangeText={setConfirmation}
        editable={!remove.isPending} autoCapitalize="none" />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  </BottomSheet>;
}

function CatTab({ active, onPress, label }: { active: boolean; onPress: () => void; label: string }) {
  return (
    <FastPressable onPress={onPress} style={[styles.catTab, active && styles.catTabActive]}>
      <Text style={[styles.catTabText, active && styles.catTabTextActive]} translate>{label}</Text>
    </FastPressable>
  );
}
function MiniBadge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[styles.miniBadge, { backgroundColor: bg }]}>
      <Text style={[styles.miniBadgeText, { color: fg }]} translate>{label}</Text>
    </View>
  );
}
function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={style}>
      <Text style={styles.fieldLabel} translate>{label}</Text>
      {children}
    </View>
  );
}
function Sum({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.sumText} translate>
      {label}: <Text style={styles.sumValue}>{value}</Text>
    </Text>
  );
}
function Sep() {
  return <Text style={styles.sumSep}>|</Text>;
}

const styles = StyleSheet.create({
  particleFrame: { flex: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: 12 },
  menuCard: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' },
  headerWrap: { gap: 12, padding: 16, borderBottomWidth: 1, borderColor: colors.border },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  sumText: { fontSize: fontSize.sm, color: colors.textSecondary },
  sumValue: { fontWeight: '500', color: colors.textPrimary },
  sumSep: { fontSize: fontSize.sm, color: colors.textLight },
  search: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  headerBtns: { flexDirection: 'row', gap: spacing.sm },
  tabs: { gap: 6, paddingVertical: 4 },
  catTab: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  catTabActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  catTabText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  catTabTextActive: { color: colors.white },

  center: { paddingVertical: 60, alignItems: 'center' },
  empty: { paddingVertical: 60, textAlign: 'center', color: colors.textMuted },

  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border },
  tableHeading: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 12, fontWeight: '500', color: colors.textMuted },
  menuCell: { paddingHorizontal: 16, paddingVertical: 12 },
  menuCellText: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: colors.textSecondary },
  priceCell: { fontWeight: '500', color: colors.textPrimary, textAlign: 'right' },
  dishNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  dishName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, flexShrink: 1 },
  variantsLine: { marginTop: 2, fontSize: fontSize.xs, fontWeight: '500', color: colors.primary },
  dishDesc: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  dishMeta: { marginTop: 4, fontSize: fontSize.xs, color: colors.textSecondary },
  dishRight: { alignItems: 'flex-end', gap: 6 },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: fontSize.xs, lineHeight: 16, fontWeight: '500' },
  dishActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 16 },
  iconBtn: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  miniBadge: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  miniBadgeText: { fontSize: 11, fontWeight: '500' },

  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  inputSm: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  multiline: { height: 76, paddingTop: 10, textAlignVertical: 'top' },
  fieldLabel: { marginBottom: 6, fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  grid2: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  varHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  addVarText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  varRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm },
  varMove: { alignItems: 'center', justifyContent: 'center' },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cover: { width: '42%', maxWidth: 180, gap: spacing.sm },
  coverOptions: { flex: 1, minWidth: 0, gap: spacing.sm },
  coverPlaceholder: { height: 96, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  switchEntry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  photoPreview: { width: '100%', height: 96, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  checkHint: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  weightedBox: { gap: spacing.sm, borderWidth: 1, borderColor: colors.primarySoft, borderRadius: radius.md, backgroundColor: colors.primaryFaint, padding: spacing.md },
  weightedTitle: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  weightedHint: { fontSize: fontSize.xs, lineHeight: 16, color: colors.textMuted },
  error: { fontSize: fontSize.sm, color: colors.danger },

  setSectionTitle: { marginBottom: 6, fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  setEmptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  setCompRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    backgroundColor: colors.white,
  },
  setCompName: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  setCompControls: { gap: spacing.sm },
  qtyControl: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  qtyBtn: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  qtyValue: { minWidth: 34, textAlign: 'center', fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  setFlags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  setFlag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  setFlagLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  candidateList: { marginTop: spacing.sm, gap: spacing.sm, maxHeight: 260 },
  candidateRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
  candidateName: { flex: 1, minWidth: 0, fontSize: fontSize.sm, color: colors.textPrimary },
  emptySmall: { paddingVertical: spacing.md, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  loadingSmall: { paddingVertical: spacing.md, alignItems: 'center' },

  categoryFields: { gap: spacing.md },
  filterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  directoryToolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  directorySearch: { flex: 1, minWidth: 0 },
  directoryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  directoryName: { flex: 1, minWidth: 0, gap: 3 },
  catName: { fontSize: fontSize.base, color: colors.textPrimary },
  directoryAction: { minHeight: 36, paddingHorizontal: spacing.xs, justifyContent: 'center' },
  directoryLink: { color: colors.primary, fontSize: 14, fontWeight: '500' },
  hint: { fontSize: fontSize.sm, color: colors.textSecondary },
});
