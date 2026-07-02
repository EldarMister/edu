import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { FastPressable } from '@/components/FastPressable';
import { Button, EmptyState, Loading, PillTabs } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { FullscreenSheet } from '@/components/FullscreenSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, radius, spacing, waiterLayout } from '@/theme';
import { useAddItems, useCategories, useCreateOrder, useDishes, useEditOrder, useReplaceRejectedItem } from '@/services/api/waiter';
import { linePrice, useCart } from '@/store/cart';
import { useNotifications } from '@/store/notifications';
import { useReplacement } from '@/store/replacement';
import { buildSetLine, calcSetPrice, defaultSetComponents } from '@/utils/set';
import { dishUnitPrice, makeIdempotencyKey, minDishUnitPrice, money, variantNamesLine } from '@/utils/format';
import { cartStations } from '@/utils/prepStation';
import { apiError } from '@/lib/api';
import { useConnectionStatus } from '@/services/socket';
import { CartSheet } from './CartSheet';
import { TablePickerSheet } from './TablePickerSheet';
import type { CartLine, CartSetComponent, Category, Dish, DishVariant } from '@/types';

function currentDishQuantity(dishId: string): number {
  return useCart.getState().lines.reduce((sum, line) => sum + (line.dish.id === dishId ? line.quantity : 0), 0);
}

function currentVariantQuantity(variantId: string): number {
  return useCart.getState().lines.reduce((sum, line) => sum + (line.variant?.id === variantId ? line.quantity : 0), 0);
}

