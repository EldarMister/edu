import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet } from 'react-native';
import { SafeAreaView, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { useRadioOverlayBlocker } from '@/features/ptt/radioVisibility';
import { colors, spacing } from '@/theme';
import { AdminLoadingSkeleton } from './AdminLoadingSkeleton';

/** Native document page: Android Back and the visible Back button share the dirty guard. */
export function WarehouseWorkspace({ title, onClose, footer, pending = false, children }: {
  title: string; onClose: () => void; footer?: ReactNode; pending?: boolean; children?: ReactNode;
}) {
  useRadioOverlayBlocker(true);
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <FastPressable accessibilityRole="button" accessibilityLabel="Назад" onPress={onClose} style={styles.back}>
          <PwaIcon name="chevronLeft" size={22} color={colors.primary} />
        </FastPressable>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.title} translate>{title}</Text>
        <ConnectionStatus />
      </View>
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.body}>{pending ? <AdminLoadingSkeleton layout="form" /> : children}</View>
        {footer && !pending ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, minHeight: 0 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  back: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.textPrimary },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
});
