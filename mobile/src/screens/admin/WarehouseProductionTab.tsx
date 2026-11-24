import React, { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as Print from 'expo-print';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { qty, usePreparedIngredients, type PreparedIngredient, type WarehouseLocation } from '@/services/api/warehouse';
import {
  useProductionBatch, useProductionJournal, useProductionMutations, type ProductionBatch,
} from '@/services/api/warehouseProduction';
import { unitLabel } from '@/services/api/warehouseUnits';
import { useAuth } from '@/store/auth';
import { colors, radius, spacing } from '@/theme';
import { money } from '@/utils/format';
import { warehouseLocalTime, warehouseTimeDisplay } from '@/utils/warehouseTiming';
import { PreparationBatchSheet } from './PreparationBatchEditor';
import { WarehouseWorkspace } from './WarehouseWorkspace';
import {
  WarehouseDirectoryLink, WarehouseDirectorySearch, WarehouseDirectoryTable, WarehouseDirectoryValue, type DirectoryColumn,
} from './WarehouseDirectoryTable';

type Editor = { kind: 'choose' } | { kind: 'produce'; item: PreparedIngredient } | { kind: 'batch'; id: string };
type Props = { warehouseId?: string; locations: WarehouseLocation[]; warehouseFilter?: React.ReactNode };

export function WarehouseProductionTab({ warehouseId, locations, warehouseFilter }: Props) {
  const { canAction } = usePermissions();
  const canProduce = canAction('warehouseProduce');
  const scope = warehouseId ?? locations.find((item) => item.isDefault)?.id ?? locations[0]?.id;
  const query = useProductionJournal(scope, canProduce && !!scope);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const searchTerm = search.trim().toLocaleLowerCase();
  const rows = (query.data ?? []).filter(({ ingredientName }) => ingredientName.toLocaleLowerCase().includes(searchTerm));
  const close = () => setEditor(null);
  const openBatch = (id: string) => setEditor({ kind: 'batch', id });
  if (!canProduce) return null;
  const columns: DirectoryColumn<ProductionBatch>[] = [
    { key: 'date', title: 'Дата', width: 146, cell: (batch) => <WarehouseDirectoryValue>{productionDate(batch.producedAt)}</WarehouseDirectoryValue> },
    { key: 'preparation', title: 'Полуфабрикат', width: 185,
      cell: (batch) => <WarehouseDirectoryLink label={batchTitle(batch)} onPress={() => openBatch(batch.id)} /> },
    { key: 'quantity', title: 'Количество', width: 116, cell: (batch) =>
      <WarehouseDirectoryValue>{qty(batch.actualQuantity, unitLabel(batch.unit))}</WarehouseDirectoryValue> },
    { key: 'status', title: 'Статус', width: 125, cell: (batch) =>
      <Text style={[styles.status, { color: batch.reversedAt ? colors.warning : colors.success }]} translate>{batchStatus(batch)}</Text> },
    { key: 'actions', width: 82, cell: (batch) => <WarehouseDirectoryLink label="Открыть" onPress={() => openBatch(batch.id)}
      accessibilityLabel={`Открыть: ${batchTitle(batch)}`} translate /> },
  ];

  return <View style={styles.surface}>
    <View style={styles.toolbar}>
      <View style={styles.search}><WarehouseDirectorySearch label="Поиск производства" value={search} onChange={setSearch} /></View>
      {warehouseFilter ? <View style={styles.filter}>{warehouseFilter}</View> : null}
      <Button title="Произвести" size="md" disabled={!scope} onPress={() => setEditor({ kind: 'choose' })} />
    </View>
    {scope && query.isPending ? <ActivityIndicator color={colors.primary} /> : null}
    {query.isError ? <ProductionError message={apiError(query.error)} retry={() => void query.refetch()} /> : null}
    <WarehouseDirectoryTable rows={rows} columns={columns} />
    {query.isSuccess && rows.length === 0 ? <Text style={styles.empty} translate>
      {searchTerm ? 'Производства не найдены. Измените поиск.' : 'Производств пока нет.'}
    </Text> : null}
    {editor?.kind === 'choose' ? <ChoosePreparation warehouseId={scope} onClose={close}
      onChoose={(item) => setEditor({ kind: 'produce', item })} /> : null}
    {editor?.kind === 'produce' ? <PreparationBatchSheet item={editor.item} warehouseId={scope} fixedWarehouse locations={locations}
      onClose={close} onBatch={openBatch} /> : null}
    {editor?.kind === 'batch' ? <ProductionBatchPage key={editor.id} id={editor.id} locations={locations} onClose={close} /> : null}
  </View>;
}

function ChoosePreparation({ warehouseId, onClose, onChoose }: {
  warehouseId?: string; onClose: () => void; onChoose: (item: PreparedIngredient) => void;
}) {
  const query = usePreparedIngredients(warehouseId);
  const [search, setSearch] = useState('');
  const filter = search.trim().toLocaleLowerCase();
  const options = (query.data ?? []).filter((item) => item.mode !== 'virtual' && item.name.toLocaleLowerCase().includes(filter));
  return <WarehouseWorkspace title="Приготовить заготовку" onClose={onClose}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Field value={search} onChangeText={setSearch} placeholder="Название заготовки" accessibilityLabel="Поиск заготовки" />
      {query.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {query.isError ? <ProductionError message={apiError(query.error)} retry={() => void query.refetch()} /> : null}
      {options.map((item) => <FastPressable key={item.id} accessibilityRole="button" style={styles.choice}
        onPress={() => onChoose(item)}><Text style={styles.choiceText}>{item.name}</Text></FastPressable>)}
      {query.isSuccess && options.length === 0 ? <Text style={styles.muted} translate>
        {filter ? 'Заготовки не найдены.' : 'Добавьте товар с типом «Полуфабрикат», выберите учёт партиями и заполните рецептуру.'}
      </Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

export function ProductionBatchPage({ id, locations, onClose }: { id: string; locations: WarehouseLocation[]; onClose: () => void }) {
  const { canAction } = usePermissions();
  const role = useAuth((state) => state.user?.role);
  const query = useProductionBatch(id);
  const { reverse } = useProductionMutations();
  const reversing = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const batch = query.data;
  const canReverse = (role === 'OWNER' || role === 'ADMIN') && canAction('warehouseApprove');
  const showCosts = canAction('warehouseCosts');
  const location = locations.find((item) => item.id === batch?.warehouseId)?.name;

  async function reverseBatch() {
    if (!canReverse || !batch || batch.reversedAt || !reason.trim() || reversing.current) return;
    reversing.current = true;
    setError('');
    try {
      await reverse.mutateAsync({ id, reason: reason.trim() });
      setConfirm(false);
      setReason('');
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      reversing.current = false;
    }
  }

  function close() {
    if (reversing.current) return;
    if (confirm) {
      setConfirm(false);
      setReason('');
      setError('');
    } else onClose();
  }

  return <WarehouseWorkspace title={batch ? `Производство · ${batch.ingredientName}` : 'Производственная партия'} onClose={close}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {query.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {query.isError ? <ProductionError message={apiError(query.error)} retry={() => void query.refetch()} /> : null}
      {batch ? <>
        <Card style={styles.stack}>
          {batch.reversedAt ? <Text style={styles.warning}>{`Проведение отменено: ${batch.reverseReason ?? '—'}`}</Text> : null}
          <Text style={styles.muted}>{`${batch.batchNumber ?? batch.id} · ${warehouseTimeDisplay(batch.producedAt)}`}</Text>
          {location ? <Detail label="Склад" value={location} /> : null}
          <View style={styles.quantities}>
            <BatchQuantity label="План" value={qty(batch.plannedQuantity, unitLabel(batch.unit))} />
            <BatchQuantity label="Факт" value={qty(batch.actualQuantity, unitLabel(batch.unit))} />
            <BatchQuantity label="Отклонение" value={qty(batch.yieldDifference, unitLabel(batch.unit))} />
            {showCosts ? <BatchQuantity label="Себестоимость" value={cost(batch.totalCost)} /> : null}
          </View>
          {batch.expiresAt ? <Detail label="Годен до" value={warehouseTimeDisplay(batch.expiresAt)} /> : null}
        </Card>
        <Card style={styles.stack}>
          <Text style={styles.heading} translate>Фактически использовано</Text>
          {batch.items?.actual?.map((item) => <Detail key={item.ingredientId} label={item.name} translateLabel={false}
            value={`${qty(item.quantity, unitLabel(item.unit))}${showCosts ? ` · ${cost(item.cost)}` : ''}`} />)}
        </Card>
        {canReverse && !batch.reversedAt ? <Card style={styles.stack}>
          {confirm ? <>
            <Field label="Причина отмены проведения производства" value={reason} onChangeText={setReason}
              maxLength={1000} multiline editable={!reverse.isPending} />
            <View style={styles.actions}>
              <Button title="Отменить проведение" variant="danger" size="md" disabled={!reason.trim()}
                loading={reverse.isPending} onPress={() => void reverseBatch()} />
              <Button title="Назад" variant="secondary" size="md" disabled={reverse.isPending} onPress={close} />
            </View>
          </> : <Button title="Отменить проведение" variant="secondary" size="md" onPress={() => { setError(''); setConfirm(true); }} />}
        </Card> : null}
        <View style={styles.actions}><Button icon="adminPrinter" title="Печать" variant="secondary" size="md"
          onPress={() => { setError(''); void printBatch(batch, location, showCosts).catch((failure) => setError(apiError(failure))); }} /></View>
      </> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

function BatchQuantity({ label, value }: { label: string; value: string }) {
  return <View style={styles.quantity}><Text style={styles.muted} translate>{label}</Text>
    <Text style={styles.heading}>{value}</Text></View>;
}

function Detail({ label, value, translateLabel = true }: { label: string; value: string; translateLabel?: boolean }) {
  return <View style={styles.spread}>
    <Text style={[styles.muted, styles.grow]} translate={translateLabel}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>;
}

function ProductionError({ message, retry }: { message: string; retry: () => void }) {
  return <View style={styles.stack}>
    <Text accessibilityRole="alert" style={styles.error}>{message}</Text>
    <Button title="Повторить" variant="secondary" size="md" onPress={retry} />
  </View>;
}

function productionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const { date: day, time } = warehouseLocalTime(date);
  const includeYear = day.slice(0, 4) !== warehouseLocalTime().date.slice(0, 4);
  const localDate = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Bishkek',
    year: includeYear ? 'numeric' : undefined });
  return `${localDate}, ${time}`;
}
const batchTitle = ({ ingredientName, batchNumber }: ProductionBatch) => batchNumber ? `${ingredientName} · № ${batchNumber}` : ingredientName;
const batchStatus = ({ reversedAt }: ProductionBatch) => reversedAt ? 'Сторнирована' : 'Проведена';
const cost = (value: number | string | null) => value == null ? 'Неизвестно' : money(value);

function escape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function printBatch(batch: ProductionBatch, location: string | undefined, showCosts: boolean) {
  const unit = unitLabel(batch.unit);
  const metadata = [
    ['Партия', batch.batchNumber ?? batch.id], ['Дата', productionDate(batch.producedAt)],
    ['Склад', location], ['План', qty(batch.plannedQuantity, unit)], ['Факт', qty(batch.actualQuantity, unit)],
    ['Отклонение', qty(batch.yieldDifference, unit)], ['Себестоимость', showCosts ? cost(batch.totalCost) : undefined],
    ['Годен до', batch.expiresAt ? productionDate(batch.expiresAt) : undefined],
    ['Статус', batch.reversedAt ? `Сторнирована · ${batch.reverseReason ?? '—'}` : 'Проведена'],
  ].map(([label, value]) => value ? `<p>${label}: ${escape(value)}</p>` : '').join('');
  const items = (batch.items?.actual ?? []).map((item) => (
    `<li>${escape(item.name)} · ${escape(qty(item.quantity, unitLabel(item.unit)))}${showCosts ? ` · ${escape(cost(item.cost))}` : ''}</li>`
  )).join('');
  return Print.printAsync({ html: `<!doctype html><html lang="ru"><head><meta charset="UTF-8"></head><body>
    <h1>Производство · ${escape(batch.ingredientName)}</h1>${metadata}<h2>Фактически использовано</h2><ul>${items}</ul></body></html>` });
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  surface: { borderRadius: radius.lg, backgroundColor: colors.card },
  content: { gap: spacing.md, padding: spacing.md },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  search: { flexGrow: 1, flexBasis: 170, maxWidth: 300 },
  filter: { minWidth: 118, flexGrow: 1, flexBasis: 120, maxWidth: 240 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 8,
    minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  choiceText: { fontSize: 14, color: colors.textPrimary },
  spread: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  quantities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quantity: { flexBasis: '47%', flexGrow: 1, gap: 3 },
  grow: { flex: 1 },
  value: { flexShrink: 1, textAlign: 'right' },
  heading: { fontWeight: '600' },
  muted: { color: colors.textMuted },
  status: { fontSize: 13, fontWeight: '500' },
  empty: { padding: spacing.xl, textAlign: 'center', color: colors.textMuted },
  warning: { color: colors.warning },
  error: { color: colors.danger },
});
