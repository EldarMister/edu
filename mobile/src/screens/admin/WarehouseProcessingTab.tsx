import React, { useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { DateField } from '@/components/DateField';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select, type SelectOption } from '@/components/Select';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { Alert, Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { qty, useIngredients, type Ingredient, type WarehouseLocation } from '@/services/api/warehouse';
import {
  useProcessingDocument, useProcessingMutations, useWarehouseProcessing, type ProcessingDocument,
  type ProcessingLine, type ProcessingValues,
} from '@/services/api/warehouseProcessing';
import { unitTypeOf, unitsForType } from '@/services/api/warehouseUnits';
import { useNotifications } from '@/store/notifications';
import { colors, fontSize, radius, spacing } from '@/theme';
import { isAllowedDate, parseIsoDate } from '@/utils/calendarDate';
import { allocatedProcessingShare, changeProcessingUnit, processingDraftRow, processingRowsInput, type ProcessingDraftRow } from '@/utils/warehouseProcessingForm';
import { warehouseDateTimeIso, warehouseLocalTime, warehouseReportRange, warehouseTimeDisplay, type WarehousePeriod } from '@/utils/warehouseTiming';
import { WarehouseDateTimeField } from './WarehouseTimingField';
import { WarehouseWorkspace } from './WarehouseWorkspace';

const periods: SelectOption<WarehousePeriod>[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: 'week', label: 'Последние 7 дней' },
  { value: 'month', label: 'Последние 30 дней' },
  { value: 'currentMonth', label: 'Этот месяц' },
  { value: 'lastMonth', label: 'Прошлый месяц' },
  { value: 'all', label: 'За всё время' },
  { value: 'custom', label: 'Выбрать период' },
];
const statuses = { draft: 'Черновик', posted: 'Проведена', reversed: 'Проведение отменено' } as const;
const formatPrice = (value: number | null | undefined) => value == null ? '—'
  : value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' с';
const rowSummary = (rows: ProcessingLine[]) =>
  rows.map((line) => line.name + ' · ' + qty(line.quantity, line.unitLabel)).join(', ') || '—';
const pageSize = 25;

type ProcessingScope = { warehouseId?: string; locations: WarehouseLocation[] };