export function MenuScreen() {
  const navigation = useNavigation<any>();
  const connected = useConnectionStatus();

  const tableId = useCart((s) => s.tableId);
  const tableNumber = useCart((s) => s.tableNumber);
  const hallName = useCart((s) => s.hallName);
  const activeOrderId = useCart((s) => s.activeOrderId);
  const editingOrderId = useCart((s) => s.editingOrderId);
  const editingOrderNumber = useCart((s) => s.editingOrderNumber);
  const orderComment = useCart((s) => s.comment);
  const orderCommentOpen = useCart((s) => s.commentOpen);
  const cartLines = useCart((s) => s.lines);
  const addToCart = useCart((s) => s.add);
  const addLineToCart = useCart((s) => s.addLine);
  const setCartQuantity = useCart((s) => s.setQuantity);
  const clearCart = useCart((s) => s.clear);
  const cancelEditing = useCart((s) => s.cancelEditing);
  const cartCount = useCart((s) => s.lines.length);
  const cartTotal = useCart((s) => s.lines.reduce((sum, line) => sum + linePrice(line), 0));
  const push = useNotifications((s) => s.push);

  const categories = useCategories();
  const dishes = useDishes();
  const createOrder = useCreateOrder();
  const addItems = useAddItems();
  const editOrder = useEditOrder();
  const replaceRejected = useReplaceRejectedItem();
  const replacementTarget = useReplacement((s) => s.target);
  const clearReplacement = useReplacement((s) => s.clear);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [cartOpen, setCartOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [variantDish, setVariantDish] = useState<Dish | null>(null);
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [configSet, setConfigSet] = useState<Dish | null>(null);

  const sortedCategories = useMemo(
    () => (categories.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [categories.data],
  );
  const sets = useMemo(() => (dishes.data ?? []).filter((dish) => dish.isSet), [dishes.data]);
  const setsCategoryIds = useMemo(() => new Set(sets.map((set) => set.categoryId)), [sets]);
  const menuDishes = useMemo(() => (dishes.data ?? []).filter((dish) => !dish.isSet), [dishes.data]);

  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of cartLines) {
      map[l.dish.id] = (map[l.dish.id] ?? 0) + l.quantity;
      if (l.variant) map[l.variant.id] = (map[l.variant.id] ?? 0) + l.quantity;
    }
    return map;
  }, [cartLines]);

  const cartLineCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of cartLines) map[line.dish.id] = (map[line.dish.id] ?? 0) + 1;
    return map;
  }, [cartLines]);

  const filteredDishes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = menuDishes.filter((d) => {
      const byCat = categoryId === 'all' || d.categoryId === categoryId;
      const byQ = !q || d.name.toLowerCase().includes(q);
      return byCat && byQ;
    });
    return [...list.filter((d) => d.isAvailable), ...list.filter((d) => !d.isAvailable)];
  }, [menuDishes, categoryId, search]);

  const replaceWithLine = useCallback((line: CartLine) => {
    if (!replacementTarget) return;
    replaceRejected.mutate(
      {
        orderId: replacementTarget.orderId,
        itemId: replacementTarget.item.id,
        line,
      },
      {
        onSuccess: () => {
          const itemName = orderItemName(replacementTarget.item);
          clearReplacement();
          push({ message: `${itemName} заменено`, type: 'success', at: new Date().toISOString() });
          navigation.navigate('Orders', {
            screen: 'OrderDetail',
            params: { orderId: replacementTarget.orderId },
          });
        },
        onError: (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() }),
      },
    );
  }, [clearReplacement, navigation, push, replaceRejected, replacementTarget]);

  const onAddSet = useCallback((set: Dish, components: CartSetComponent[]) => {
    const line = buildSetLine(set, components);
    if (replacementTarget) {
      replaceWithLine(line);
      return;
    }
    addLineToCart(line);
    push({ message: `${set.name} добавлено`, at: new Date().toISOString(), durationMs: 1800 });
  }, [addLineToCart, push, replaceWithLine, replacementTarget]);

  const onAddDish = useCallback((dish: Dish) => {
    if (dish.isSet) {
      onAddSet(dish, defaultSetComponents(dish));
      return;
    }
    if (dish.variants && dish.variants.length > 0) {
      setVariantDish(dish);
      return;
    }
    if (dish.trackInventory) {
      const currentQty = currentDishQuantity(dish.id);
      if (typeof dish.stock === 'number' && currentQty >= dish.stock) {
        push({ message: `Недостаточно на складе. Остаток: ${dish.stock}`, type: 'error', at: new Date().toISOString() });
        return;
      }
    }
    if (replacementTarget) {
      replaceWithLine({ dish, quantity: 1 });
      return;
    }
    const nextQty = currentDishQuantity(dish.id) + 1;
    addToCart(dish);
    push({ message: `${dish.name} ×${nextQty} добавлено`, at: new Date().toISOString(), durationMs: 1800 });
  }, [addToCart, onAddSet, push, replaceWithLine, replacementTarget]);

  const onDecDish = useCallback((dish: Dish) => {
    const lines = useCart.getState().lines;
    const idx = lines.findIndex((l) => l.dish.id === dish.id && !l.set);
    if (idx >= 0) setCartQuantity(idx, lines[idx].quantity - 1);
  }, [setCartQuantity]);

  const renderDish = useCallback(({ item }: { item: Dish }) => (
    <DishCard
      dish={item}
      qty={cartQuantities[item.id] ?? 0}
      lineCount={cartLineCounts[item.id] ?? 0}
      disabled={!item.isAvailable}
      onAdd={onAddDish}
      onDec={onDecDish}
    />
  ), [cartLineCounts, cartQuantities, onAddDish, onDecDish]);

  const dishKey = useCallback((dish: Dish) => dish.id, []);

  if (!tableId) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <EmptyState text="Выберите стол на вкладке «Столы», чтобы открыть меню" />
      </SafeAreaView>
    );
  }

  const onSubmit = () => {
    if (!connected) {
      push({ message: 'Создание заказа недоступно без интернета.', type: 'error', at: new Date().toISOString() });
      return;
    }
    if (cartLines.length === 0) return;
    const idempotencyKey = makeIdempotencyKey();
    const done = (mode: 'create' | 'update', orderId?: string) => {
      clearCart();
      setCartOpen(false);
      if (mode === 'update' && orderId) {
        navigation.navigate('Orders', { screen: 'OrderDetail', params: { orderId } });
      } else {
        navigation.navigate('Orders');
      }
    };
    const onError = (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() });

    if (editingOrderId) {
      editOrder.mutate(
        { orderId: editingOrderId, comment: orderCommentOpen ? orderComment : '', lines: cartLines },
        {
          onSuccess: (updated) => {
            push({ message: 'Изменения сохранены', type: 'success', at: new Date().toISOString() });
            done('update', updated.id);
          },
          onError,
        },
      );
    } else if (activeOrderId) {
      addItems.mutate(
        { orderId: activeOrderId, idempotencyKey, lines: cartLines },
        {
          onSuccess: (updated) => {
            push({
              message: cartOnlyNone ? 'Позиции добавлены в заказ' : 'Заказ отправлен на кухню',
              type: 'success',
              at: new Date().toISOString(),
            });
            done('update', updated.id);
          },
          onError,
        },
      );
    } else {
      createOrder.mutate(
        { tableId, idempotencyKey, comment: orderCommentOpen ? orderComment : '', lines: cartLines },
        {
          onSuccess: () => {
            push({
              message: cartOnlyNone ? 'Заказ создан' : 'Заказ отправлен на кухню',
              type: 'success',
              at: new Date().toISOString(),
            });
            done('create');
          },
          onError,
        },
      );
    }
  };

  const count = cartCount;
  const submitting = createOrder.isPending || addItems.isPending || editOrder.isPending || replaceRejected.isPending;
  const stationInfo = cartStations(cartLines, categories.data ?? []);
  const cartOnlyNone = cartLines.length > 0 && !stationInfo.hasPrep;
  const cartSendLabel = cartOnlyNone
    ? 'Добавить в заказ'
    : stationInfo.kitchen
      ? 'Отправить на кухню'
      : 'Отправить в бар';
  const submitLabel = editingOrderId
    ? 'Сохранить изменения'
    : activeOrderId
      ? 'Добавить к заказу'
      : cartSendLabel;
  const replacing = !!replacementTarget;

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* Поиск + выбранный стол */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <PwaIcon name="search" size={18} color={colors.textLight} strokeWidth={2} />
          <TextInput
            placeholder="Поиск блюда"
            placeholderTextColor={colors.textLight}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
        <FastPressable style={[styles.tableChip, tablePickerOpen && styles.tableChipActive]} onPress={() => setTablePickerOpen(true)}>
          <Text style={styles.tableChipText}>
            Стол {tableNumber}
            {hallName ? ` · ${hallName}` : ''}
          </Text>
          <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
        </FastPressable>
      </View>

      {/* Категории */}
      <PillTabs
        items={[{ key: 'all', label: 'Все' }, ...sortedCategories.map((c) => ({ key: c.id, label: c.name }))]}
        value={categoryId}
        onChange={(next) => {
          if (next !== 'all' && setsCategoryIds.has(next)) {
            setSetPickerOpen(true);
            return;
          }
          setCategoryId(next);
        }}
        style={{ paddingHorizontal: spacing.md, marginBottom: spacing.md }}
      />

      {/* Блюда */}
      {dishes.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={filteredDishes}
          renderItem={renderDish}
          keyExtractor={dishKey}
          numColumns={2}
          style={styles.menuList}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={5}
          updateCellsBatchingPeriod={32}
          ListEmptyComponent={<Text style={styles.notFound}>Ничего не найдено</Text>}
        />
      )}

      {/* Бар корзины над нижней навигацией */}
      {replacing ? (
        <View style={styles.replacementBar}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.replacementLabel}>Выберите блюдо на замену</Text>
            <Text style={styles.replacementName} numberOfLines={1}>
              {replacementTarget ? orderItemName(replacementTarget.item) : ''}
            </Text>
          </View>
          <FastPressable onPress={clearReplacement} style={styles.replacementCancel}>
            <Text style={styles.replacementCancelText}>Отмена</Text>
          </FastPressable>
        </View>
      ) : (
      <>
      {editingOrderId ? (
        <View style={styles.editingBar}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.editingLabel}>Редактирование заказа</Text>
            <Text style={styles.editingName} numberOfLines={1}>{editingOrderNumber}</Text>
          </View>
          <FastPressable onPress={cancelEditing} style={styles.replacementCancel}>
            <Text style={styles.replacementCancelText}>Отмена</Text>
          </FastPressable>
        </View>
      ) : null}
      <View style={styles.cartBar}>
        <FastPressable
          style={styles.cartInfo}
          disabled={count === 0}
          onPress={() => setCartOpen(true)}
        >
          <PwaIcon name="cart" size={22} color={colors.textSecondary} />
          <View>
            <Text style={styles.cartCount}>{count} {pozLabel(count)}</Text>
            <NumberTicker value={cartTotal} style={styles.cartTotal} digitHeight={17} />
          </View>
        </FastPressable>
        <Button
          title={submitLabel}
          onPress={onSubmit}
          loading={submitting}
          disabled={count === 0}
          style={{ flex: 1 }}
        />
      </View>
      </>
      )}

      <CartSheet
        visible={cartOpen && !replacing}
        onClose={() => setCartOpen(false)}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel={submitLabel}
      />

      <VariantSheet
        dish={variantDish}
        onClose={() => setVariantDish(null)}
        onAdd={(variant) => {
          if (variantDish) {
            if (variantDish.trackInventory && typeof variant.stock === 'number') {
              const currentQty = currentVariantQuantity(variant.id);
              if (currentQty >= variant.stock) {
                push({ message: `Недостаточно на складе. Остаток: ${variant.stock}`, type: 'error', at: new Date().toISOString() });
                setVariantDish(null);
                return;
              }
            }
            if (replacementTarget) {
              replaceWithLine({ dish: variantDish, variant, quantity: 1 });
              setVariantDish(null);
              return;
            }
            const nextQty = currentVariantQuantity(variant.id) + 1;
            addToCart(variantDish, variant);
            push({
              message: `${variantDish.name} · ${variant.name} ×${nextQty} добавлено`,
              at: new Date().toISOString(),
              durationMs: 1800,
            });
          }
          setVariantDish(null);
        }}
      />

      <SetPickerSheet
        visible={setPickerOpen}
        sets={sets}
        onClose={() => setSetPickerOpen(false)}
        onPick={(set) => {
          onAddSet(set, defaultSetComponents(set));
          setSetPickerOpen(false);
        }}
        onConfigure={(set) => {
          setSetPickerOpen(false);
          setConfigSet(set);
        }}
      />

      <SetConfigSheet
        visible={!!configSet}
        set={configSet}
        menuDishes={menuDishes}
        categories={sortedCategories}
        onClose={() => setConfigSet(null)}
        onAdd={(set, components) => {
          onAddSet(set, components);
          setConfigSet(null);
        }}
      />

      <TablePickerSheet visible={tablePickerOpen} onClose={() => setTablePickerOpen(false)} />
    </SafeAreaView>
  );
}

