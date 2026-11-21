import React, { useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { DateField } from '@/components/DateField';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Alert, Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { qty, usePreparationRecipe, type PreparationRecipe, type PreparedIngredient, type WarehouseLocation } from '@/services/api/warehouse';
import { useProductionHistory, useProductionMutations } from '@/services/api/warehouseProduction';
import { ALL_UNITS, unitLabel, unitsForType, type UnitCode } from '@/services/api/warehouseUnits';
import { useNotifications } from '@/store/notifications';
import { colors, spacing } from '@/theme';
import { money } from '@/utils/format';
import { warehouseDateTimeIso, warehouseLocalTime, warehouseTimeDisplay } from '@/utils/warehouseTiming';
import { WarehouseDirectoryField } from './WarehouseDirectoryTable';
import { WarehouseWorkspace } from './WarehouseWorkspace';

type Props = {
  item: Pick<PreparedIngredient, 'id' | 'name'>;
  warehouseId?: string;
  fixedWarehouse?: boolean;
  locations: WarehouseLocation[];
  onClose: () => void;
  onBatch?: (id: string) => void;
};

export function PreparationBatchSheet({ item, warehouseId, fixedWarehouse, locations, onClose, onBatch }: Props) {
  const initialWarehouse = locations.find(({ id }) => id === warehouseId) ??
    locations.find(({ isDefault }) => isDefault) ?? locations[0];
  const query = usePreparationRecipe(item.id, initialWarehouse?.id);
  if (query.data) return <BatchForm key={item.id} recipe={query.data} initialWarehouse={initialWarehouse} fixedWarehouse={fixedWarehouse} locations={locations}
    onClose={onClose} onBatch={onBatch} />;
  return <WarehouseWorkspace title={`Производство · ${item.name}`} onClose={onClose}>
    <View style={styles.content}>
      {query.isError ? <>
        <Text accessibilityRole="alert" style={styles.error}>{apiError(query.error)}</Text>
        <Button title="Повторить" variant="secondary" size="md" onPress={() => void query.refetch()} />
      </> : <ActivityIndicator color={colors.primary} />}
    </View>
  </WarehouseWorkspace>;
}

function BatchForm({ recipe, initialWarehouse, fixedWarehouse, locations, onClose, onBatch }: {
  recipe: PreparationRecipe; initialWarehouse?: WarehouseLocation; fixedWarehouse?: boolean; locations: WarehouseLocation[];
  onClose: () => void; onBatch?: (id: string) => void;
}) {
  const { canAction } = usePermissions();
  const { produce } = useProductionMutations();
  const notify = useNotifications((state) => state.push);
  const wide = useWindowDimensions().width >= 640;
  const history = useProductionHistory(recipe.id);
  const submitting = useRef(false);
  const [requestKey] = useState(randomUUID);
  const [warehouseId, setWarehouseId] = useState(initialWarehouse?.id ?? '');
  const [quantity, setQuantity] = useState(String(recipe.outputQuantity));
  const [planned, setPlanned] = useState('');
  const [unit, setUnit] = useState(recipe.outputUnit);
  const [batchNumber, setBatchNumber] = useState('');
  const [expiry, setExpiry] = useState({ date: '', time: '' });
  const [actual, setActual] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');

  const warehouse = locations.find(({ id }) => id === warehouseId);
  const expiresAt = warehouseDateTimeIso(expiry);
  const actualOutput = amount(quantity);
  const plannedOutput = amount(planned || quantity);
  const scale = (plannedOutput * factor(unit)) / (recipe.outputQuantity * factor(recipe.outputUnit));
  const overridden = Object.keys(actual).length > 0;
  const expected = recipe.items.map(({ ingredientId, name, unit: itemUnit, quantity: recipeQuantity }) => ({
    ingredientId, name, unit: itemUnit, quantity: recipeQuantity * scale,
  }));
  const items = overridden ? expected.map(({ ingredientId, unit: itemUnit, quantity: standard }) => ({
    ingredientId, unit: itemUnit, quantity: ingredientId in actual ? amount(actual[ingredientId]) : standard,
  })) : undefined;
  const canProduce = recipe.items.length > 0 && recipe.mode !== 'virtual' && canAction('warehouseProduce');
  const hasExpiry = !!(expiry.date || expiry.time);
  const validExpiry = !hasExpiry || (!!expiresAt && Date.parse(expiresAt) > Date.now());
  const valid = canProduce && !!warehouse && positive(actualOutput) && positive(plannedOutput) &&
    (items?.every((item) => positive(item.quantity)) ?? true) && validExpiry;
  const dirty = warehouseId !== (initialWarehouse?.id ?? '') || quantity !== String(recipe.outputQuantity) ||
    !!planned || unit !== recipe.outputUnit || !!batchNumber || hasExpiry || overridden;

  function changeUnit(next: UnitCode) {
    const ratio = factor(unit) / factor(next);
    const convert = (value: string) => positive(amount(value)) ? String(amount(value) * ratio) : value;
    setQuantity(convert);
    setPlanned(convert);
    setUnit(next);
  }

  function close() {
    if (submitting.current) return;
    if (!dirty) { onClose(); return; }
    Alert.alert('Закрыть без сохранения?', 'Введённые данные будут потеряны.', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Закрыть', style: 'destructive', onPress: onClose },
    ]);
  }

  function openBatch(id: string) {
    if (!onBatch || submitting.current) return;
    if (!dirty) { onBatch(id); return; }
    Alert.alert('Открыть партию?', 'Введённые данные будут потеряны.', [
      { text: 'Продолжить редактирование', style: 'cancel' },
      { text: 'Открыть', onPress: () => onBatch(id) },
    ]);
  }

  async function submit() {
    if (submitting.current || !valid) return;
    submitting.current = true;
    setError('');
    try {
      const batch = await produce.mutateAsync({
        id: recipe.id, warehouseId, quantity: actualOutput, plannedQuantity: plannedOutput, unit, requestKey,
        items, batchNumber: batchNumber.trim() || undefined, expiresAt,
      });
      notify({
        message: canAction('warehouseCosts')
          ? `Партия готова · себестоимость ${batch.totalCost == null ? 'Неизвестно' : money(batch.totalCost)}`
          : 'Партия готова',
        at: new Date().toISOString(),
      });
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      submitting.current = false;
    }
  }

  const footer = canProduce ? <View style={styles.footer}>
    <Text style={styles.muted}>{`Выход: ${qty(Number.isFinite(actualOutput) ? actualOutput : 0, unitLabel(unit))}`}</Text>
    <View style={styles.actions}>
      <Button title="Провести производство" size="md" loading={produce.isPending} disabled={!valid} onPress={() => void submit()} />
      <Button title="Отмена" variant="secondary" size="md" disabled={produce.isPending} onPress={close} />
    </View>
  </View> : null;

  return <WarehouseWorkspace title={`Производство · ${recipe.name}`} onClose={close} footer={footer}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!recipe.items.length ? <Text style={styles.muted} translate>Сначала заполните рецептуру заготовки в её карточке.</Text>
        : recipe.mode === 'virtual' ? <Text style={styles.muted} translate>Эта заготовка раскрывается по рецепту при продаже. Для отдельного производства выберите режим с остатком в карточке товара.</Text>
          : <>
            <View style={styles.stack}>
              {!fixedWarehouse ? <WarehouseDirectoryField label="Склад" wide={wide}>
                <Select title="Склад" value={warehouseId} options={locations.map(({ id, name }) => (
                  { value: id, label: name, translate: false }
                ))} disabled={produce.isPending} onChange={setWarehouseId} />
              </WarehouseDirectoryField> : null}
              {warehouse ? <Text style={styles.muted}>{`Сырьё спишется со склада «${warehouse.name}», готовая партия поступит туда же.`}</Text> : null}
              <WarehouseDirectoryField label="Количество" wide={wide}>
                <View style={styles.row}>
                  <Field value={quantity} onChangeText={setQuantity} containerStyle={styles.grow} editable={!produce.isPending}
                    accessibilityLabel="Количество выпуска" keyboardType="decimal-pad" />
                  <View style={styles.unit}><Select title="Единица выхода партии" value={unit} options={unitsForType(recipe.unitType)}
                    disabled={produce.isPending} onChange={changeUnit} /></View>
                </View>
              </WarehouseDirectoryField>
            </View>
            <Card style={styles.stack}>
              <Disclosure label="Дополнительно" expanded={advanced} onPress={() => setAdvanced(!advanced)} />
              {advanced ? <>
                <Field label="Плановый выход (если отличается от фактического)" accessibilityLabel="Плановый выход"
                  value={planned} onChangeText={setPlanned} keyboardType="decimal-pad" editable={!produce.isPending} placeholder={quantity} />
                <Text style={styles.muted}>{`Отклонение: ${qty(Number.isFinite(actualOutput - plannedOutput) ? actualOutput - plannedOutput : 0, unitLabel(unit))}`}</Text>
                <Text style={styles.heading} translate>Фактический расход сырья</Text>
                {expected.map(({ ingredientId, name, unit: itemUnit, quantity: standard }) => {
                  const norm = Number.isFinite(standard) ? String(Number(standard.toFixed(3))) : '';
                  const input = actual[ingredientId] ?? norm;
                  const label = `${name}, ${unitLabel(itemUnit)} · по норме ${norm || '—'}`;
                  return <Field key={ingredientId} label={label} accessibilityLabel={label} editable={!produce.isPending}
                    value={input} onChangeText={(value) => setActual((values) => ({ ...values, [ingredientId]: value }))}
                    keyboardType="decimal-pad" />;
                })}
                <Field label="Номер партии" accessibilityLabel="Номер партии" maxLength={100}
                  editable={!produce.isPending} value={batchNumber} onChangeText={setBatchNumber} />
                <View style={styles.row}>
                  <DateField label="Годен до" value={expiry.date} containerStyle={styles.grow}
                    onChangeText={(date) => setExpiry((value) => ({ date, time: date ? value.time || '00:00' : '' }))}
                    minimumDate={new Date(warehouseLocalTime().date + 'T00:00:00')} />
                  <Field label="Время" accessibilityLabel="Время годности" editable={!produce.isPending}
                    value={expiry.time} onChangeText={(time) => setExpiry((value) => ({ ...value, time }))}
                    containerStyle={styles.unit} placeholder="ЧЧ:ММ" maxLength={5} />
                </View>
                {!validExpiry ? <Text style={styles.error} accessibilityRole="alert" translate>Укажите дату и время в будущем.</Text> : null}
              </> : null}
            </Card>
          </>}
      {onBatch && !!history.data?.length ? <Card style={styles.stack}>
        <Disclosure label="История производства" expanded={historyOpen} onPress={() => setHistoryOpen(!historyOpen)} />
        {historyOpen && history.data.map((batch) => (
          <FastPressable key={batch.id} accessibilityRole="button" style={styles.historyRow} onPress={() => openBatch(batch.id)}>
            <Text style={styles.grow}>{`${batch.batchNumber ?? 'Партия'} · ${warehouseTimeDisplay(batch.producedAt)}`}</Text>
            <Text>{qty(batch.actualQuantity, unitLabel(batch.unit))}</Text>
          </FastPressable>
        ))}
      </Card> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

function Disclosure({ label, expanded, onPress }: { label: string; expanded: boolean; onPress: () => void }) {
  return <FastPressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={styles.disclosure}>
    <PwaIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={16} color={colors.textMuted} />
    <Text style={styles.heading} translate>{label}</Text>
  </FastPressable>;
}

const unitFactors = new Map(ALL_UNITS.map((unit) => [unit.code, unit.factor]));
const factor = (unit: UnitCode) => unitFactors.get(unit) ?? 1;
const amount = (value: string) => Number(value.trim().replace(',', '.'));
const positive = (value: number) => Number.isFinite(value) && value >= 0.000001;

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.md },
  stack: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  grow: { flex: 1, minWidth: 0 },
  unit: { width: 124 },
  heading: { fontWeight: '600', color: colors.textPrimary },
  muted: { color: colors.textMuted },
  disclosure: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', minHeight: 36 },
  historyRow: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  error: { color: colors.danger },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
});
