import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, View } from '@/components/themed';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Text, TextInput } from '@/components/typography';
import { Card } from '@/components/ui';
import { apiError } from '@/lib/api';
import type { Ingredient } from '@/services/api/warehouse';
import { colors, spacing } from '@/theme';

const groups = [
  { id: 'ingredients', label: 'Ингредиенты' },
  { id: 'prepared', label: 'Полуфабрикаты и заготовленные блюда' },
  { id: 'goods', label: 'Товары' },
] as const;

export function WarehouseInventoryScope({ products, selected, onChange, disabled, loading, error, onRetry }: {
  products: Ingredient[]; selected: string[]; onChange: (ids: string[]) => void;
  disabled: boolean; loading: boolean; error: unknown; onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const query = search.trim().toLocaleLowerCase('ru');
  const shown = products.filter((item) => !query || [item.name, item.category].some((value) => value?.toLocaleLowerCase('ru').includes(query)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const selectedIds = new Set(selected);
  const selectedShown = shown.filter((item) => selectedIds.has(item.id)).length;
  function toggle(key: string) {
    setOpen((active) => active.includes(key) ? active.filter((entry) => entry !== key) : [...active, key]);
  }
  function select(items: Ingredient[]) {
    const ids = items.map((item) => item.id);
    const changed = new Set(ids);
    onChange(ids.every((id) => selectedIds.has(id)) ? selected.filter((id) => !changed.has(id)) : [...new Set([...selected, ...ids])]);
  }
  function scope(label: string, items: Ingredient[]) {
    const count = items.filter(({ id }) => selectedIds.has(id)).length;
    return <FastPressable accessibilityRole="checkbox" accessibilityLabel={label} disabled={disabled || !items.length}
      accessibilityState={{ checked: !!items.length && count === items.length ? true : count > 0 ? 'mixed' : false, disabled: disabled || !items.length }}
      onPress={() => select(items)} style={[styles.checkbox, !!count && styles.checked]}>
      {count > 0 ? <PwaIcon name={count === items.length ? 'check' : 'minus'} size={14} color={colors.white} /> : null}
    </FastPressable>;
  }
  function branch(label: string, key: string, items: Ingredient[]) {
    const expanded = !!query || open.includes(key);
    return <View style={styles.row}>
      {scope('Выбрать ' + label, items)}
      <FastPressable accessibilityRole="button" accessibilityState={{ expanded }} disabled={!items.length}
        onPress={() => toggle(key)} style={[styles.row, styles.heading]}>
        <PwaIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={15} color={colors.textMuted} />
        <Text style={styles.name} translate>{label}</Text>
        <Text style={styles.muted}>{items.filter(({ id }) => selectedIds.has(id)).length} / {items.length}</Text>
      </FastPressable>
    </View>;
  }
  return <Card style={styles.panel}>
    <Text style={styles.muted} translate>Выберите продукты или категории, которые будете проверять.</Text>
    <TextInput accessibilityLabel="Быстрый поиск продуктов и категорий" style={styles.search} placeholder="Быстрый поиск"
      value={search} onChangeText={setSearch} />
    <View style={styles.row}>
      <Text style={[styles.muted, styles.name]}>Выбрано: {selected.length}{query && selected.length > selectedShown ? ' · вне поиска: ' + (selected.length - selectedShown) : ''}</Text>
      {selected.length > 0 && <FastPressable accessibilityRole="button" disabled={disabled} onPress={() => onChange([])}>
        <Text style={styles.link} translate>Снять выбор</Text>
      </FastPressable>}
    </View>
    {loading ? <ActivityIndicator color={colors.primary} /> : error ? <FastPressable accessibilityRole="button" onPress={onRetry}>
      <Text style={styles.danger}>{apiError(error)}</Text><Text style={styles.link} translate>Повторить загрузку</Text>
    </FastPressable> : <>
      <View style={styles.row}>{scope('Выбрать все найденные продукты', shown)}
        <Text style={styles.name} translate>{query ? 'Все найденные продукты' : 'Все продукты'}</Text><Text style={styles.muted}>{shown.length}</Text></View>
      {groups.map((group) => {
        const items = shown.filter((item) => group.id === (item.kind === 'goods' || item.kind === 'beverage' ? 'goods'
          : item.kind === 'preparation' || item.kind === 'prepared_dish' ? 'prepared' : 'ingredients'));
        const categories = [...new Set(items.map((item) => item.category?.trim() || 'Без категории'))].sort((a, b) => a.localeCompare(b, 'ru'));
        return <View key={group.id} style={styles.group}>
          {branch(group.label, group.id, items)}
          {(!!query || open.includes(group.id)) && categories.map((category) => {
            const key = group.id + ':' + category;
            const members = items.filter((item) => (item.category?.trim() || 'Без категории') === category);
            return <View style={styles.indent} key={key}>
              {branch(category, key, members)}
              {(!!query || open.includes(key)) && members.map((item) => <View style={[styles.row, styles.indent]} key={item.id}>
                {scope('Выбрать ' + item.name, [item])}
                <Text style={styles.name}>{item.name}</Text><Text style={styles.muted}>{item.unit}</Text>
              </View>)}
            </View>;
          })}
        </View>;
      })}
      {!shown.length && <Text style={styles.muted} translate>{query ? 'Продукты не найдены. Измените поиск.' : 'Нет продуктов для проверки.'}</Text>}
    </>}
  </Card>;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  search: { borderRadius: 20, minHeight: 36, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.textPrimary },
  row: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: { width: 20, height: 20, borderWidth: 1, borderColor: colors.border, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  heading: { flex: 1 },
  name: { color: colors.textPrimary, flex: 1, fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 12 },
  link: { color: colors.primary, fontSize: 13 },
  danger: { color: colors.danger },
  group: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  indent: { marginLeft: spacing.sm },
});
