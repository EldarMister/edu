import React, { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { FastPressable } from '@/components/FastPressable';
import { Select } from '@/components/Select';
import { Alert, Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import {
  qty, useIngredients, usePreparationRecipe, useWarehousePolicy,
  type Ingredient, type PreparationProcessingMethod, type PreparationRecipe, type WarehouseLocation,
} from '@/services/api/warehouse';
import { useSavePreparationCard } from '@/services/api/warehouseProduction';
import { ALL_UNITS, UNIT_OPTIONS, unitLabel, unitTypeOf, unitsForType, type UnitCode } from '@/services/api/warehouseUnits';
import { colors, spacing } from '@/theme';
import { money } from '@/utils/format';
import { PreparationBatchSheet } from './PreparationBatchEditor';
import { ProductionBatchPage } from './WarehouseProductionTab';
import { WarehouseWorkspace } from './WarehouseWorkspace';

type Editor = { kind: 'card'; id?: string } | { kind: 'produce'; item: Ingredient } | { kind: 'batch'; id: string };
type RecipeLine = {
  key: string; ingredientId: string; gross: string; net: string; unit: UnitCode;
  method: PreparationProcessingMethod | ''; lossPercent: number;
};

const methods: { value: RecipeLine['method']; label: string }[] = [
  { value: '', label: 'Без обработки' }, { value: 'cleaning', label: 'Очистка' },
  { value: 'boiling', label: 'Варка' }, { value: 'frying', label: 'Жарка' },
  { value: 'stewing', label: 'Тушение' }, { value: 'baking', label: 'Запекание' },
];
const empty: PreparationRecipe = {
  id: '', name: '', unitType: 'mass', displayUnit: 'kg', outputQuantity: 0, outputUnit: 'kg', mode: 'virtual', items: [],
};

export function WarehousePreparationTab({ warehouseId, locations }: { warehouseId?: string; locations: WarehouseLocation[] }) {
  const query = useIngredients('', warehouseId);
  const policy = useWarehousePolicy();
  const { canAction } = usePermissions();
  const canEdit = canAction('warehouseRecipes');
  const showCosts = canAction('warehouseCosts');
  const canProduce = canAction('warehouseProduce') && !!(policy.data?.warehouseProductionEnabled || policy.data?.productionInUse);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [search, setSearch] = useState('');
  const [ascending, setAscending] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const close = () => setEditor(null);
  const rows = (query.data ?? []).filter((item) => item.isPrepared && item.isActive &&
    item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') * (ascending ? 1 : -1));

  return <View style={styles.stack}>
    {canEdit ? <View style={styles.actions}><Button title="Добавить" size="md" onPress={() => setEditor({ kind: 'card' })} /></View> : null}
    <Card style={styles.stack}>
      <Field value={search} onChangeText={setSearch} placeholder="Быстрый поиск" accessibilityLabel="Поиск полуфабриката" />
      <FastPressable accessibilityRole="button" accessibilityLabel="Сортировать по названию" onPress={() => setAscending(!ascending)}>
        <Text style={styles.muted}>{ascending ? 'Название ↑' : 'Название ↓'}</Text>
      </FastPressable>
      {query.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {query.isError ? <QueryError error={query.error} retry={() => void query.refetch()} /> : null}
      {query.isSuccess && rows.length === 0 ? <Text style={styles.muted} translate>{search.trim() ? 'Ничего не найдено' : 'Здесь будут ваши полуфабрикаты'}</Text> : null}
      {rows.map((item) => <View key={item.id} style={[styles.stack, styles.separator]}>
        <View style={styles.row}>
          <FastPressable style={styles.grow} accessibilityRole="button" onPress={() => setEditor({ kind: 'card', id: item.id })}>
            <Text style={styles.link}>{item.name}</Text>
            {item.category ? <Text style={styles.muted}>{item.category}</Text> : null}
          </FastPressable>
          <Text style={styles.muted}>{item.recipeOutputQuantity != null && item.recipeOutputUnit
            ? qty(item.recipeOutputQuantity, unitLabel(item.recipeOutputUnit)) : 'Не задан'}</Text>
          {showCosts ? <Text>{item.recipeTotalCost == null ? '—' : money(item.recipeTotalCost)}</Text> : null}
        </View>
        <View style={styles.actions}>
          <Button title="Состав" variant="secondary" size="md" onPress={() => setExpanded(expanded === item.id ? null : item.id)} />
          <Button title={canEdit ? 'Изменить' : 'Открыть'} variant="secondary" size="md" onPress={() => setEditor({ kind: 'card', id: item.id })} />
          {canProduce && item.preparationMode !== 'virtual'
            ? <Button title="Приготовить" size="md" onPress={() => setEditor({ kind: 'produce', item })} /> : null}
        </View>
        {expanded === item.id ? <Composition id={item.id} warehouseId={warehouseId} /> : null}
      </View>)}
    </Card>
    {editor?.kind === 'card' && (editor.id ? <ExistingCard id={editor.id} warehouseId={warehouseId} onClose={close} />
      : <PreparationCardForm recipe={empty} onClose={close} />)}
    {editor?.kind === 'produce' ? <PreparationBatchSheet item={editor.item} warehouseId={warehouseId} locations={locations}
      onClose={close} onBatch={(id) => setEditor({ kind: 'batch', id })} /> : null}
    {editor?.kind === 'batch' ? <ProductionBatchPage id={editor.id} locations={locations} onClose={close} /> : null}
  </View>;
}

function Composition({ id, warehouseId }: { id: string; warehouseId?: string }) {
  const query = usePreparationRecipe(id, warehouseId);
  if (query.isPending) return <ActivityIndicator color={colors.primary} />;
  if (!query.data) return <QueryError error={query.error} retry={() => void query.refetch()} />;
  return <View style={styles.stack}>
    {query.data.items.length ? query.data.items.map((item) => <View key={item.ingredientId} style={styles.row}>
      <Text style={styles.grow}>{item.name}</Text>
      <Text>{qty(item.quantity, unitLabel(item.unit))}</Text>
    </View>) : <Text style={styles.muted} translate>Состав пока не задан.</Text>}
  </View>;
}

function ExistingCard({ id, warehouseId, onClose }: { id: string; warehouseId?: string; onClose: () => void }) {
  const query = usePreparationRecipe(id, warehouseId);
  if (query.data) return <PreparationCardForm key={id} recipe={query.data} onClose={onClose} />;
  return <WarehouseWorkspace title="Редактирование полуфабриката" onClose={onClose} pending={query.isPending}>
    {query.isError ? <View style={styles.content}><QueryError error={query.error} retry={() => void query.refetch()} /></View> : null}
  </WarehouseWorkspace>;
}

function PreparationCardForm({ recipe, onClose }: { recipe: PreparationRecipe; onClose: () => void }) {
  const { canAction } = usePermissions();
  const editable = canAction('warehouseRecipes');
  const showCosts = canAction('warehouseCosts');
  const { data: policy } = useWarehousePolicy();
  const query = useIngredients('');
  const save = useSavePreparationCard();
  const submitting = useRef(false);
  const [requestKey] = useState(randomUUID);
  const [expectedUpdatedAt] = useState(recipe.updatedAt);
  const [name, setName] = useState(recipe.name);
  const [category, setCategory] = useState(recipe.category ?? '');
  const [instructions, setInstructions] = useState(recipe.instructions ?? '');
  const [unit, setUnit] = useState(recipe.displayUnit);
  const [mode, setMode] = useState<NonNullable<PreparationRecipe['mode']>>(recipe.mode ?? 'virtual');
  const [output, setOutput] = useState(recipe.outputQuantity ? String(recipe.outputQuantity) : '');
  const [outputUnit, setOutputUnit] = useState(recipe.outputUnit);
  const [lines, setLines] = useState((): RecipeLine[] => recipe.items.map((item) => ({
    key: item.ingredientId, ingredientId: item.ingredientId, gross: String(item.quantity), net: String(item.netAmount ?? item.quantity),
    unit: item.unit, method: item.processingMethod ?? '', lossPercent: item.lossPercent ?? 0,
  })));
  const [error, setError] = useState('');
  const snapshot = JSON.stringify([name, category, instructions, unit, mode, output, outputUnit, lines]);
  const baseline = useRef(snapshot);
  const available = (query.data ?? []).filter((item) => item.isActive && item.id !== recipe.id);
  const canStock = !!(policy?.warehouseProductionEnabled || policy?.productionInUse || recipe.mode === 'stocked');
  const valid = editable && !!name.trim() && positive(output) && lines.length > 0 &&
    lines.every(({ ingredientId, gross, net }) => !!ingredientId && positive(gross) && amount(net) >= 0 && amount(net) <= amount(gross));

  function close() {
    if (submitting.current) return;
    if (snapshot === baseline.current) { onClose(); return; }
    Alert.alert('Есть несохранённые изменения', 'Выйти без сохранения?', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: onClose },
    ]);
  }

  function patch(key: string, values: Partial<RecipeLine>) {
    setLines((previous) => previous.map((line) => line.key === key ? { ...line, ...values } : line));
  }

  async function submit() {
    if (submitting.current || !valid) return;
    submitting.current = true;
    setError('');
    try {
      await save.mutateAsync({
        id: recipe.id || undefined, expectedUpdatedAt, requestKey, name: name.trim(), category: category.trim() || null,
        unit, mode, instructions, outputQuantity: amount(output), outputUnit,
        items: lines.map((line) => ({
          ingredientId: line.ingredientId, quantity: amount(line.gross), unit: line.unit,
          netAmount: amount(line.net), processingMethod: line.method || null,
        })),
      });
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      submitting.current = false;
    }
  }

  const locked = !editable || save.isPending;
  const currentCosts = lines.map((line) => {
    const ingredient = available.find((item) => item.id === line.ingredientId);
    if (!ingredient || !positive(line.gross)) return null;
    if (ingredient.preparationMode === 'virtual' && ingredient.isPrepared) {
      return ingredient.recipeUnitCost == null ? null
        : ingredient.recipeUnitCost * amount(line.gross) * unitFactor(line.unit) / unitFactor(ingredient.displayUnit);
    }
    return ingredient.avgCostBase == null ? null : ingredient.avgCostBase * amount(line.gross) * unitFactor(line.unit);
  });
  const total = currentCosts.length && currentCosts.every((value) => value != null)
    ? money(currentCosts.reduce<number>((sum, value) => sum + (value ?? 0), 0)) : 'Неизвестно';
  const footer = editable ? <View style={styles.row}>
    <Button title="Сохранить" disabled={!valid} loading={save.isPending} onPress={() => void submit()} />
    {showCosts ? <Text style={styles.muted}>{'Себестоимость: ' + total}</Text> : null}
  </View> : null;

  return <WarehouseWorkspace title={recipe.id ? 'Редактирование полуфабриката' : 'Добавление полуфабриката'} onClose={close} footer={footer}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={styles.stack}>
        <Field label="Название" value={name} onChangeText={setName} maxLength={120} editable={!locked} />
        <Field label="Процесс приготовления" value={instructions} onChangeText={setInstructions} maxLength={12000} editable={!locked} multiline />
      </Card>
      <Card style={styles.stack}>
        <Text style={styles.heading} translate>Состав</Text>
        {query.isPending ? <ActivityIndicator color={colors.primary} /> : null}
        {query.isError ? <QueryError error={query.error} retry={() => void query.refetch()} /> : null}
        {lines.map((line, index) => {
          const ingredient = available.find((item) => item.id === line.ingredientId);
          const choices = available.filter(({ id }) => id === line.ingredientId || !lines.some((item) => item.ingredientId === id))
            .map(({ id, name: label }) => ({ value: id, label, translate: false }));
          if (line.ingredientId && !ingredient) choices.push({
            value: line.ingredientId, label: recipe.items.find((item) => item.ingredientId === line.ingredientId)?.name ?? 'Недоступный ингредиент', translate: false,
          });
          return <View key={line.key} style={[styles.stack, styles.separator]}>
            <Select title="Ингредиент" value={line.ingredientId} disabled={locked} options={choices} onChange={(id) => {
              const next = available.find((item) => item.id === id);
              if (next) patch(line.key, { ingredientId: id, unit: next.displayUnit, net: line.gross, lossPercent: 0, method: '' });
            }} />
            <Select title="Метод приготовления" value={line.method} options={methods} disabled={locked} onChange={(method) => {
              const lossPercent = (method && ingredient?.processingLosses?.[method]) || 0;
              patch(line.key, { method, lossPercent, net: netOf(line.gross, lossPercent) });
            }} />
            <View style={styles.row}>
              <Field label="Брутто" value={line.gross} editable={!locked} keyboardType="decimal-pad" containerStyle={styles.grow}
                onChangeText={(gross) => patch(line.key, { gross, net: netOf(gross, line.lossPercent) })} />
              <Field label="Нетто" value={line.net} editable={!locked} keyboardType="decimal-pad" containerStyle={styles.grow}
                onChangeText={(net) => patch(line.key, { net, lossPercent: positive(line.gross) && amount(net) >= 0 && amount(net) <= amount(line.gross)
                  ? (1 - amount(net) / amount(line.gross)) * 100 : line.lossPercent })} />
              <View style={styles.unit}><Select title="Единица" value={line.unit} options={unitsForType(ingredient?.unitType ?? unitTypeOf(line.unit))}
                disabled={locked} onChange={(next) => {
                  const ratio = unitFactor(line.unit) / unitFactor(next);
                  patch(line.key, { unit: next, gross: convert(line.gross, ratio), net: convert(line.net, ratio) });
                }} /></View>
            </View>
            <View style={styles.row}>
              {showCosts ? <Text style={[styles.muted, styles.grow]}>{currentCosts[index] == null ? '—' : money(currentCosts[index]!)}</Text> : null}
              {!locked ? <Button title="Убрать позицию" size="md" variant="secondary" onPress={() => setLines((previous) => previous.filter((item) => item.key !== line.key))} /> : null}
            </View>
          </View>;
        })}
        {!locked ? <Button title="Добавить" variant="secondary" onPress={() => setLines((previous) => [...previous, {
          key: randomUUID(), ingredientId: '', gross: '', net: '', unit: 'kg', method: '', lossPercent: 0,
        }])} /> : null}
      </Card>
      <Card style={styles.stack}>
        <View style={styles.row}>
          <Field label="Выход" value={output} onChangeText={setOutput} editable={!locked} keyboardType="decimal-pad" containerStyle={styles.grow} />
          <View style={styles.unit}><Select title="Единица выхода" value={outputUnit} options={unitsForType(unitTypeOf(unit))}
            disabled={locked} onChange={(next) => { setOutput(convert(output, unitFactor(outputUnit) / unitFactor(next))); setOutputUnit(next); }} /></View>
        </View>
        {!recipe.id ? <Select title="Единица учёта" value={unit} options={UNIT_OPTIONS} disabled={locked} onChange={(next) => {
          setUnit(next);
          if (unitTypeOf(outputUnit) !== unitTypeOf(next)) setOutputUnit(next);
        }} /> : null}
        <Field label="Категория ингредиентов" value={category} onChangeText={setCategory} maxLength={120} editable={!locked} />
        {canStock ? <Select title="Режим учёта" value={mode} disabled={locked} options={[
          { value: 'virtual', label: 'По рецепту' }, { value: 'stocked', label: 'Хранить на складе' },
        ]} onChange={setMode} /> : null}
      </Card>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return <View style={styles.stack}>
    <Text style={styles.error} accessibilityRole="alert">{apiError(error)}</Text>
    <Button title="Повторить" variant="secondary" size="md" onPress={retry} />
  </View>;
}

const unitFactor = (unit: UnitCode) => ALL_UNITS.find(({ code }) => code === unit)?.factor ?? 1;
const amount = (value: string) => value.trim() ? Number(value.trim().replace(',', '.')) : NaN;
const positive = (value: string) => Number.isFinite(amount(value)) && amount(value) > 0;
const convert = (value: string, ratio: number) => Number.isFinite(amount(value)) ? String(amount(value) * ratio) : value;
const netOf = (gross: string, loss: number) => convert(gross, 1 - loss / 100);

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  content: { gap: spacing.md, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  unit: { width: 136 },
  separator: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  heading: { fontWeight: '600' },
  muted: { color: colors.textMuted },
  link: { color: colors.primary },
  error: { color: colors.danger },
});
