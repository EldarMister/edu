import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, EmptyState, Loading, PillTabs } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing, waiterLayout } from '@/theme';
import { useCategories, useCreateOrder, useAddItems, useDishes } from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { useNotifications } from '@/store/notifications';
import { buildSetLine } from '@/utils/set';
import { makeIdempotencyKey, money } from '@/utils/format';
import { apiError } from '@/lib/api';
import { useConnectionStatus } from '@/services/socket';
import { CartSheet } from './CartSheet';
import { TablePickerSheet } from './TablePickerSheet';
import type { Dish, DishVariant } from '@/types';

function linePriceLocal(line: { dish: Dish; variant?: DishVariant; quantity: number }): number {
  return Number(line.variant?.price ?? line.dish.price) * line.quantity;
}

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
  const orderComment = useCart((s) => s.comment);
  const cartLines = useCart((s) => s.lines);
  const addToCart = useCart((s) => s.add);
  const addLineToCart = useCart((s) => s.addLine);
  const setCartQuantity = useCart((s) => s.setQuantity);
  const clearCartTable = useCart((s) => s.clearTable);
  const cartCount = useCart((s) => s.lines.reduce((sum, line) => sum + line.quantity, 0));
  const cartTotal = useCart((s) => s.lines.reduce((sum, line) => sum + linePriceLocal(line), 0));
  const push = useNotifications((s) => s.push);

  const categories = useCategories();
  const dishes = useDishes();
  const createOrder = useCreateOrder();
  const addItems = useAddItems();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [cartOpen, setCartOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [variantDish, setVariantDish] = useState<Dish | null>(null);

  const sortedCategories = useMemo(
    () => (categories.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [categories.data],
  );

  const cartQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of cartLines) {
      map[l.dish.id] = (map[l.dish.id] ?? 0) + l.quantity;
      if (l.variant) map[l.variant.id] = (map[l.variant.id] ?? 0) + l.quantity;
    }
    return map;
  }, [cartLines]);

  const filteredDishes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (dishes.data ?? []).filter((d) => {
      if (d.isSet) return false;
      const byCat = categoryId === 'all' || d.categoryId === categoryId;
      const byQ = !q || d.name.toLowerCase().includes(q);
      return byCat && byQ;
    });
    return [...list.filter((d) => d.isAvailable), ...list.filter((d) => !d.isAvailable)];
  }, [dishes.data, categoryId, search]);

  const onAddDish = useCallback((dish: Dish) => {
    if (dish.isSet) {
      addLineToCart(buildSetLine(dish));
      push({ message: `${dish.name} добавлено`, at: new Date().toISOString(), durationMs: 1800 });
      return;
    }
    if (dish.variants && dish.variants.length > 0) {
      setVariantDish(dish);
      return;
    }
    const nextQty = currentDishQuantity(dish.id) + 1;
    addToCart(dish);
    push({ message: `${dish.name} ×${nextQty} добавлено`, at: new Date().toISOString(), durationMs: 1800 });
  }, [addLineToCart, addToCart, push]);

  const onDecDish = useCallback((dish: Dish) => {
    const lines = useCart.getState().lines;
    const idx = lines.findIndex((l) => l.dish.id === dish.id && !l.set);
    if (idx >= 0) setCartQuantity(idx, lines[idx].quantity - 1);
  }, [setCartQuantity]);

  const renderDish = useCallback(({ item }: { item: Dish }) => (
    <DishCard
      dish={item}
      qty={cartQuantities[item.id] ?? 0}
      disabled={!item.isAvailable}
      onAdd={onAddDish}
      onDec={onDecDish}
    />
  ), [cartQuantities, onAddDish, onDecDish]);

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
    const done = () => {
      clearCartTable();
      setCartOpen(false);
      navigation.navigate('Orders');
    };
    const onError = (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() });

    if (activeOrderId) {
      addItems.mutate({ orderId: activeOrderId, idempotencyKey, lines: cartLines }, { onSuccess: done, onError });
    } else {
      createOrder.mutate(
        { tableId, idempotencyKey, comment: orderComment, lines: cartLines },
        { onSuccess: done, onError },
      );
    }
  };

  const count = cartCount;
  const submitting = createOrder.isPending || addItems.isPending;
  const submitLabel = activeOrderId ? 'Добавить к заказу' : 'Отправить на кухню';

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
        <Pressable style={[styles.tableChip, tablePickerOpen && styles.tableChipActive]} onPress={() => setTablePickerOpen(true)}>
          <Text style={styles.tableChipText}>
            Стол {tableNumber}
            {hallName ? ` · ${hallName}` : ''}
          </Text>
          <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      </View>

      {/* Категории */}
      <PillTabs
        items={[{ key: 'all', label: 'Все' }, ...sortedCategories.map((c) => ({ key: c.id, label: c.name }))]}
        value={categoryId}
        onChange={setCategoryId}
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
      <View style={styles.cartBar}>
        <Pressable
          style={styles.cartInfo}
          disabled={count === 0}
          onPress={() => setCartOpen(true)}
        >
          <PwaIcon name="cart" size={22} color={colors.textSecondary} />
          <View>
            <Text style={styles.cartCount}>{count} {pozLabel(count)}</Text>
            <Text style={styles.cartTotal}>{money(cartTotal)}</Text>
          </View>
        </Pressable>
        <Button
          title={submitLabel}
          onPress={onSubmit}
          loading={submitting}
          disabled={count === 0}
          style={{ flex: 1 }}
        />
      </View>

      <CartSheet
        visible={cartOpen}
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