export function WarehouseProcessingTab({ warehouseId, locations, warehouseFilter, onResetWarehouse }: ProcessingScope & {
  warehouseFilter?: ReactNode;
  onResetWarehouse?: () => void;
}) {
  const { canAction } = usePermissions();
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<WarehousePeriod>('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ id?: string } | null>(null);
  const today = warehouseLocalTime().date;
  const validRange = period !== 'custom' || (isAllowedDate(custom.from, undefined, custom.to || today) && isAllowedDate(custom.to, custom.from, today));
  const range = warehouseReportRange(period, new Date(), custom);
  const from = range.from && validRange ? warehouseDateTimeIso({ date: range.from, time: '00:00' }) : undefined;
  const endMinute = range.to && validRange ? warehouseDateTimeIso({ date: range.to, time: '23:59' }) : undefined;
  const to = endMinute ? new Date(Date.parse(endMinute) + 59_999).toISOString() : undefined;
  const query = useWarehouseProcessing({ warehouseId, search: search.trim() || undefined, from, to }, validRange);
  const documents = query.data ?? [];
  const pageCount = Math.max(1, Math.ceil(documents.length / pageSize));
  const currentPage = Math.min(page, pageCount);

  function choosePeriod(value: WarehousePeriod) {
    if (value === 'custom' && !custom.from && !custom.to) {
      const startingRange = period === 'all' ? warehouseReportRange('month') : range;
      setCustom({ from: startingRange.from ?? today, to: startingRange.to ?? today });
    }
    setPeriod(value);
    setPage(1);
  }

  return <View style={styles.stack}>
    <Card style={styles.registrySurface}>
      <View style={styles.registryToolbar}>
        <Field value={search} placeholder="Поиск..." accessibilityLabel="Поиск переработок" containerStyle={styles.searchContainer}
          style={styles.search} maxLength={160}
          onChangeText={(value) => { setSearch(value); setPage(1); }} />
        <Select title="Период" value={period} options={periods} onChange={choosePeriod} style={styles.select} />
        {warehouseFilter}
        {canAction('warehouseProduce') && <Button title="Добавить" size="md" disabled={!locations.length} onPress={() => setEditor({})} />}
      </View>
      {period === 'custom' && <View style={styles.toolbar}>
        <DateField label="С даты" value={custom.from} maximumDate={parseIsoDate(custom.to || today) ?? undefined}
          containerStyle={styles.filter} onChangeText={(value) => { setCustom((range) => ({ ...range, from: value })); setPage(1); }} />
        <DateField label="По дату" value={custom.to} minimumDate={parseIsoDate(custom.from) ?? undefined}
          maximumDate={parseIsoDate(today) ?? undefined} containerStyle={styles.filter}
          onChangeText={(value) => { setCustom((range) => ({ ...range, to: value })); setPage(1); }} />
      </View>}
      {(search || period !== 'month' || warehouseId) && <InlineProcessingAction label="Сбросить всё" onPress={() => {
        setSearch(''); setPeriod('month'); setCustom({ from: '', to: '' }); setPage(1); onResetWarehouse?.();
      }} />}
      {!validRange && <Text style={styles.muted}>Укажите начало и конец периода.</Text>}
      {validRange && query.isPending && <ActivityIndicator color={colors.primary} />}
      {validRange && query.isError && <QueryError error={query.error} retry={() => void query.refetch()} />}
      {validRange && query.isSuccess && (documents.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled">
          <View style={styles.register}>
            <View style={styles.registerRow}>
              <Text style={[styles.dateColumn, styles.muted]}>Дата</Text>
              <Text style={[styles.productsColumn, styles.muted]}>Исходные продукты</Text>
              <Text style={[styles.productsColumn, styles.muted]}>Полученные продукты</Text>
            </View>
            {documents.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((document) => (
              <View key={document.id} style={styles.registerRow}>
                <View style={styles.dateColumn}>
                  <FastPressable accessibilityRole="button" onPress={() => setEditor({ id: document.id })}>
                    <Text style={styles.link}>{warehouseTimeDisplay(document.date)}</Text>
                  </FastPressable>
                  {document.status !== 'posted' && <Text style={styles.muted}>{statuses[document.status]}</Text>}
                </View>
                <Text style={styles.productsColumn}>{rowSummary(document.inputs)}</Text>
                <Text style={styles.productsColumn}>{rowSummary(document.outputs)}</Text>
                <InlineProcessingAction label={document.status === 'draft' ? 'Ред.' : 'Открыть'}
                  onPress={() => setEditor({ id: document.id })} />
              </View>
            ))}
          </View>
        </ScrollView>
      ) : <View style={styles.empty}>
        <Text style={styles.heading} translate>{search || period !== 'all' ? 'Ничего не найдено' : 'Здесь будут переработки'}</Text>
        <Text style={styles.muted} translate>{search || period !== 'all' ? 'Попробуйте изменить поиск или период.' : 'Нажмите «Добавить», чтобы создать первую переработку.'}</Text>
      </View>)}
    </Card>
    {validRange && query.isSuccess && pageCount > 1 && <View style={styles.toolbar}>
      <Button title="Назад" size="md" variant="secondary" disabled={currentPage === 1} onPress={() => setPage(currentPage - 1)} />
      <Text>{currentPage} / {pageCount}</Text>
      <Button title="Далее" size="md" variant="secondary" disabled={currentPage === pageCount} onPress={() => setPage(currentPage + 1)} />
    </View>}
    {editor && <ProcessingEditor key={editor.id ?? 'new'} {...{ warehouseId, locations }} id={editor.id} onClose={() => setEditor(null)} />}
  </View>;
}

