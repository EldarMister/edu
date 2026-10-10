import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui';
import { colors, fontSize, spacing } from '@/theme';

export function InsufficientPermissionsSheet({
  visible, pending, onClose, onCall,
}: {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onCall: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Недостаточно прав"
      footer={<View style={styles.actions}>
        <Button title="Позвать администратора" loading={pending} onPress={onCall} />
        <Button title="Понятно" variant="secondary" disabled={pending} onPress={onClose} />
      </View>}
    >
      <Image source={require('../../../assets/insufficient-permissions.png')} style={styles.illustration} resizeMode="contain" />
      <Text style={styles.text} translate>
        У вас недостаточно прав для отмены готового блюда или заказа. Пожалуйста, позовите администратора.
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  illustration: { alignSelf: 'center', width: 280, height: 196, marginBottom: spacing.md },
  text: { textAlign: 'center', fontSize: fontSize.md, lineHeight: 24, color: colors.textSecondary, paddingBottom: spacing.lg },
});
