import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { FastPressable } from '@/components/FastPressable';
import { Button } from '@/components/ui';
import { ScreenTransition } from '@/components/ScreenTransition';
import { colors, fontSize, spacing } from '@/theme';

export function PublicLayout({ title, children, transitionKey, right }: { title: string; children: React.ReactNode; transitionKey?: string; right?: React.ReactNode }) {
  const navigation = useNavigation();
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <FastPressable accessibilityRole="button" accessibilityLabel="Назад" hitSlop={12} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('PublicHome' as never)}><Text style={styles.back}>‹</Text></FastPressable>
      <Text style={styles.title} translate>{title}</Text>{right ?? <View style={{ width: 24 }} />}
    </View>
    <ScreenTransition style={{ flex: 1 }} transitionKey={transitionKey}>{children}</ScreenTransition>
  </SafeAreaView>;
}
export function PublicError({ message, retry }: { message: string; retry?: () => void }) {
  return <View style={styles.empty}><Text style={styles.message}>{message}</Text>{retry ? <Button title="Повторить" onPress={retry} /> : null}</View>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border }, back: { fontSize: 36, color: colors.primary }, title: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary }, empty: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.lg }, message: { fontSize: fontSize.base, color: colors.textMuted, textAlign: 'center' } });
