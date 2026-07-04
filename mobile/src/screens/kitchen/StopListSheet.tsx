import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal as RNModal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Loading, Toggle } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { sheetTiming } from '@/components/motion';
import { colors, fontSize, radius, spacing, softShadow } from '@/theme';
import { useSaveStopList, useStopList } from '@/services/api/kitchen';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import type { PrepStation } from '@/types';

/**
 * «Стоп-лист»: станция временно отключает свои блюда — как PWA StopListDrawer.
 * Боковая панель справа на всю высоту (fixed inset-0 justify-end / aside h-full).
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
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(420, Math.round(width * 0.9));

  const [render, setRender] = useState(visible);
  const [search, setSearch] = useState('');
  // Локальная доступность для мгновенного отклика: dishId → isAvailable.
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  const translateX = useSharedValue(panelWidth);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(translateX);
    cancelAnimation(backdrop);
    if (visible) {
      setRender(true);
      translateX.value = panelWidth;
      translateX.value = withTiming(0, { duration: sheetTiming.enterMs, easing: sheetTiming.easing });
      backdrop.value = withTiming(1, { duration: sheetTiming.enterMs, easing: sheetTiming.easing });
      return;
    }
    backdrop.value = withTiming(0, { duration: sheetTiming.exitMs, easing: sheetTiming.easing });
    translateX.value = withTiming(panelWidth, { duration: sheetTiming.exitMs, easing: sheetTiming.easing }, (finished) => {
      if (finished) runOnJS(setRender)(false);
    });
  }, [visible, panelWidth, translateX, backdrop]);

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

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  if (!render) return null;

  return (
    <RNModal
      visible={render}
      animationType="none"
      transparent
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <FastPressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View style={[styles.panel, { width: panelWidth }, panelStyle]}>
          <SafeAreaView style={styles.panelSafe} edges={['top', 'bottom']}>
            <View style={styles.header}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title}>Стоп-лист</Text>
                <Text style={styles.subtitle}>Выберите блюда, которые временно недоступны</Text>
              </View>
              <FastPressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                <PwaIcon name="close" size={22} color={colors.textLight} strokeWidth={2} />
              </FastPressable>
            </View>

            <View style={styles.searchWrapOuter}>
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
            </View>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
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
          </SafeAreaView>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    height: '100%',
    backgroundColor: colors.white,
    ...softShadow,
  },
  panelSafe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: spacing.lg,
  },
  title: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  closeBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginRight: -4 },
  searchWrapOuter: { paddingHorizontal: 20, paddingVertical: spacing.md },
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
  },
  searchInput: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary, padding: 0 },
  listContent: { paddingHorizontal: 20, paddingBottom: spacing.xl },
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
  dishList: { gap: spacing.xs },
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