function pozLabel(n: number): string {
  const a = Math.abs(n) % 100;
  const b = Math.abs(n) % 10;
  if (a > 10 && a < 20) return 'позиций';
  if (b === 1) return 'позиция';
  if (b >= 2 && b <= 4) return 'позиции';
  return 'позиций';
}

function orderItemName(item: { dishNameSnapshot: string; dishVariantNameSnapshot?: string | null }) {
  return item.dishVariantNameSnapshot
    ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
    : item.dishNameSnapshot;
}

const DishCard = memo(function DishCard({
  dish,
  qty,
  lineCount,
  disabled,
  onAdd,
  onDec,
}: {
  dish: Dish;
  qty: number;
  lineCount: number;
  disabled: boolean;
  onAdd: (dish: Dish) => void;
  onDec: (dish: Dish) => void;
}) {
  const hasVariants = dish.variants.length > 0;
  const active = qty > 0;
  const unit = minDishUnitPrice(dish);
  const originalUnit = hasVariants ? Math.min(...dish.variants.map((v) => Number(v.price))) : Number(dish.price);
  const hasDiscount = !hasVariants && unit !== originalUnit;
  const isOutOfStock = dish.trackInventory && (hasVariants
    ? dish.variants.every((variant) => typeof variant.stock === 'number' && variant.stock <= 0)
    : typeof dish.stock === 'number' && dish.stock <= 0);
  const isDisabled = disabled || isOutOfStock;
  const canDecrement = !hasVariants || lineCount === 1;

  return (
    <FastPressable
      disabled={isDisabled}
      onPress={() => onAdd(dish)}
      style={[styles.dish, active && styles.dishActive, isDisabled && styles.dishDisabled]}
    >
      {!dish.isAvailable ? (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>Недоступно</Text>
        </View>
      ) : isOutOfStock ? (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>Нет в наличии</Text>
        </View>
      ) : null}
      <Text style={styles.dishName} numberOfLines={2}>
        {dish.name}
      </Text>
      {hasVariants ? (
        <Text style={styles.dishSub} numberOfLines={1}>
          {variantNamesLine(dish.variants)}
        </Text>
      ) : dish.description ? (
        <Text style={styles.dishSub} numberOfLines={1}>
          {dish.description}
        </Text>
      ) : null}
      <View style={styles.dishBottom}>
        <Text style={styles.dishPrice}>
          {hasVariants ? `от ${money(unit)}` : money(unit)}
          {hasDiscount ? <Text style={styles.oldPrice}> {money(originalUnit)}</Text> : null}
        </Text>
        {active && canDecrement ? (
          <FastPressable
            style={styles.qtyBadge}
            onPress={(event) => {
              event.stopPropagation();
              onDec(dish);
            }}
          >
            <Text style={styles.qtyBadgeText}>{qty}</Text>
          </FastPressable>
        ) : active ? (
          <View style={styles.qtyCounter}>
            <Text style={styles.qtyCounterText}>{qty}</Text>
          </View>
        ) : null}
      </View>
    </FastPressable>
  );
}, (prev, next) =>
  prev.dish === next.dish &&
  prev.qty === next.qty &&
  prev.lineCount === next.lineCount &&
  prev.disabled === next.disabled &&
  prev.onAdd === next.onAdd &&
  prev.onDec === next.onDec
);

