import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Button, EmptyState, Loading, PillTabs } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { colors, fontSize, radius, spacing, cardShadow } from '@/theme';
import { useCategories, useCreateOrder, useAddItems, useDishes } from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { notify } from '@/store/notifications';
import { buildSetLine } from '@/utils/set';
import { makeIdempotencyKey, money, pluralPositions } from '@/utils/format';
import { apiError } from '@/lib/api';
import { useConnectionStatus } from '@/services/socket';
import { CartSheet } from './CartSheet';
import { TablePickerSheet } from './TablePickerSheet';
import type { Dish, DishVariant } from '@/types';

export function MenuScreen() {
  const navigation = useNavigation<any>();
  const connected = useConnectionStatus();

  const tableId = useCart((s) => s.tableId);
  const tableNumber = useCart((s) => s.tableNumber);
  const hallName = useCart((s) => s.hallName);
  const activeOrderId = useCart((s) => s.activeOrderId);
  const orderComment = useCart((s) => s.comment);
  const cart = useCart();

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
    for (const l of cart.lines) {
      map[l.dish.id] = (map[l.dish.id] ?? 0) + l.quantity;
      if (l.variant) map[l.variant.id] = (map[l.variant.id] ?? 0) + l.quantity;
    }
    return map;
  }, [cart.lines]);

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

  if (!tableId) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <EmptyState text="Выберите стол на вкладке «Столы», чтобы открыть меню" />
      </SafeAreaView>
    );
  }

  const onAddDish = (dish: Dish) => {
    if (dish.isSet) {
      cart.addLine(buildSetLine(dish));
      notify(`${dish.name} добавлен`);
      return;
    }
    if (dish.variants && dish.variants.length > 0) {
      setVariantDish(dish);
      return;
    }
    cart.add(dish);
    const line = useCart.getState().lines.find((l) => l.dish.id === dish.id && !l.variant && !l.set);
    notify(`${dish.name} ×${line?.quantity ?? 1} добавлено`);
  };

  const onSubmit = () => {
    if (!connected) {
      Alert.alert('Нет соединения', 'Создание заказа недоступно без интернета.');
      return;
    }
    if (cart.lines.length === 0) return;
    const idempotencyKey = makeIdempotencyKey();
    const done = () => {
      cart.clearTable();
      setCartOpen(false);
      navigation.navigate('Orders');
    };
    const onError = (e: unknown) => Alert.alert('Ошибка', apiError(e));

    if (activeOrderId) {
      addItems.mutate({ orderId: activeOrderId, idempotencyKey, lines: cart.lines }, { onSuccess: done, onError });
    } else {
      createOrder.mutate(
        { tableId, idempotencyKey, comment: orderComment, lines: cart.lines },
        { onSuccess: done, onError },
      );
    }
  };

  const count = cart.count();
  const submitting = createOrder.isPending || addItems.isPending;
  const submitLabel = activeOrderId ? 'Добавить к заказу' : 'Отправить на кухню';

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* Поиск + выбранный стол */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textLight} />
          <TextInput
            placeholder="Поиск блюда"
            placeholderTextColor={colors.textLight}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
        <Pressable style={styles.tableChip} onPress={() => setTablePickerOpen(true)}>
          <Text style={styles.tableChipText}>
            Стол {tableNumber}
            {hallName ? ` · ${hallName}` : ''}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Категории */}
      <PillTabs
        items={[{ key: 'all', label: 'Все' }, ...sortedCategories.map((c) => ({ key: c.id, label: c.name }))]}
        value={categoryId}
        onChange={setCategoryId}
        style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}
      />

      {/* Блюда */}
      {dishes.isLoading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {filteredDishes.map((d) => {
            const hasVariants = d.variants.length > 0;
            const qty = cartQuantities[d.id] ?? 0;
            const active = qty > 0;
            const unit = hasVariants
              ? Math.min(...d.variants.map((v) => Number(v.price)))
              : Number(d.price);
            const disabled = !d.isAvailable;
            return (
              <Pressable
                key={d.id}
                disabled={disabled}
                onPress={() => onAddDish(d)}
                style={[styles.dish, active && styles.dishActive, disabled && styles.dishDisabled]}
              >
                {!d.isAvailable ? (
                  <View style={styles.unavailable}>
                    <Text style={styles.unavailableText}>Недоступно</Text>
                  </View>
                ) : null}
                <Text style={styles.dishName} numberOfLines={2}>
                  {d.name}
                </Text>
                {hasVariants ? (
                  <Text style={styles.dishSub} numberOfLines={1}>
                    {d.variants.map((v) => v.name).join(' / ')}
                  </Text>
                ) : d.description ? (
                  <Text style={styles.dishSub} numberOfLines={1}>
                    {d.description}
                  </Text>
                ) : null}
                <View style={styles.dishBottom}>
                  <Text style={styles.dishPrice}>
                    {hasVariants ? `от ${money(unit)}` : money(unit)}
                  </Text>
                  {active ? (
                    <Pressable
                      style={styles.qtyBadge}
                      onPress={() => {
                        const idx = cart.lines.findIndex((l) => l.dish.id === d.id && !l.set);
                        if (idx >= 0) cart.setQuantity(idx, cart.lines[idx].quantity - 1);
                      }}
                    >
                      <Text style={styles.qtyBadgeText}>{qty}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {filteredDishes.length === 0 ? (
            <Text style={styles.notFound}>Ничего не найдено</Text>
          ) : null}
        </ScrollView>
      )}

      {/* Бар корзины над нижней навигацией */}
      <View style={styles.cartBar}>
        <Pressable
          style={styles.cartInfo}
          disabled={count === 0}
          onPress={() => setCartOpen(true)}
        >
          <Ionicons name="cart-outline" size={20} color={colors.textSecondary} />
          <View>
            <Text style={styles.cartCount}>{count} {pluralPositions(count)}</Text>
            <Text style={styles.cartTotal}>{money(cart.total())}</Text>
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
            cart.add(variantDish, variant);
            const line = useCart
              .getState()
              .lines.find((l) => l.dish.id === variantDish.id && l.variant?.id === variant.id && !l.set);
            notify(`${variantDish.name} · ${variant.name} ×${line?.quantity ?? 1} добавлено`);
          }
          setVariantDish(null);
        }}
      />

      <TablePickerSheet visible={tablePickerOpen} onClose={() => setTablePickerOpen(false)} />
    </SafeAreaView>
  );
}

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
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  searchInput: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, padding: 0 },
  tableChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  tableChipText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  // Карточка блюда — точные размеры из PWA DishMenu: h-[100px], rounded-xl, px-3 py-2.
  dish: {
    width: '48%',
    height: 100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...cardShadow,
  },
  dishActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  dishDisabled: { opacity: 0.5 },
  dishName: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary, lineHeight: 20 },
  dishSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  dishBottom: { marginTop: 'auto', paddingTop: 8, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  dishPrice: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  qtyBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.red400,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  qtyBadgeText: { color: colors.red500, fontWeight: '600', fontSize: 14 },
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
