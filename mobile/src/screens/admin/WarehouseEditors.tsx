import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { Select } from '@/components/Select';
import { Button, Card, Field, Toggle } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { money } from '@/utils/format';
import { useNotifications } from '@/store/notifications';
import {
  useIngredients, useRecipe, useRecipeMutations,
  type RecipeItem,
} from '@/services/api/warehouse';
import { UNIT_OPTIONS, unitsForType } from '@/services/api/warehouseUnits';
import type { AdminDish } from '@/services/api/admin';

const number = (value: string) => Number(value.trim().replace(',', '.'));
function useReportError() { const push = useNotifications((s) => s.push); return (error: unknown) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
function ScrollableSheet(props: React.ComponentProps<typeof BottomSheet>) {
  return <BottomSheet {...props}><SheetScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">{props.children}</SheetScrollView></BottomSheet>;
}

export { PurchaseEditor } from './WarehousePurchaseEditor';

export function RecipeEditor({ dish, onClose }: { dish: AdminDish; onClose: () => void }) {
  const q = useRecipe(dish.id);
  const ingredients = useIngredients('');
  const actions = useRecipeMutations(dish.id);
  const [ingredientId, setIngredientId] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('g');
  const [editing, setEditing] = useState<RecipeItem | null>(null);
  const [fromCommonWarehouse, setFromCommonWarehouse] = useState(false);
  const reportError = useReportError();
  const selected = ingredients.data?.find((item) => item.id === ingredientId);
  function reset() {
    setEditing(null);
    setAmount('');
    setIngredientId('');
    setFromCommonWarehouse(false);
  }
  function edit(item: RecipeItem) {
    setEditing(item);
    setIngredientId(item.ingredientId);
    setAmount(String(item.amount));
    setUnit(item.amountUnit);
    setFromCommonWarehouse(item.fromCommonWarehouse ?? false);
  }
  async function save() {
    const quantity = number(amount);
    if ((!editing && !ingredientId) || !Number.isFinite(quantity) || quantity <= 0) {
      reportError(new Error('Выберите ингредиент и укажите количество больше нуля'));
      return;
    }
    const values = { amount: quantity, unit, fromCommonWarehouse };
    try {
      if (editing) await actions.updateItem.mutateAsync({ id: editing.id, ...values });
      else await actions.addItem.mutateAsync({ ingredientId, ...values });
      reset();
    } catch (error) {
      reportError(error);
    }
  }

  const recipe = q.data;
  const options = (ingredients.data ?? [])
    .filter((item) => item.isActive && !recipe?.items.some((line) => line.ingredientId === item.id))
    .map((item) => ({ value: item.id, label: item.name, translate: false }));
  return (
    <ScrollableSheet visible onClose={onClose} title={`Техкарта · ${dish.name}`} maxHeight="90%">
      <View style={styles.stack}>
        {q.isLoading ? <ActivityIndicator color={colors.primary} /> : q.isError ? (
          <Text style={{ color: colors.danger }}>{apiError(q.error)}</Text>
        ) : recipe ? (
          <>
            <Text style={styles.title} translate>Себестоимость: {recipe.foodCost == null ? '—' : money(recipe.foodCost)}</Text>
            <Text style={styles.muted} translate>Цена: {money(recipe.price)} · Маржа: {recipe.marginPercent == null ? '—' : `${recipe.marginPercent.toFixed(1)}%`}</Text>
            {recipe.items.map((item) => (
              <Card key={item.id} style={styles.stack}>
                <Text style={styles.label}>{item.name} · {item.amount} {item.unit} · {item.lineCost == null ? '—' : money(item.lineCost)}</Text>
                <Text style={styles.muted} translate>Остаток: {item.stock} {item.unit}</Text>
                {item.fromCommonWarehouse ? <Text style={styles.muted} translate>Списание с общего склада</Text> : null}
                <View style={styles.row}>
                  <Button title="Изменить" size="md" variant="secondary" onPress={() => edit(item)} />
                  <Button title="Удалить" size="md" variant="danger" disabled={actions.removeItem.isPending} onPress={() => void actions.removeItem.mutateAsync(item.id).catch(reportError)} />
                </View>
              </Card>
            ))}
            <Text style={styles.title} translate>{editing ? 'Изменить ингредиент' : 'Добавить ингредиент'}</Text>
            {editing ? <Text style={styles.label}>{editing.name}</Text> : (
              <Select
                title="Ингредиент"
                value={ingredientId}
                options={options}
                onChange={(value) => {
                  setIngredientId(value);
                  setUnit(ingredients.data?.find((item) => item.id === value)?.displayUnit ?? 'g');
                }}
              />
            )}
            <Field label="Количество на порцию" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <Select title="Единица" value={unit} options={selected ? unitsForType(selected.unitType) : UNIT_OPTIONS} onChange={setUnit} />
            <View style={styles.row}>
              <Text style={styles.label} translate>Списывать с общего склада</Text>
              <Toggle checked={fromCommonWarehouse} onChange={setFromCommonWarehouse} />
            </View>
            <Button title={editing ? 'Сохранить' : 'Добавить'} loading={actions.addItem.isPending || actions.updateItem.isPending} onPress={() => void save()} />
            {editing ? <Button title="Отмена редактирования" variant="secondary" onPress={reset} /> : null}
          </>
        ) : null}
      </View>
    </ScrollableSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  label: { color: colors.textPrimary, fontWeight: '600' },
  muted: { color: colors.textMuted, fontSize: 13 },
});