/** Лист выбора варианта/размера — радио-список как в PWA. */
function VariantSheet({
  dish,
  onClose,
  onAdd,
}: {
  dish: Dish | null;
  onClose: () => void;
  onAdd: (variant: DishVariant) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  React.useEffect(() => setSelectedId(null), [dish]);
  if (!dish) return null;
  const variants = dish.variants.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const selected = variants.find((v) => v.id === selectedId) ?? null;

  return (
    <BottomSheet
      visible={!!dish}
      onClose={onClose}
      sheet
      title={dish.name}
      footer={
        <View style={{ paddingBottom: spacing.sm }}>
          <Button title="Добавить" onPress={() => selected && onAdd(selected)} disabled={!selected} />
        </View>
      }
    >
      <Text style={styles.variantHint}>Выберите размер</Text>
      <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        {variants.map((v) => {
          const isSel = v.id === selectedId;
          // Цена варианта с учётом скидки блюда (как в PWA VariantPickerSheet).
          const price = dishUnitPrice(v.price, dish.discountType, dish.discountValue);
          const isOutOfStock = dish.trackInventory && typeof v.stock === 'number' && v.stock <= 0;
          return (
            <FastPressable
              key={v.id}
              disabled={isOutOfStock}
              onPress={() => setSelectedId(v.id)}
              style={[styles.variant, isSel && styles.variantSel, isOutOfStock && styles.variantDisabled]}
            >
              <View style={[styles.radio, isSel && { borderColor: colors.primary }]}>
                {isSel ? <View style={styles.radioDot} /> : null}
              </View>
              <Text style={styles.variantName}>
                {v.name}
                {isOutOfStock ? <Text style={styles.variantOutOfStock}>  Нет в наличии</Text> : null}
              </Text>
              <Text style={styles.variantPrice}>{money(price)}</Text>
            </FastPressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

function SetPickerSheet({
  visible,
  sets,
  onClose,
  onPick,
  onConfigure,
}: {
  visible: boolean;
  sets: Dish[];
  onClose: () => void;
  onPick: (set: Dish) => void;
  onConfigure: (set: Dish) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  React.useEffect(() => {
    if (visible) setSelectedId(sets[0]?.id ?? null);
  }, [sets, visible]);

  const selected = sets.find((set) => set.id === selectedId) ?? null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Сеты"
      sheet
      maxHeight="82%"
      footer={
        <View style={{ paddingBottom: spacing.sm }}>
          <Button title="Добавить" onPress={() => selected && onPick(selected)} disabled={!selected} style={{ flex: 1 }} />
        </View>
      }
    >
      <Text style={styles.variantHint}>Выберите сет</Text>
      {sets.length === 0 ? (
        <Text style={styles.notFound}>Сетов пока нет</Text>
      ) : (
        <View style={styles.setList}>
          {sets.map((set) => {
            const selectedSet = set.id === selectedId;
            const count = (set.setComponents ?? []).reduce((sum, component) => sum + component.quantity, 0);
            return (
              <FastPressable
                key={set.id}
                onPress={() => setSelectedId(set.id)}
                style={[styles.setRow, selectedSet && styles.setRowSelected]}
              >
                <View style={[styles.radio, selectedSet && { borderColor: colors.primary }]}>
                  {selectedSet ? <View style={styles.radioDot} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.setName} numberOfLines={1}>{set.name}</Text>
                  <Text style={styles.setSub}>{count} блюд</Text>
                </View>
                <Text style={styles.setPrice}>{money(set.price)}</Text>
                <FastPressable
                  hitSlop={10}
                  onPress={(event) => {
                    event.stopPropagation();
                    onConfigure(set);
                  }}
                  style={styles.setEyeBtn}
                >
                  <PwaIcon name="eye" size={24} color={colors.textLight} strokeWidth={2} />
                </FastPressable>
              </FastPressable>
            );
          })}
        </View>
      )}
    </BottomSheet>
  );
}

function SetConfigSheet({
  visible,
  set,
  menuDishes,
  categories,
  onClose,
  onAdd,
}: {
  visible: boolean;
  set: Dish | null;
  menuDishes: Dish[];
  categories: Category[];
  onClose: () => void;
  onAdd: (set: Dish, components: CartSetComponent[]) => void;
}) {
  const [components, setComponents] = useState<CartSetComponent[]>([]);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');

  React.useEffect(() => {
    if (!set || !visible) return;
    setComponents(defaultSetComponents(set));
    setReplacingId(null);
    setSearch('');
    setCategoryId('all');
  }, [set, visible]);

  const currentPrice = set ? calcSetPrice(set.price, components) : 0;
  const replacing = components.find((component) => component.componentId === replacingId) ?? null;
  const availableDishes = useMemo(() => menuDishes.filter((dish) => dish.isAvailable && !dish.isSet), [menuDishes]);
  const replacementCategories = useMemo(() => {
    const ids = new Set(availableDishes.map((dish) => dish.categoryId));
    return categories.filter((category) => ids.has(category.id));
  }, [availableDishes, categories]);
  const replacementOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return availableDishes.filter((dish) => {
      const byCat = categoryId === 'all' || dish.categoryId === categoryId;
      const bySearch = !q || dish.name.toLowerCase().includes(q);
      return byCat && bySearch;
    });
  }, [availableDishes, categoryId, search]);

  const patchComponent = (componentId: string, patch: Partial<CartSetComponent>) => {
    setComponents((current) => current.map((component) => (
      component.componentId === componentId ? { ...component, ...patch } : component
    )));
  };

  const toggleRemove = (component: CartSetComponent) => {
    patchComponent(
      component.componentId,
      component.action === 'removed'
        ? { action: 'default' }
        : { action: 'removed', finalDishId: undefined, finalName: undefined, finalPrice: undefined },
    );
  };

  const resetComponent = (componentId: string) => {
    patchComponent(componentId, {
      action: 'default',
      finalDishId: undefined,
      finalName: undefined,
      finalPrice: undefined,
    });
  };

  const applyReplacement = (dish: Dish) => {
    if (!replacingId) return;
    patchComponent(replacingId, {
      action: 'replaced',
      finalDishId: dish.id,
      finalName: dish.name,
      finalPrice: dish.price,
    });
    setReplacingId(null);
    setSearch('');
    setCategoryId('all');
  };

  if (!set) return null;
  const hasChanges = components.some((component) => component.action !== 'default');

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        title="Настроить сет"
        sheet
        maxHeight="86%"
        footer={
          <View style={{ paddingBottom: spacing.sm }}>
            <Button
              title={hasChanges ? `Добавить · ${money(currentPrice)}` : 'Добавить в заказ'}
              onPress={() => onAdd(set, components)}
            />
          </View>
        }
      >
        <View style={styles.setSummary}>
          <Text style={styles.setSummaryName} numberOfLines={1}>{set.name}</Text>
          <View style={styles.setSummaryPrices}>
            {Math.abs(Number(set.price) - currentPrice) > 0.01 ? (
              <Text style={styles.setSummaryOldPrice}>{money(set.price)}</Text>
            ) : null}
            <Text style={[styles.setSummaryPrice, !hasChanges && styles.setSummaryPricePlain]}>
              {money(currentPrice)}
            </Text>
          </View>
        </View>
        <Text style={styles.variantHint}>Состав сета ({components.length} позиций)</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          <View style={styles.componentList}>
            {components.map((component) => {
              const removed = component.action === 'removed';
              const replaced = component.action === 'replaced';
              const delta = replaced
                ? (Number(component.finalPrice ?? 0) - Number(component.originalPrice)) * component.quantity
                : 0;
              return (
                <View
                  key={component.componentId}
                  style={[styles.componentRow, removed && styles.componentRowRemoved, replaced && styles.componentRowReplaced]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[styles.componentName, removed && styles.componentRemovedText]}
                      numberOfLines={1}
                    >
                      {component.originalName}
                      {component.quantity > 1 ? ` ×${component.quantity}` : ''}
                    </Text>
                    {replaced ? (
                      <View style={styles.componentReplacementLine}>
                        <View style={styles.componentReplacementChip}>
                          <Text style={styles.componentReplacementChipText} numberOfLines={1}>→ {component.finalName}</Text>
                        </View>
                        {Math.abs(delta) > 0.01 ? (
                          <Text style={[styles.componentDelta, delta < 0 && { color: colors.success }]}>
                            {delta > 0 ? '+' : '−'}{money(Math.abs(delta))}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  {removed || replaced ? (
                    <FastPressable onPress={() => resetComponent(component.componentId)} style={styles.componentTextButton}>
                      <Text style={styles.componentTextButtonPrimary}>{removed ? 'Вернуть' : 'Отменить'}</Text>
                    </FastPressable>
                  ) : (
                    <View style={styles.componentActions}>
                      {component.removable ? (
                        <FastPressable onPress={() => toggleRemove(component)} style={styles.componentTextButton}>
                          <Text style={styles.componentTextButtonDanger}>Убрать</Text>
                        </FastPressable>
                      ) : null}
                      {component.replaceable ? (
                        <FastPressable onPress={() => setReplacingId(component.componentId)} style={styles.componentTextButton}>
                          <Text style={styles.componentTextButtonPrimary}>Заменить</Text>
                        </FastPressable>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </BottomSheet>
      <ReplacementPickerModal
        visible={!!replacingId}
        replacing={replacing}
        search={search}
        categoryId={categoryId}
        categories={replacementCategories}
        options={replacementOptions}
        onSearch={setSearch}
        onCategory={setCategoryId}
        onClose={() => setReplacingId(null)}
        onPick={applyReplacement}
      />
    </>
  );
}

function ReplacementPickerModal({
  visible,
  replacing,
  search,
  categoryId,
  categories,
  options,
  onSearch,
  onCategory,
  onClose,
  onPick,
}: {
  visible: boolean;
  replacing: CartSetComponent | null;
  search: string;
  categoryId: string;
  categories: Category[];
  options: Dish[];
  onSearch: (value: string) => void;
  onCategory: (value: string) => void;
  onClose: () => void;
  onPick: (dish: Dish) => void;
}) {
  return (
    <FullscreenSheet visible={visible} onClose={onClose} style={styles.replacementSafe}>
      <SafeAreaView style={styles.replacementSafe} edges={['top']}>
        <View style={styles.replacementHeader}>
          <FastPressable onPress={onClose} hitSlop={12} style={styles.replacementBack}>
            <PwaIcon name="chevronLeft" size={28} color={colors.textSecondary} strokeWidth={2.2} />
          </FastPressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.replacementTitle}>Выберите замену</Text>
            {replacing ? <Text style={styles.replacementSubtitle}>вместо: {replacing.originalName}</Text> : null}
          </View>
        </View>
        <View style={styles.replacementContent}>
          <View style={styles.replacementSearch}>
            <PwaIcon name="search" size={20} color={colors.textLight} strokeWidth={2} />
            <TextInput
              placeholder="Поиск блюда"
              placeholderTextColor={colors.textLight}
              value={search}
              onChangeText={onSearch}
              style={styles.replacementSearchInput}
            />
          </View>
          <PillTabs
            items={[{ key: 'all', label: 'Все' }, ...categories.map((category) => ({ key: category.id, label: category.name }))]}
            value={categoryId}
            onChange={onCategory}
            style={{ marginTop: spacing.md, marginBottom: spacing.md }}
          />
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.replacementGrid}>
              {options.map((dish) => (
                <FastPressable key={dish.id} onPress={() => onPick(dish)} style={styles.replacementDish}>
                  <Text style={styles.replacementDishName} numberOfLines={2}>{dish.name}</Text>
                  <Text style={styles.replacementDishPrice}>{money(minDishUnitPrice(dish))}</Text>
                </FastPressable>
              ))}
            </View>
            {options.length === 0 ? <Text style={styles.notFound}>Ничего не найдено</Text> : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </FullscreenSheet>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: waiterLayout.inputHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  searchInput: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, padding: 0 },
  tableChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: waiterLayout.inputHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tableChipActive: { borderColor: colors.primary },
  tableChipText: { fontSize: fontSize.tab, fontWeight: '500', color: colors.textPrimary },

  menuList: { flex: 1 },
  grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  gridRow: { justifyContent: 'space-between', marginBottom: 10 },
  dish: {
    width: '48.5%',
    height: waiterLayout.dishCardHeight,
    borderRadius: waiterLayout.dishCardRadius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dishActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  dishDisabled: { opacity: 0.5 },
  dishName: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary, lineHeight: 20 },
  dishSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  dishBottom: { marginTop: 'auto', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  dishPrice: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  oldPrice: { fontSize: fontSize.xs, fontWeight: '400', color: colors.textLight, textDecorationLine: 'line-through' },
  qtyBadge: {
    minWidth: waiterLayout.roundButton,
    height: waiterLayout.roundButton,
    borderRadius: waiterLayout.roundButton / 2,
    borderWidth: 1,
    borderColor: colors.red400,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  qtyBadgeText: { color: colors.red500, fontWeight: '600', fontSize: fontSize.tab },
  qtyCounter: {
    minWidth: waiterLayout.roundButton,
    height: waiterLayout.roundButton,
    borderRadius: waiterLayout.roundButton / 2,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  qtyCounterText: { color: colors.primary, fontWeight: '600', fontSize: fontSize.sm },
  unavailable: {
    position: 'absolute',
    right: 8,
    top: 8,
    backgroundColor: colors.slate100,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 1,
  },
  unavailableText: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '500' },
  notFound: { width: '100%', textAlign: 'center', color: colors.textMuted, fontSize: fontSize.sm, paddingVertical: spacing.xl },

  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cartInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  cartCount: { fontSize: fontSize.xs, color: colors.textMuted },
  cartTotal: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  replacementBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replacementLabel: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '700' },
  replacementName: { marginTop: 2, fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
  replacementCancel: {
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  replacementCancelText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.primaryFaint,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  editingLabel: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '700' },
  editingName: { marginTop: 2, fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },

  variantHint: { fontSize: fontSize.base, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm, marginTop: 4 },
  variant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  variantSel: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  variantDisabled: { opacity: 0.5 },
  variantOutOfStock: { fontSize: fontSize.xs, fontWeight: '500', color: colors.red500 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.slate300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  variantName: { flex: 1, fontSize: fontSize.md, fontWeight: '500', color: colors.textPrimary },
  variantPrice: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  setPickerFooter: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  setList: { gap: spacing.sm, paddingBottom: spacing.sm },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  setRowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  setName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  setSub: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  setPrice: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  setEyeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  setSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  setSummaryName: { flex: 1, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  setSummaryPrices: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  setSummaryOldPrice: {
    fontSize: fontSize.base,
    fontWeight: '500',
    color: colors.textLight,
    textDecorationLine: 'line-through',
  },
  setSummaryPrice: { fontSize: fontSize.base, fontWeight: '700', color: colors.primary },
  setSummaryPricePlain: { color: colors.textPrimary },
  componentList: { gap: spacing.sm, paddingBottom: spacing.md },
  componentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  componentRowRemoved: { backgroundColor: colors.background, opacity: 0.72 },
  componentRowReplaced: { borderColor: 'rgba(0,91,255,0.28)', backgroundColor: colors.primaryFaint },
  componentName: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  componentRemovedText: { color: colors.textLight, textDecorationLine: 'line-through' },
  componentReplacement: { marginTop: 2, fontSize: fontSize.xs, color: colors.primary, fontWeight: '600' },
  componentReplacementLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 8, flexWrap: 'wrap' },
  componentReplacementChip: {
    maxWidth: 170,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  componentReplacementChipText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700' },
  componentDelta: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '700' },
  componentActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  componentTextButton: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 2 },
  componentTextButtonPrimary: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700' },
  componentTextButtonDanger: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '700' },
  sheetHint: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.sm },
  searchWrapInSheet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: waiterLayout.inputHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  replacementSafe: { flex: 1, backgroundColor: colors.white },
  replacementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  replacementBack: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  replacementTitle: { fontSize: fontSize.lg, color: colors.textPrimary, fontWeight: '700' },
  replacementSubtitle: { marginTop: 2, fontSize: fontSize.base, color: colors.textMuted },
  replacementContent: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  replacementSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    height: 54,
    paddingHorizontal: spacing.md,
  },
  replacementSearchInput: { flex: 1, fontSize: fontSize.lg, color: colors.textPrimary, padding: 0 },
  replacementGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: spacing.md },
  replacementDish: {
    width: '48.5%',
    height: 104,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  replacementDishName: { flex: 1, fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary, lineHeight: 20 },
  replacementDishPrice: { marginTop: 'auto', fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
});
