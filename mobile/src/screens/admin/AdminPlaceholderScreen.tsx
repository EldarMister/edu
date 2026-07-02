import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from '@/theme';

/** Временная заглушка раздела админки/владельца — портируется по фазам. */
export function AdminPlaceholderScreen({ title }: { title: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>Раздел портируется с PWA</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  sub: { fontSize: fontSize.sm, color: colors.textMuted },
});