export function ProcessingEditor({ id, warehouseId, locations, onClose }: ProcessingScope & { id?: string; onClose: () => void }) {
  const query = useProcessingDocument(id ?? null);
  if (id && !query.data) return <WarehouseWorkspace title="Переработка" onClose={onClose} pending={query.isPending}>
    {query.isError ? <View style={styles.content}><QueryError error={query.error} retry={() => void query.refetch()} /></View> : null}
  </WarehouseWorkspace>;
  return <ProcessingForm initialDocument={query.data} warehouseId={warehouseId} locations={locations} onClose={onClose} />;
}

const emptyRow = (warehouseId: string, share = ''): ProcessingDraftRow => ({
  key: randomUUID(), ingredientId: '', warehouseId, name: '', quantity: '', unit: 'kg', share,
});
const workingValues = (date: string | undefined, note: string, inputs: ProcessingDraftRow[], outputs: ProcessingDraftRow[]) =>
  JSON.stringify([date, note, inputs.map(rowValues), outputs.map(rowValues)]);
const rowValues = ({ ingredientId, quantity, unit, warehouseId, share }: ProcessingDraftRow) =>
  [ingredientId, quantity, unit, warehouseId, share];

function ProcessingForm({ initialDocument, warehouseId, locations, onClose }: ProcessingScope & {
  initialDocument?: ProcessingDocument; onClose: () => void;
}) {
  const { canAction } = usePermissions();
  const notify = useNotifications((state) => state.push);
  const defaultId = warehouseId ?? locations.find((location) => location.isDefault)?.id ?? locations[0]?.id ?? '';
  const [document, setDocument] = useState(initialDocument);
  const [date, setDate] = useState(() => warehouseLocalTime(document?.date));
  const [note, setNote] = useState(document?.note ?? '');
  const [inputs, setInputs] = useState(() => document?.inputs.length ? document.inputs.map(processingDraftRow) : [emptyRow(defaultId)]);
  const [outputs, setOutputs] = useState(() => document?.outputs.length ? document.outputs.map(processingDraftRow) : [emptyRow(defaultId, '100')]);
  const [savedValues, setSavedValues] = useState(() => workingValues(warehouseDateTimeIso(date, document?.date), note, inputs, outputs));
  const [requestKey] = useState(() => randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const busy = useRef(false);
  const { save, transition } = useProcessingMutations();
  const editable = (!document || document.status === 'draft') && canAction('warehouseProduce');
  const catalogue = useIngredients('', undefined, editable);
  const eligible = useMemo(() => (catalogue.data ?? []).filter((item) => item.isActive && item.preparationMode !== 'virtual'), [catalogue.data]);
  const timestamp = warehouseDateTimeIso(date, document?.date);
  const values = workingValues(timestamp, note, inputs, outputs);
  const dirty = editable && values !== savedValues;
  const stale = !!document && !!initialDocument && document.revision < initialDocument.revision;
  const share = allocatedProcessingShare(outputs);
  const locationOptions = locations.map(({ id, name }) => ({ value: id, label: name, translate: false }));

  function adopt(saved: ProcessingDocument) {
    const nextInputs = saved.inputs.length ? saved.inputs.map(processingDraftRow) : [emptyRow(defaultId)];
    const nextOutputs = saved.outputs.length ? saved.outputs.map(processingDraftRow) : [emptyRow(defaultId, '100')];
    setDocument(saved);
    setDate(warehouseLocalTime(saved.date));
    setNote(saved.note ?? '');
    setInputs(nextInputs);
    setOutputs(nextOutputs);
    setSavedValues(workingValues(saved.date, saved.note ?? '', nextInputs, nextOutputs));
  }

  function close() {
    if (busy.current) return;
    if (!dirty) { onClose(); return; }
    Alert.alert('Закрыть переработку?', 'Несохранённые изменения будут сброшены.', [
      { text: 'Продолжить редактирование', style: 'cancel' },
      { text: 'Закрыть', style: 'destructive', onPress: onClose },
    ]);
  }

  async function saveDocument(complete: boolean) {
    if (busy.current || !editable || stale) return;
    if (!timestamp) { setError('Укажите дату и время переработки.'); return; }
    const input = processingRowsInput(inputs, false);
    const output = processingRowsInput(outputs, true);
    const validation = input.error || output.error || (complete && (!input.lines.length || !output.lines.length)
      ? 'Добавьте исходный и полученный продукт.'
      : complete && share !== 100 ? 'Распределите 100% себестоимости между полученными продуктами.' : '');
    if (validation) { setError(validation); return; }
    const payload: ProcessingValues = { date: timestamp, note: note.trim(), inputs: input.lines, outputs: output.lines };
    let draftSaved = false;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      let saved = document;
      if (!saved) {
        saved = await save.mutateAsync({ ...payload, complete, requestKey });
      } else if (dirty) {
        saved = await save.mutateAsync({ ...payload, id: saved.id, revision: saved.revision });
        adopt(saved);
        draftSaved = true;
      }
      if (complete && saved.status === 'draft') {
        saved = await transition.mutateAsync({ id: saved.id, revision: saved.revision, action: 'post' });
      }
      adopt(saved);
      notify({ message: complete ? 'Переработка проведена' : 'Черновик переработки сохранён', at: new Date().toISOString() });
      onClose();
    } catch (failure) {
      setError((draftSaved ? 'Изменения черновика сохранены. ' : '') + apiError(failure));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function reverse() {
    if (busy.current || document?.status !== 'posted' || !reason.trim() || stale || !canAction('warehouseApprove')) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const saved = await transition.mutateAsync({ id: document.id, revision: document.revision, action: 'reverse', note: reason.trim() });
      adopt(saved);
      notify({ message: 'Проведение переработки отменено', at: new Date().toISOString() });
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const showCost = canAction('warehouseCosts');
  const footer = <View style={styles.footer}>
    {editable ? <View style={styles.actions}>
      <Button title="Сохранить" size="md" disabled={pending || stale || !timestamp || !catalogue.isSuccess} onPress={() => void saveDocument(true)} />
      <Button title="Сохранить черновик" size="md" variant="secondary" disabled={pending || stale || !timestamp || !catalogue.isSuccess}
        onPress={() => void saveDocument(false)} />
    </View> : document && <Text style={styles.muted} translate>{statuses[document.status]}</Text>}
    {showCost && <Text style={styles.heading}>
      Итого: {editable && dirty || !document ? 'Рассчитается после сохранения' : formatPrice(document.totalCost)}
    </Text>}
  </View>;

  return <WarehouseWorkspace title={document ? 'Переработка' : 'Новая переработка'} onClose={close} footer={footer}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={styles.metadata}>
        {editable ? <>
          <WarehouseDateTimeField label="Дата и время" value={date} onChange={setDate} disabled={pending || stale} />
          <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={1000} multiline
            style={styles.note} editable={!pending && !stale} />
        </> : <>
          <Value label="Дата и время" value={document ? warehouseTimeDisplay(document.date) : '—'} />
          <Value label="Комментарий" value={note || '—'} />
        </>}
        {document && <Value label="Статус" value={statuses[document.status]} />}
        {document?.reversedAt && <Value label="Проведение отменено" value={warehouseTimeDisplay(document.reversedAt)} />}
        {document?.reverseReason && <Value label="Причина отмены" value={document.reverseReason} />}
      </Card>
      {stale && <Card style={styles.stack}>
        <Text style={styles.error}>Документ изменён другим сотрудником.</Text>
        <Button title="Загрузить актуальную версию" variant="secondary" disabled={pending} onPress={() => {
          if (!initialDocument) return;
          const load = () => { adopt(initialDocument); setError(''); };
          if (dirty) Alert.alert('Загрузить актуальную версию?', 'Несохранённые изменения будут сброшены.', [
            { text: 'Назад', style: 'cancel' }, { text: 'Загрузить', style: 'destructive', onPress: load },
          ]); else load();
        }} />
      </Card>}
      {editable && catalogue.isPending && <ActivityIndicator color={colors.primary} />}
      {editable && catalogue.isError && <QueryError error={catalogue.error} retry={() => void catalogue.refetch()} />}
      <LineGroup title="Исходные продукты" rows={inputs} onChange={setInputs} {...{ defaultId, eligible, locationOptions, editable, showCost }}
        disabled={pending || stale || (editable && !catalogue.isSuccess)} />
      <LineGroup title="Полученные продукты" output rows={outputs} onChange={setOutputs} {...{ defaultId, eligible, locationOptions, editable, showCost }}
        disabled={pending || stale || (editable && !catalogue.isSuccess)} />
      {editable && <Text style={styles.muted}>Распределено {share.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}% себестоимости. «Сохранить» проведёт переработку и изменит остатки. Черновик сохранит данные без изменения остатков.</Text>}
      {document?.status === 'posted' && canAction('warehouseApprove') && <Card style={styles.stack}>
        <Field label="Причина отмены" value={reason} onChangeText={setReason} editable={!pending && !stale} maxLength={2000} multiline />
        <Button title="Отменить проведение" variant="danger" disabled={pending || stale || !reason.trim()} onPress={() => {
          Alert.alert('Отменить проведение переработки?', 'Полученные продукты будут списаны, исходные продукты вернутся на склад.', [
            { text: 'Назад', style: 'cancel' },
            { text: 'Отменить проведение', style: 'destructive', onPress: () => void reverse() },
          ]);
        }} />
      </Card>}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

function LineGroup({ title, rows, onChange, defaultId, eligible, locationOptions, editable, disabled, showCost, output = false }: {
  title: string; rows: ProcessingDraftRow[]; onChange: (rows: ProcessingDraftRow[]) => void;
  defaultId: string; eligible: Ingredient[]; locationOptions: SelectOption<string>[];
  editable: boolean; disabled: boolean; showCost: boolean; output?: boolean;
}) {
  const productLabel = output ? 'Полученный продукт' : 'Исходный продукт';
  const productOptions = eligible.map((item) => ({
    value: item.id, label: item.name, translate: false, searchText: item.category ?? undefined,
  }));
  return <Card style={styles.products}>
    <Text style={styles.heading}>{title}</Text>
    {!rows.length && !editable && <Text style={styles.muted}>Нет продуктов</Text>}
    {rows.map((row) => {
      const update = (next: ProcessingDraftRow) => onChange(rows.map((line) => line.key === row.key ? next : line));
      const patch = (value: Partial<ProcessingDraftRow>) => update({ ...row, ...value, savedLine: undefined });
      const saved = row.savedLine;
      const location = locationOptions.find((option) => option.value === row.warehouseId);
      return <View key={row.key} style={styles.line}>
        {editable ? <>
          <View style={styles.lineHeading}>
            <View style={styles.filter}>
              <Select title={productLabel} placeholder={row.name || 'Выберите продукт'} searchable
                value={row.ingredientId} options={productOptions} disabled={disabled} style={styles.select}
                onChange={(id) => {
                  const item = eligible.find((entry) => entry.id === id);
                  if (item && id !== row.ingredientId) patch({ ingredientId: id, name: item.name, unit: item.displayUnit });
                }} />
            </View>
            <FastPressable style={styles.remove} accessibilityRole="button" accessibilityLabel="Удалить строку" disabled={disabled}
              onPress={() => onChange(rows.length > 1 ? rows.filter((line) => line.key !== row.key) : [emptyRow(defaultId, output ? '100' : '')])}>
              <PwaIcon name="close" size={16} color={colors.textMuted} />
            </FastPressable>
          </View>
          <View style={styles.stackSmall}>
            <Text style={styles.muted}>Склад</Text>
            <Select title="Склад продукта" placeholder="Выберите склад" value={row.warehouseId} options={locationOptions} disabled={disabled}
              style={styles.select} onChange={(value) => patch({ warehouseId: value })} />
          </View>
          <View style={styles.toolbar}>
            <Field label="Количество" value={row.quantity} onChangeText={(quantity) => patch({ quantity })} containerStyle={styles.filter}
              accessibilityLabel="Количество" keyboardType="decimal-pad" style={styles.numeric} editable={!disabled && !!row.ingredientId} />
            <View style={styles.filter}>
              <Text style={styles.muted}>Единица</Text>
              <Select title="Единица количества" value={row.unit} options={unitsForType(unitTypeOf(row.unit))}
                disabled={disabled || !row.ingredientId} style={styles.select} onChange={(unit) => update(changeProcessingUnit(row, unit))} />
            </View>
          </View>
          {output && <Field label="Пропорция себестоимости" accessibilityLabel="Доля себестоимости" value={row.share}
            onChangeText={(share) => patch({ share })} rightSlot={<Text style={styles.muted}>%</Text>}
            keyboardType="decimal-pad" style={styles.numeric} editable={!disabled && !!row.ingredientId} />}
        </> : <>
          <Text style={styles.heading}>{row.name}</Text>
          <Value label="Склад" value={saved?.warehouseName || location?.label || '—'} />
          <Value label="Количество" value={saved ? qty(saved.quantity, saved.unitLabel) : '—'} />
        </>}
        {showCost && row.ingredientId ? <View style={styles.stackSmall}>
          <Value label="Себестоимость" value={formatPrice(saved?.unitCost)} />
          {!editable && <Value label="Пропорция себестоимости" value={saved ? String(saved.costSharePercent) + '%' : '—'} />}
          <Value label="Итого" value={formatPrice(saved?.lineCost)} />
        </View> : null}
      </View>;
    })}
    {editable && <InlineProcessingAction label="+ Добавить" disabled={disabled || rows.length >= 200}
      onPress={() => onChange([...rows, emptyRow(defaultId, output ? rows.length ? '0' : '100' : '')])} />}
  </Card>;
}

function InlineProcessingAction({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <FastPressable style={styles.inlineAction} accessibilityRole="button" disabled={disabled} onPress={onPress}>
    <Text style={disabled ? styles.muted : styles.link} translate>{label}</Text>
  </FastPressable>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <View style={styles.valueRow}><Text style={styles.muted}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return <View style={styles.stackSmall}>
    <Text style={styles.error}>{apiError(error)}</Text>
    <Button title="Повторить" size="md" variant="secondary" onPress={retry} />
  </View>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  stack: { gap: spacing.md },
  stackSmall: { gap: spacing.xs },
  metadata: { padding: 12, gap: 12 },
  products: { padding: 12, gap: spacing.sm },
  registrySurface: { padding: 12, gap: spacing.sm },
  registryToolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  searchContainer: { flexBasis: '100%' },
  search: { height: 36, borderRadius: 20 },
  select: { height: 36, borderRadius: radius.sm, paddingHorizontal: 9 },
  numeric: { height: 36, borderRadius: radius.sm, textAlign: 'right' },
  note: { minHeight: 56, height: 'auto', textAlignVertical: 'top', borderRadius: radius.sm, paddingTop: 8, paddingBottom: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  filter: { flex: 1, gap: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  empty: { paddingVertical: spacing.xl, gap: spacing.sm, alignItems: 'center' },
  register: { minWidth: 800 },
  registerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 10 },
  dateColumn: { width: 152 },
  productsColumn: { width: 248, color: colors.textPrimary },
  heading: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  line: { gap: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
  lineHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  inlineAction: { minHeight: 32, alignSelf: 'flex-start', justifyContent: 'center' },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  link: { color: colors.primary },
  error: { color: colors.danger, fontSize: fontSize.sm },
  valueRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  value: { color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
});