const DishCard = memo(function DishCard({
  dish,
  qty,
  disabled,
  onAdd,
  onDec,
}: {
  dish: Dish;
  qty: number;
  disabled: boolean;
  onAdd: (dish: Dish) => void;
  onDec: (dish: Dish) => void;
}) {
  const hasVariants = dish.variants.length > 0;
  const active = qty > 0;
  const unit = hasVariants
    ? Math.min(...dish.variants.map((v) => Number(v.price)))
    : Number(dish.price);

  return (
    <Pressable
      disabled={disabled}
      onPress={() => onAdd(dish)}
      style={[styles.dish, active && styles.dishActive, disabled && styles.dishDisabled]}
    >
      {!dish.isAvailable ? (
        <View style={styles.unavailable}>
          <Text style={styles.unavailableText}>Недоступно</Text>
        </View>
      ) : null}
      <Text style={styles.dishName} numberOfLines={2}>
        {dish.name}
      </Text>
      {hasVariants ? (
        <Text style={styles.dishSub} numberOfLines={1}>
          {dish.variants.map((v) => v.name).join(' / ')}
        </Text>
      ) : dish.description ? (
        <Text style={styles.dishSub} numberOfLines={1}>
          {dish.description}
        </Text>
      ) : null}
      <View style={styles.dishBottom}>
        <Text style={styles.dishPrice}>
          {hasVariants ? `от ${money(unit)}` : money(unit)}
        </Text>
        {active ? (
          <Pressable
            style={styles.qtyBadge}
            onPress={(event) => {
              event.stopPropagation();
              onDec(dish);
            }}
          >
            <Text style={styles.qtyBadgeText}>{qty}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}, (prev, next) =>
  prev.dish === next.dish &&
  prev.qty === next.qty &&
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
          return (
            <Pressable
              key={v.id}
              onPress={() => setSelectedId(v.id)}
              style={[styles.variant, isSel && styles.variantSel]}
            >
              <View style={[styles.radio, isSel && { borderColor: colors.primary }]}>
                {isSel ? <View style={styles.radioDot} /> : null}
              </View>
              <Text style={styles.variantName}>{v.name}</Text>
              <Text style={styles.variantPrice}>{money(v.price)}</Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
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
});
