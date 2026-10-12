import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppHeader } from './AppHeader';
import { BrandLogo } from './BrandLogo';
import { ConnectionStatus } from './ConnectionStatus';
import { Text } from './typography';
import { colors, fontSize, spacing } from '@/theme';
import { useCurrentShift } from '@/services/api/waiter';

/** Верхняя шапка официанта: логотип слева, соединение + статус смены справа. */
export function WaiterHeader() {
  const shift = useCurrentShift();
  const active = shift.data?.status === 'active';
  return (
    <AppHeader
      left={<BrandLogo />}
      right={
        <View style={styles.status}>
          <ConnectionStatus />
          <Text style={[styles.shift, { color: active ? colors.success : colors.textMuted }]} translate>
            {active ? 'Смена активна' : 'Нет смены'}
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shift: { fontSize: fontSize.xs },
});
