import React from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { colors, spacing } from '@/theme';

export function InsufficientPermissionsSheet({
  visible, pending, onClose, onCall,
}: {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onCall: () => void;
}) {
  const { width } = useWindowDimensions();
  const illustrationWidth = Math.min(300, width - 48);
  return (
    <BottomSheet visible={visible} onClose={onClose} hideHeader>
      <SheetScrollView style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image source={require('../../../assets/insufficient-permissions.png')} style={[styles.illustration, { width: illustrationWidth, height: illustrationWidth * 517 / 738 }]} resizeMode="contain" />
        <Text style={styles.title} translate>Недостаточно прав</Text>
        <Text style={styles.text} translate>
          У вас недостаточно прав для отмены заказа. Пожалуйста, позовите администратора.
        </Text>
        <View style={styles.actions}>
          <FastPressable disabled={pending} onPress={onCall} style={[styles.button, styles.primaryButton, pending && styles.disabled]}>
            <Text style={[styles.buttonText, styles.primaryButtonText]} translate>{pending ? 'Отправляем вызов…' : 'Позвать администратора'}</Text>
          </FastPressable>
          <FastPressable disabled={pending} onPress={onClose} style={[styles.button, styles.secondaryButton, pending && styles.disabled]}>
            <Text style={[styles.buttonText, styles.secondaryButtonText]} translate>Понятно</Text>
          </FastPressable>
        </View>
      </SheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingHorizontal: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.sm },
  actions: { gap: spacing.md, marginTop: 28, width: '100%' },
  illustration: { alignSelf: 'center' },
  title: { textAlign: 'center', fontSize: 28, fontWeight: '700', letterSpacing: -0.7, color: colors.textPrimary, marginTop: spacing.sm },
  text: { textAlign: 'center', fontSize: 17, lineHeight: 28, color: colors.textSecondary, marginTop: spacing.md },
  button: { minHeight: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md },
  buttonText: { fontSize: 16, fontWeight: '600' },
  primaryButton: { backgroundColor: colors.primary },
  primaryButtonText: { color: colors.white },
  secondaryButton: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.white },
  secondaryButtonText: { color: colors.primary },
  disabled: { opacity: 0.5 },
});
