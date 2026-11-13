import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppHeader } from './AppHeader';
import { BrandLogo } from './BrandLogo';
import { ConnectionBadge, OfflineNotice } from './ConnectionStatus';
import { Text } from './typography';
import { colors, fontSize, spacing } from '@/theme';
import { useCurrentShift } from '@/services/api/waiter';
import { useConnectionStatus } from '@/services/socket';

/** Верхняя шапка официанта: логотип слева, соединение + статус смены справа. */
export function WaiterHeader() {
  const shift = useCurrentShift();
  const active = shift.data?.status === 'active';
  const online = useConnectionStatus();
  return (
    <View>
      <View
        accessibilityElementsHidden={!online}
        importantForAccessibility={online ? 'auto' : 'no-hide-descendants'}
        style={!online && styles.hiddenHeader}
      >
        <AppHeader
          left={<BrandLogo />}
          right={
            <View style={styles.status}>
              <ConnectionBadge online />
              <Text style={[styles.shift, { color: active ? colors.success : colors.textMuted }]} translate>
                {active ? 'Смена активна' : 'Нет смены'}
              </Text>
            </View>
          }
        />
      </View>
      {!online && <OfflineNotice style={styles.offlineNotice} />}
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenHeader: { opacity: 0 },
  offlineNotice: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', paddingVertical: 0 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shift: { fontSize: fontSize.xs },
});
