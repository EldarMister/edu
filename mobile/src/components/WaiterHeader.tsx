import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { AppHeader } from './AppHeader';
import { BrandLogo } from './BrandLogo';
import { ConnectionStatus } from './ConnectionStatus';
import { colors, fontSize } from '@/theme';
import { useCurrentShift } from '@/services/api/waiter';

/** Верхняя шапка официанта: логотип слева, соединение + статус смены справа. */
export function WaiterHeader() {
  const shiftQ = useCurrentShift();
  const active = shiftQ.data?.status === 'active';
  return (
    <AppHeader
      left={<BrandLogo />}
      right={
        <>
          <ConnectionStatus />
          <Text style={[styles.shift, { color: active ? colors.success : colors.textMuted }]}>
            {active ? 'Смена активна' : 'Нет смены'}
          </Text>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  shift: { fontSize: fontSize.xs },
});
