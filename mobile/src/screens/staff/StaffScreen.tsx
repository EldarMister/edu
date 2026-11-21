import { View } from '@/components/themed';
import { AppHeader } from '@/components/AppHeader';
import { BrandLogo } from '@/components/BrandLogo';
import { Button, EmptyState } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { unregisterPushDevice } from '@/services/push';
import { disconnectSocket } from '@/services/socket';
import { spacing } from '@/theme';

export function StaffScreen() {
  const logout = useAuth((state) => state.logout);
  return (
    <View style={{ flex: 1 }}>
      <AppHeader left={<BrandLogo />} />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <EmptyState text="У вашей должности нет доступа к рабочим пространствам. Обратитесь к владельцу." />
        <Button title="Выйти" variant="secondary" onPress={() => {
          void unregisterPushDevice();
          disconnectSocket();
          logout();
        }} />
      </View>
    </View>
  );
}
