import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button, Loading, RoundBtn } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useDishModifiers } from '@/services/api/waiter';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { CartCustomization, CartLine } from '@/types';
import { money } from '@/utils/format';

export function ModifierSheet({ line, editing, onClose, onConfirm }: {
  line: CartLine;
  editing: boolean;
  onClose: () => void;
  onConfirm: (customization: CartCustomization) => void;
}) {
  const query = useDishModifiers(line.dish.id, line.variant?.id);
  const [selected, setSelected] = useState<Record<string, number>>(() =>
    Object.fromEntries((line.modifierSelections ?? []).map(({ optionId, quantity }) => [optionId, quantity])));
  const [excluded, setExcluded] = useState(line.excludedIngredientIds ?? []);
  const [weight, setWeight] = useState(line.weightGrams == null ? '' : String(line.weightGrams));
  const weighted = line.dish.isWeighted;
  const measure = line.dish.weightedMeasure === 'volume' ? 'мл' : 'г';
  const weightGrams = Number(weight);
  const groups = query.data?.groups ?? [];
  const groupQuantity = (options: readonly { id: string }[]) => options.reduce((sum, { id }) => sum + (selected[id] ?? 0), 0);
  const validGroups = groups.every((group) => {
    const count = groupQuantity(group.options);
    return count >= group.minSelections && (group.maxSelections == null || count <= group.maxSelections)
      && group.options.every((option) => (selected[option.id] ?? 0) <= option.maxQuantity);
  });
  const choices = groups.flatMap((group) => group.options.filter(({ id }) => selected[id] > 0)
    .map(({ id, name, price, replacesIngredientName }) => ({ optionId: id, name, price, quantity: selected[id], replacesIngredientName })));
  const extra = choices.reduce((total, option) => total + option.price * option.quantity, 0);
  const canConfirm = !!query.data && !query.isFetching && !query.isError && validGroups
    && (!weighted || (Number.isSafeInteger(weightGrams) && weightGrams > 0));

  function conflicts(option: { id: string; replacesIngredientId?: string }, current: Record<string, number>, skipIds: readonly string[] = []) {
    return !!option.replacesIngredientId && groups.some((group) => group.options.some((candidate) =>
      candidate.id !== option.id && !skipIds.includes(candidate.id) && current[candidate.id] > 0
      && candidate.replacesIngredientId === option.replacesIngredientId));
  }

  function confirm() {
    if (!canConfirm || !query.data) return;
    const removed = query.data.excludableIngredients.filter(({ id }) => excluded.includes(id));
    onConfirm({ modifierSelections: choices, excludedIngredientIds: removed.map(({ id }) => id),
      excludedIngredientNames: removed.map(({ name }) => name), weightGrams: weighted ? weightGrams : undefined });
  }

  return <BottomSheet visible onClose={onClose} title={line.variant ? `${line.dish.name} · ${line.variant.name}` : line.dish.name}
    footer={<Button title={`${editing ? 'Сохранить' : 'Добавить'}${extra > 0 ? ` · +${money(extra)}` : ''}`}
      disabled={!canConfirm} onPress={confirm} />}>
    <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
      {query.isPending && <Loading />}
      {query.isError && <View style={styles.section}><Text style={styles.note}>{apiError(query.error)}</Text>
        <Button title="Повторить" onPress={() => void query.refetch()} /></View>}
      {weighted && <View style={styles.section}>
        <Text style={styles.heading}>Количество, {measure}</Text>
        <TextInput accessibilityLabel={`Количество, ${measure}`} keyboardType="number-pad" inputMode="numeric"
          style={styles.input} value={weight} onChangeText={setWeight} />
      </View>}
      {groups.map((group) => {
        const count = groupQuantity(group.options);
        const single = group.minSelections === 1 && group.maxSelections === 1;
        return <View key={group.id} style={styles.section}>
          <Text style={styles.heading}>{group.name}</Text>
          {!single && <Text style={styles.note}>
            {group.minSelections > 0 ? `Не менее ${group.minSelections}` : 'По желанию'}{group.maxSelections != null ? ` · до ${group.maxSelections}` : ''}
          </Text>}
          {group.options.map((option) => {
            const quantity = selected[option.id] ?? 0;
            const name = option.replacesIngredientName ? `${option.replacesIngredientName} → ${option.name}` : option.name;
            const label = option.price > 0 ? `${name} · +${money(option.price)}` : name;
            if (single) return <Pressable key={option.id} style={styles.choice} accessibilityRole="radio"
              disabled={conflicts(option, selected, group.options.map(({ id }) => id))}
              accessibilityState={{ checked: quantity > 0 }} onPress={() => setSelected((current) => ({ ...current,
                ...Object.fromEntries(group.options.map(({ id }) => [id, Number(id === option.id)])),
              }))}>
              <Ionicons name={quantity > 0 ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.primary} />
              <Text style={styles.label}>{label}</Text>
            </Pressable>;
            return <View key={option.id} style={styles.choice}>
              <Text style={styles.label}>{label}</Text>
              <RoundBtn kind="dec" accessibilityLabel={`Убрать ${option.name}`} disabled={!quantity}
                onPress={() => setSelected((current) => ({ ...current, [option.id]: Math.max(0, (current[option.id] ?? 0) - 1) }))} />
              <Text style={styles.quantity}>{quantity}</Text>
              <RoundBtn kind="inc" accessibilityLabel={`Добавить ${option.name}`}
                disabled={conflicts(option, selected) || quantity >= option.maxQuantity || (group.maxSelections != null && count >= group.maxSelections)}
                onPress={() => setSelected((current) => {
                  const currentQuantity = current[option.id] ?? 0;
                  const currentCount = group.options.reduce((sum, { id }) => sum + (current[id] ?? 0), 0);
                  if (conflicts(option, current) || currentQuantity >= option.maxQuantity || (group.maxSelections != null && currentCount >= group.maxSelections)) return current;
                  return { ...current, [option.id]: currentQuantity + 1 };
                })} />
            </View>;
          })}
        </View>;
      })}
      {!!query.data?.excludableIngredients.length && <View style={styles.section}>
        <Text style={styles.heading}>Убрать из блюда</Text>
        {query.data.excludableIngredients.map(({ id, name }) => <Pressable key={id} style={styles.choice}
          accessibilityRole="checkbox" accessibilityState={{ checked: excluded.includes(id) }}
          onPress={() => setExcluded((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])}>
          <Ionicons name={excluded.includes(id) ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
          <Text style={styles.label}>Без {name}</Text>
        </Pressable>)}
        <Text style={styles.note}>Исключение ингредиента не меняет цену.</Text>
      </View>}
      {query.data && !weighted && !groups.length && !query.data.excludableIngredients.length &&
        <Text style={styles.note}>Для выбранной порции состав фиксированный.</Text>}
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 430 },
  section: { gap: spacing.xs, marginBottom: spacing.md },
  heading: { color: colors.textPrimary, fontSize: fontSize.base, fontWeight: '600' },
  note: { color: colors.textMuted, fontSize: fontSize.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 42 },
  label: { flex: 1, color: colors.textPrimary, fontSize: fontSize.sm },
  quantity: { minWidth: 16, textAlign: 'center', color: colors.textPrimary },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.textPrimary },
});
