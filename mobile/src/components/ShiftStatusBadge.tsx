import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ConnectionStatus } from './ConnectionStatus';
import { colors, fontSize, spacing } from '@/theme';
import { useCurrentShift } from '@/services/api/waiter';

/**
 * Правый блок шапки официанта: индикатор соединения (зелёная точка + «Онлайн»)
 * и статус смены — серый «Не в смене» либо зелёный «Смена активна».
 */
export function ShiftStatusBadge() {
  const shiftQ = useCurrentShift();
  const active = shiftQ.data?.status === 'active';
  return (
    <View style={styles.row}>
      <ConnectionStatus />
      <Text style={[styles.shift, { color: active ? colors.success : colors.textMuted }]}>
        {active ? 'Смена активна' : 'Не в смене'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shift: { fontSize: fontSize.xs, fontWeight: '500' },
});
