import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { colors, fontSize, radius, spacing } from '@/theme';
import { TABLE_STATUS } from '@/theme/status';
import { useHalls } from '@/services/api/waiter';
import { useAuth } from '@/store/auth';
import { useCart } from '@/store/cart';
import type { TableItem } from '@/types';

/** Смена стола на экране меню — список столов по залам (как в PWA TableSelectModal). */
export function TablePickerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const halls = useHalls();
  const user = useAuth((s) => s.user);
  const selectTable = useCart((s) => s.selectTable);
  const currentTableId = useCart((s) => s.tableId);
  const lines = useCart((s) => s.lines);

  const pick = (tbl: TableItem, hallName: string) => {
    if (tbl.id === currentTableId) {
      onClose();
      return;
    }
    if (tbl.occupiedBy && tbl.occupiedBy.id !== user?.id) {
      Alert.alert('Стол занят', `Этот стол занят другим официантом: ${tbl.occupiedBy?.name}`);
      return;
    }
    const apply = () => {
      selectTable({ id: tbl.id, number: tbl.number, hallName });
      onClose();
    };
    if (lines.length > 0) {
      Alert.alert('Сменить стол?', 'В корзине уже есть блюда. Они будут очищены.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Сменить', style: 'destructive', onPress: apply },
      ]);
    } else {
      apply();
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Выбор стола">
      <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
        {(halls.data ?? []).map((hall) => (
          <View key={hall.id} style={{ marginBottom: spacing.md }}>
            <Text style={styles.hallName}>{hall.name}</Text>
            <View style={styles.grid}>
              {hall.tables.map((tbl) => {
                const selected = tbl.id === currentTableId;
                const meta = TABLE_STATUS[tbl.status];
                return (
                  <Pressable
                    key={tbl.id}
                    onPress={() => pick(tbl, hall.name)}
                    style={[styles.table, selected && styles.tableSelected]}
                  >
                    {!selected ? <View style={[styles.dot, { backgroundColor: meta.dot }]} /> : null}
                    <Text style={[styles.tableNumber, selected && { color: colors.white }]}>
                      {tbl.number}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // PWA TableSelectModal: ярлык зала mb-1.5 text-xs text-text-muted.
  hallName: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: 6, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // PWA: сетка grid-cols-4 gap-2, карточка h-[60px] (фиксированная высота, не квадрат).
  table: {
    width: '22.6%',
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  // PWA: точка right-2 top-2 h-2.5 w-2.5 (8/8/10).
  dot: { position: 'absolute', right: 8, top: 8, width: 10, height: 10, borderRadius: 5 },
  // PWA: цифра text-[15px] font-medium.
  tableNumber: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
});
