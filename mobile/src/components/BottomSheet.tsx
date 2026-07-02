import React from 'react';
import {
  Modal as RNModal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, radius, spacing, softShadow } from '@/theme';

/**
 * Нижний лист / модалка — повторяет PWA Modal на мобильном (items-end):
 * затемнение фона rgba(0,0,0,0.4), белый лист со скруглением сверху,
 * шапка с заголовком и крестиком (border-b), футер (border-t).
 * `drag handle` показывается для «листового» режима (sheet).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  footer,
  sheet = false,
  bodyStyle,
  maxHeight,
  bottomInset = 0,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** true — стиль «нижний лист» с хваталкой вместо шапки-крестика. */
  sheet?: boolean;
  bodyStyle?: ViewStyle;
  maxHeight?: ViewStyle['maxHeight'];
  bottomInset?: number;
}) {
  return (
    <RNModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <SafeAreaView style={[styles.sheet, maxHeight ? { maxHeight } : null, bottomInset ? { marginBottom: bottomInset } : null]} edges={['bottom']}>
          {sheet ? (
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
              {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
            </View>
          ) : title ? (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.textLight} />
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.body, bodyStyle]}>{children}</View>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </SafeAreaView>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  backdropFill: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '92%',
    ...softShadow,
  },
  handleWrap: { paddingTop: 10, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.slate300 },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  title: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  body: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
