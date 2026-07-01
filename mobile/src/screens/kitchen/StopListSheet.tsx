import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { Loading, Toggle } from '@/components/ui';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useSaveStopList, useStopList } from '@/services/api/kitchen';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import type { PrepStation } from '@/types';

/**
 * «Стоп-лист»: станция временно отключает свои блюда — как PWA StopListDrawer.
 * Toggle включён → блюдо недоступно (в стоп-листе). Сохраняется сразу при переключении.
 */
export function StopListSheet({
  visible,
  station = 'kitchen',
  onClose,
}: {
  visible: boolean;
  station?: PrepStation;
  onClose: () => void;
}) {
  const stopListQ = useStopList(visible, station);
  const save = useSaveStopList();
  const push = useNotifications((s) => s.push);

  const [search, setSearch] = useState('');
  // Локальная доступность для мгновенного отклика: dishId → isAvailable.
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!visible) return;
    const data = stopListQ.data;
    if (!data) return;
    const next: Record<string, boolean> = {};
    for (const cat of data) for (const dish of cat.dishes) next[dish.id] = dish.isAvailable;
    setDraft(next);
  }, [visible, stopListQ.data]);

  useEffect(() => {
    if (visible) setSearch('');
  }, [visible]);

  const categories = useMemo(() => {
    const data = stopListQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data
      .map((cat) => ({ ...cat, dishes: cat.dishes.filter((dish) => dish.name.toLowerCase().includes(q)) }))
      .filter((cat) => cat.dishes.length > 0);
  }, [stopListQ.data, search]);

  // Автосохранение: переключили ползунок → сразу пишем на сервер, при ошибке откатываем.
  const toggleDish = (dishId: string, makeStopped: boolean) => {
    const nextAvailable = !makeStopped;
    setDraft((prev) => ({ ...prev, [dishId]: nextAvailable }));
    save.mutate([{ dishId, isAvailable: nextAvailable }], {
      onError: (err: unknown) => {
        setDraft((prev) => ({ ...prev, [dishId]: !nextAvailable }));
        push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
      },
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Стоп-лист" maxHeight="88%">
      <Text style={styles.subtitle}>Выберите блюда, которые временно недоступны</Text>

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

      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
        {stopListQ.isLoading ? (
          <Loading />
        ) : categories.length === 0 ? (
          <Text style={styles.empty}>Ничего не найдено</Text>
        ) : (
          categories.map((cat) => (
            <View key={cat.id} style={styles.category}>
              <Text style={styles.categoryName}>{cat.name}</Text>
              <View style={styles.dishList}>
                {cat.dishes.map((dish) => {
                  const available = draft[dish.id] ?? dish.isAvailable;
                  return (
                    <View key={dish.id} style={styles.dishRow}>
                      <Text style={styles.dishName} numberOfLines={1}>
                        {dish.name}
                      </Text>
                      <View style={[styles.stateBadge, !available && styles.stateBadgeStopped]}>
                        <Text style={[styles.stateBadgeText, !available && styles.stateBadgeTextStopped]}>
                          {available ? 'Доступно' : 'Недоступно'}
                        </Text>
                      </View>
                      <Toggle checked={!available} onChange={(stopped) => toggleDish(dish.id, stopped)} />
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, padding: 0 },
  empty: { paddingVertical: spacing.xl, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  category: { marginBottom: spacing.lg },
  categoryName: {
    marginBottom: 6,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textLight,
  },
  dishList: { gap: spacing.sm },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  dishName: { flex: 1, minWidth: 0, fontSize: fontSize.base, color: colors.textPrimary },
  stateBadge: {
    borderRadius: 6,
    backgroundColor: colors.slate100,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  stateBadgeStopped: { backgroundColor: colors.primarySoft },
  stateBadgeText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.textMuted },
  stateBadgeTextStopped: { color: colors.primary },
});
