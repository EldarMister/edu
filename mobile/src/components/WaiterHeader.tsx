import { BottomSheet } from './BottomSheet';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { ReceiptPrintsScreen } from '@/screens/admin/ReceiptPrintsScreen';
import { Button } from './ui';
import { View } from '@/components/themed';
import React from 'react';
import { StyleSheet } from 'react-native';
import { AppHeader } from './AppHeader';
import { BrandLogo } from './BrandLogo';
import { ConnectionBadge, OfflineNotice } from './ConnectionStatus';
import { Text } from './typography';
import { colors, fontSize, spacing } from '@/theme';
import { useCurrentShift } from '@/services/api/waiter';
import { useConnectionStatus } from '@/services/socket';

/** Верхняя шапка официанта: логотип слева, соединение + статус смены справа. */
export function WaiterHeader() {
  const trackShift = useAuth((state) => state.user?.permissions?.workShiftRequired !== false);
  const shift = useCurrentShift(trackShift);
  const active = shift.data?.status === 'active';
  const online = useConnectionStatus();
  const canPrint = usePermissions().canAction('printReceipts');
  const [printOpen, setPrintOpen] = React.useState(false);
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
              {canPrint && <Button title="Печать чека" size="md" variant="secondary" onPress={() => setPrintOpen(true)} />}
              <ConnectionBadge online />
              {trackShift && <Text style={[styles.shift, { color: active ? colors.success : colors.textMuted }]} translate>
                {active ? 'Смена активна' : 'Нет смены'}
              </Text>}
            </View>
          }
        />
      </View>
      {canPrint && printOpen && <BottomSheet visible title="Печать чека" expanded onClose={() => setPrintOpen(false)}>
        <ReceiptPrintsScreen terminal />
      </BottomSheet>}
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
