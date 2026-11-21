import React, { type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { ScrollView, View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { colors, radius, spacing } from '@/theme';

export function WarehouseDirectorySearch({ label, value, onChange, placeholder = 'Поиск...' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return <View style={styles.search}>
    <PwaIcon name="search" size={15} color={colors.textMuted} />
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder}
      placeholderTextColor={colors.textLight} style={styles.input} />
    {value ? <FastPressable accessibilityRole="button" accessibilityLabel={`Очистить: ${label}`} onPress={() => onChange('')}
      style={styles.clear}><Text style={styles.muted}>×</Text></FastPressable> : null}
  </View>;
}

export function WarehouseDirectorySort({ name = 'Название', ascending, onToggle }: {
  name?: string; ascending: boolean; onToggle: () => void;
}) {
  return <FastPressable accessibilityRole="button" accessibilityLabel={`Сортировать по названию: ${ascending ? 'от Я до А' : 'от А до Я'}`}
    onPress={onToggle} style={styles.sort}>
    <Text style={styles.header} translate>{name}</Text>
    <Text style={styles.muted}>{ascending ? '↑' : '↓'}</Text>
  </FastPressable>;
}

export type DirectoryColumn<T> = { key: string; title?: ReactNode; width: number; cell: (item: T) => ReactNode };

export function WarehouseDirectoryTable<T extends { id: string }>({ columns, rows }: {
  columns: DirectoryColumn<T>[]; rows: T[];
}) {
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  return <ScrollView horizontal keyboardShouldPersistTaps="handled">
    <View style={{ minWidth: width }}>
      <View style={[styles.tableRow, styles.tableHead]}>
        {columns.map(({ key, title, width: columnWidth }) => (
          <View key={key} style={[styles.cell, { width: columnWidth }]}>
            {typeof title === 'string' ? <Text style={styles.header} translate>{title}</Text> : title}
          </View>
        ))}
      </View>
      {rows.map((item) => <View key={item.id} style={styles.tableRow}>
        {columns.map(({ key, cell, width: columnWidth }) => (
          <View key={key} style={[styles.cell, { width: columnWidth }]}>
            {cell(item)}
          </View>
        ))}
      </View>)}
    </View>
  </ScrollView>;
}

export function WarehouseDirectoryValue({ children, muted = false, singleLine = true }: {
  children: ReactNode; muted?: boolean; singleLine?: boolean;
}) {
  return <Text style={muted ? styles.muted : styles.cellValue} numberOfLines={singleLine ? 1 : undefined}>{children}</Text>;
}

export function WarehouseDirectoryLink({ label, accessibilityLabel, onPress, disabled, translate }: {
  label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean; translate?: boolean;
}) {
  return <FastPressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.link}>
    <Text numberOfLines={1} style={[styles.linkText, disabled && styles.disabled]} translate={translate}>{label}</Text>
  </FastPressable>;
}

export function WarehouseDirectoryField({ label, wide, translate = true, children }: {
  label: string; wide: boolean; translate?: boolean; children: ReactNode;
}) {
  return <View style={[styles.field, wide && styles.fieldWide]}>
    <Text style={[styles.label, wide && styles.labelWide]} translate={translate}>{label}</Text>
    <View style={styles.fieldControl}>{children}</View>
  </View>;
}

export function WarehouseDirectorySection({ label, expanded, onPress }: {
  label: string; expanded: boolean; onPress: () => void;
}) {
  return <FastPressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={styles.disclosure}>
    <PwaIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={16} color={colors.textMuted} />
    <Text style={styles.section} translate>{label}</Text>
  </FastPressable>;
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: 10, backgroundColor: colors.card },
  input: { flex: 1, color: colors.textPrimary, fontSize: 13, minHeight: 32, paddingVertical: 3 },
  clear: { minHeight: 32, minWidth: 28, justifyContent: 'center', alignItems: 'center' },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38 },
  header: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  muted: { color: colors.textMuted, fontSize: 13 },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 47, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHead: { backgroundColor: colors.card },
  cell: { paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center' },
  cellValue: { color: colors.textPrimary, fontSize: 14, fontVariant: ['tabular-nums'] },
  link: { minHeight: 40, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: 14 },
  disabled: { opacity: 0.5 },
  field: { gap: 6 },
  fieldWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { color: colors.textSecondary, fontSize: 14 },
  labelWide: { width: 215 },
  fieldControl: { flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: 470 },
  disclosure: { flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: spacing.sm },
  section: { color: colors.textPrimary, fontWeight: '500', fontSize: 14 },
});
