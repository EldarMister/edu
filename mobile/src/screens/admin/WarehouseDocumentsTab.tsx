import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, FlatList, ScrollView, View } from '@/components/themed';
import { randomUUID } from 'expo-crypto';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Alert, Text, TextInput } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useStockDocument,
  useStockDocumentMutations,
  type StockDocument,
  type StockDocumentItem,
  type StockDocumentKind,
  type StockDocumentReason,
  type StockInventoryMode,
} from '@/services/api/stockDocuments';
import { qty, useIngredients, type WarehouseLocation } from '@/services/api/warehouse';
import { colors, fontSize, spacing } from '@/theme';
import { money } from '@/utils/format';
import { documentQuantities } from '@/utils/warehouseDocumentForm';
import { warehouseTimingFor, warehouseTimingValue, warehouseTimingError, warehouseTimeDisplay } from '@/utils/warehouseTiming';
import { WarehouseTimingField } from './WarehouseTimingField';
import { WarehouseWorkspace } from './WarehouseWorkspace';
import { useWarehouseWriteoffLines, WarehouseWriteoffLines } from './WarehouseWriteoffLines';
import { WarehouseDocumentRegister, type DocumentRegisterScope } from './WarehouseDocumentRegister';
import { WarehouseInventoryScope } from './WarehouseInventoryScope';

const STATUS_LABELS = { draft: 'Черновик', submitted: 'На утверждении', posted: 'Проведён', reversed: 'Сторнирован' } as const;
const MODE_OPTIONS: { value: StockInventoryMode; label: string }[] = [
  { value: 'full', label: 'Полная' },
  { value: 'partial', label: 'Частичная' },
];
const REASON_OPTIONS: { value: StockDocumentReason; label: string }[] = [
  { value: 'spoilage', label: 'Порча' },
  { value: 'expired', label: 'Просрочка' },
  { value: 'damage', label: 'Брак' },
  { value: 'staff_meal', label: 'Питание персонала' },
  { value: 'tasting', label: 'Дегустация' },
  { value: 'household', label: 'Хозяйственные нужды' },
  { value: 'other', label: 'Другое' },
];

const documentTitle = (kind: StockDocumentKind) => kind === 'inventory' ? 'Инвентаризация' : 'Списание';
const documentDate = warehouseTimeDisplay;
const reasonLabel = (reason: StockDocumentReason | null) => REASON_OPTIONS.find((option) => option.value === reason)?.label;
const modeLabel = (mode: StockInventoryMode | null) => MODE_OPTIONS.find((option) => option.value === mode)?.label;
const parseQuantity = (value: string) => Number(value.trim().replace(',', '.'));
type CountFilter = '' | 'uncounted' | 'differences' | 'shortage' | 'surplus';
const signedMoney = (value: number) => value < 0 ? `−${money(Math.abs(value))}` : value > 0 ? `+${money(value)}` : money(0);
const documentValue = (kind: StockDocumentKind, value: number) => kind === 'inventory' ? signedMoney(value) : money(Math.abs(value));

export function WarehouseDocumentsTab({ kind, ...scope }: DocumentRegisterScope & { kind: 'inventory' | 'writeoff' }) {
  const { canAction } = usePermissions();
  const canEdit = canAction(kind === 'inventory' ? 'warehouseCount' : 'warehouseWriteoff');
  const warehouse = scope.locations.find((location) => location.id === scope.warehouseId)
    ?? scope.locations.find((location) => location.isDefault) ?? scope.locations[0];
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string>();
  return <>
    <WarehouseDocumentRegister {...scope} kind={kind} showCost={canAction('warehouseCosts')}
      canCreate={canEdit} onCreate={warehouse ? () => setCreating(true) : undefined} onOpen={setOpenId} />
    {creating && warehouse ? <CreateDocumentSheet kind={kind} warehouse={warehouse} locations={scope.locations}
      onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
    {openId ? <DocumentSheet key={openId} id={openId} locations={scope.locations} onClose={() => setOpenId(undefined)} /> : null}
  </>;
}

function CreateDocumentSheet({ kind, warehouse, locations, onClose, onCreated }: {
  kind: 'inventory' | 'writeoff';
  warehouse: WarehouseLocation;
  locations: WarehouseLocation[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const inventory = kind === 'inventory';
  const { canAction } = usePermissions();
  const canApprove = canAction('warehouseApprove');
  const showCost = canAction('warehouseCosts');
  const { create } = useStockDocumentMutations();
  const [location, setLocation] = useState(warehouse.id);
  const [mode, setMode] = useState<StockInventoryMode>('full');
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState<StockDocumentReason | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [requestKey] = useState(() => randomUUID());
  const [timing, setTiming] = useState(() => warehouseTimingFor());
  const inFlight = useRef(false);
  const partial = inventory && mode === 'partial';
  const items = useIngredients('', location, partial);
  const writeoff = useWarehouseWriteoffLines(!inventory, location);
  const timingError = warehouseTimingError(timing);
  const draftReady = !!location && !timingError && (inventory ? !partial || (items.isSuccess && selected.length > 0) : writeoff.ready);
  const postReady = draftReady && (inventory || (!!reason && !!writeoff.enteredCount && (reason !== 'other' || !!note.trim())));
  const dirty = location !== warehouse.id || mode !== 'full' || selected.length > 0 || !!reason || !!note
    || timing.mode === 'past' || (!inventory && writeoff.dirty);
  const busy = create.isPending;

  function close() {
    if (inFlight.current) return;
    if (!dirty) onClose();
    else Alert.alert('Есть несохранённые изменения', 'Выйти без сохранения?', [
      { text: 'Продолжить', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: onClose },
    ]);
  }

  async function start(finalize: boolean) {
    if (inFlight.current || !(finalize ? postReady : draftReady)) return;
    const time = warehouseTimingValue(timing);
    if (time === undefined) return;
    inFlight.current = true;
    setError('');
    try {
      const document = await create.mutateAsync({ warehouseId: location, kind, requestKey, note: note.trim(),
        ...(inventory ? { mode, countedAt: time, items: partial ? selected.map((ingredientId) => ({ ingredientId, quantity: null })) : undefined }
          : { effectiveAt: time, reason: reason || null, sourceLines: writeoff.input(),
            finalize: finalize ? canApprove ? 'post' : 'submit' : undefined }) });
      if (inventory) onCreated(document.id);
      else onClose();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      inFlight.current = false;
    }
  }

  const footer = <View style={styles.actions}>
    <Button title={inventory ? 'Начать подсчёт' : canApprove ? 'Сохранить' : 'Отправить на утверждение'}
      size="md" style={styles.action} disabled={!postReady} loading={busy} onPress={() => void start(true)} />
    {!inventory && <Button title="Сохранить черновик" size="md" variant="secondary" style={styles.action}
      disabled={busy || !draftReady} onPress={() => void start(false)} />}
    {!inventory && showCost && <Text style={styles.footerTotal}>{timing.mode === 'past' ? 'Стоимость после проведения'
      : writeoff.calculating ? 'Итого: расчёт…' : writeoff.total == null ? 'Итого: стоимость неполная' : 'Итого: ' + money(writeoff.total)}</Text>}
  </View>;
  const noteLabel = reason === 'other' ? 'Уточните причину' : 'Комментарий';

  return <WarehouseWorkspace onClose={close} title={inventory ? 'Новая инвентаризация' : 'Новое списание'} footer={footer}>
    <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
      <Card style={styles.fields}>
        {!inventory && <WarehouseTimingField label="Дата списания" value={timing} onChange={setTiming} disabled={busy} />}
        <View style={styles.stack}>
          <Text style={styles.muted} translate>Склад</Text>
          <Select title="Склад документа" value={location} options={locations.map(({ id, name }) => ({ value: id, label: name, translate: false }))}
            onChange={(id) => { setLocation(id); setSelected([]); }} disabled={busy} />
        </View>
        {inventory ? <>
          <WarehouseTimingField label="Проверка остатков" value={timing} onChange={setTiming} disabled={busy} inventory />
          <View style={styles.stack}>
            <Text style={styles.muted} translate>Тип инвентаризации</Text>
            <View style={styles.segmented}>{MODE_OPTIONS.map((option) => <FastPressable key={option.value}
              style={[styles.segment, mode === option.value && styles.segmentActive]} accessibilityRole="button"
              accessibilityState={{ selected: mode === option.value, disabled: busy }} disabled={busy} onPress={() => setMode(option.value)}>
              <Text style={mode === option.value ? styles.status : styles.muted} translate>{option.label}</Text>
            </FastPressable>)}</View>
            <Text style={styles.muted} translate>{mode === 'full' ? 'Все продукты с остатком или движениями на выбранном складе.' : 'Выберите ниже продукты, которые будете проверять.'}</Text>
          </View>
        </> : <View style={styles.stack}>
          <Text style={styles.muted} translate>Причина</Text>
          <Select title="Причина списания" placeholder="Выберите причину" value={reason} onChange={setReason} options={REASON_OPTIONS} disabled={busy} />
        </View>}
        <Field label={noteLabel} value={note} onChangeText={setNote} multiline maxLength={1000} editable={!busy} style={styles.note} />
      </Card>
      {inventory ? <>
        {partial && <WarehouseInventoryScope key={location} products={(items.data ?? []).filter((item) => item.preparationMode !== 'virtual')}
          selected={selected} onChange={setSelected} disabled={busy} loading={items.isPending} error={items.error}
          onRetry={() => void items.refetch()} />}
        <Text style={styles.muted} translate>Начните подсчёт и внесите фактические остатки. Пустое поле означает «не посчитано». Для отсутствующего товара укажите 0.</Text>
      </> : <>
        <WarehouseWriteoffLines editor={writeoff} disabled={busy} showCost={showCost && timing.mode !== 'past'} />
        <Text style={styles.muted} translate>{canApprove ? '«Сохранить» проведёт документ и изменит остатки. Черновик сохраняет данные без изменения остатков.' : 'Черновик не меняет остатки. Они изменятся после утверждения документа.'}</Text>
      </>}
      <FormError message={error} />
    </ScrollView>
  </WarehouseWorkspace>;
}


export function DocumentSheet({ id, locations, onClose }: {
  id: string;
  locations: WarehouseLocation[];
  onClose: () => void;
}) {
  const query = useStockDocument(id, true);
  if (!query.data) {
    return (
      <WarehouseWorkspace onClose={onClose} title="Складской документ" pending={query.isPending}>
        {query.isError ? <QueryError error={query.error} retry={() => void query.refetch()} /> : null}
      </WarehouseWorkspace>
    );
  }
  return <DocumentForm key={id} incoming={query.data} warehouseName={locations.find((location) => location.id === query.data?.warehouseId)?.name} onClose={onClose} />;
}

function DocumentForm({ incoming, warehouseName, onClose }: {
  incoming: StockDocument;
  warehouseName?: string;
  onClose: () => void;
}) {
  const { save, transition } = useStockDocumentMutations();
  const { canAction } = usePermissions();
  const [document, setDocument] = useState(incoming);
  const canApprove = canAction('warehouseApprove');
  const showCost = canAction('warehouseCosts');
  const isInventory = document.kind === 'inventory';
  const isFull = document.mode === 'full';
  const isWriteoff = document.kind === 'writeoff';
  const editable = document.status === 'draft' && canAction(isInventory ? 'warehouseCount' : 'warehouseWriteoff');
  const reviewing = canApprove && document.status === 'submitted';
  const t = useT();
  const ingredients = useIngredients('', document.warehouseId, isInventory);
  const [localRows, setLocalRows] = useState<StockDocumentItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [countSearch, setCountSearch] = useState('');
  const [countFilter, setCountFilter] = useState<CountFilter>('');
  const [focusedCount, setFocusedCount] = useState<string>();
  const [removed, setRemoved] = useState<string[]>([]);
  const [note, setNote] = useState<string>();
  const [reason, setReason] = useState<StockDocumentReason>();
  const [error, setError] = useState('');
  const [editRevision, setEditRevision] = useState<number>();
  const [timing, setTiming] = useState(() => warehouseTimingFor(isInventory ? document.countedAt : document.effectiveAt));
  const [reverseReason, setReverseReason] = useState('');
  const writeoff = useWarehouseWriteoffLines(editable && isWriteoff, document.warehouseId, document);
  const inFlight = useRef(false);
  const pending = save.isPending || transition.isPending;
  const currentNote = note ?? document.note ?? '';
  const currentReason = reason ?? document.reason ?? '';
  const rows = useMemo(() => {
    const current = new Map([...(document.items ?? []), ...localRows].map((row) => [row.ingredientId, row]));
    return [...current.values()].filter((row) => !removed.includes(row.ingredientId));
  }, [document.items, localRows, removed]);
  const rowIds = new Set(rows.map((row) => row.ingredientId));
  const options = (ingredients.data ?? [])
    .filter((ingredient) => !rowIds.has(ingredient.id) && (ingredient.isActive || ingredient.stock !== 0))
    .filter((ingredient) => ingredient.preparationMode !== 'virtual')
    .map((ingredient) => ({ value: ingredient.id, label: ingredient.name, searchText: ingredient.category ?? undefined, translate: false }));
  const rawQuantity = (row: StockDocumentItem) => quantities[row.ingredientId] ?? (row.quantity == null ? '' : String(row.quantity));
  const itemValues = rows.map((row) => ({ ingredientId: row.ingredientId, value: rawQuantity(row).trim() }));
  const values = documentQuantities(itemValues, isInventory);
  const counted = itemValues.filter((item) => item.value !== '');
  const savedTime = (isInventory ? document.countedAt : document.effectiveAt) ?? null;
  const time = warehouseTimingValue(timing, savedTime);
  const timingChanged = time !== savedTime;
  const needsApplyTime = isInventory && (timingChanged || (!!time && localRows.length > 0));
  const validNumbers = (isWriteoff ? writeoff.ready : values.valid) && !warehouseTimingError(timing) && time !== undefined;
  const canSubmit = validNumbers && !needsApplyTime && (isWriteoff ? writeoff.enteredCount > 0 : values.canSubmit) &&
    (isInventory || (!!currentReason && (currentReason !== 'other' || !!currentNote.trim())));
  const dirty = editRevision !== undefined || timingChanged || (isWriteoff && writeoff.dirty);
  // The separately invalidated context query can briefly contain the revision from before our own save.
  const stale = incoming.revision > document.revision;
  const differences = rows.map((row) => {
    const value = rawQuantity(row);
    const counted = value.trim() !== '';
    const current = parseQuantity(value);
    const difference = needsApplyTime || !counted || !Number.isFinite(current) || row.expected == null ? 0 : current - row.expected;
    return { row, counted, variance: Math.sign(difference) * Math.round(Math.abs(difference) * 1_000_000) };
  });
  const shortageCount = differences.filter((entry) => entry.variance < 0).length;
  const surplusCount = differences.filter((entry) => entry.variance > 0).length;
  const searchText = countSearch.trim().toLocaleLowerCase('ru');
  const catalog = new Map((ingredients.data ?? []).map((item) => [item.id, item]));
  const visibleCounts = differences.filter(({ row, counted, variance }) => {
    if (row.ingredientId === focusedCount) return true;
    const ingredient = catalog.get(row.ingredientId);
    if (searchText && ![row.name, ingredient?.category].some((part) => part?.toLocaleLowerCase('ru').includes(searchText))) return false;
    if (countFilter === 'uncounted') return !counted;
    if (countFilter === 'differences') return variance !== 0;
    if (countFilter === 'shortage') return variance < 0;
    if (countFilter === 'surplus') return variance > 0;
    return true;
  }).map(({ row }) => row);

  function markEdited() {
    setEditRevision((revision) => revision ?? document.revision);
  }

  function addRow(id: string) {
    const ingredient = ingredients.data?.find((entry) => entry.id === id);
    if (!ingredient) return;
    markEdited();
    if ((document.items ?? []).some((row) => row.ingredientId === id)) {
      setRemoved((current) => current.filter((value) => value !== id));
    } else {
      setLocalRows((current) => [...current, {
        ingredientId: ingredient.id, name: ingredient.name, unit: ingredient.unit,
        expected: ingredient.stock, unitCost: ingredient.avgCost, quantity: null, difference: null, value: null,
      }]);
    }
  }

  function removeRow(id: string) {
    markEdited();
    setLocalRows((current) => current.filter((row) => row.ingredientId !== id));
    setRemoved((current) => [...current, id]);
    setQuantities((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function clearEdits(saved: StockDocument) {
    setDocument(saved);
    setTiming(warehouseTimingFor(saved.kind === 'inventory' ? saved.countedAt : saved.effectiveAt));
    if (isWriteoff) writeoff.adopt(saved);
    setLocalRows([]);
    setQuantities({});
    setRemoved([]);
    setNote(undefined);
    setReason(undefined);
    setEditRevision(undefined);
  }
  useEffect(() => { if (stale && !dirty && !pending) clearEdits(incoming); }, [incoming.revision, stale, dirty, pending]);
  function close() {
    if (inFlight.current) return;
    if (dirty) Alert.alert('Есть несохранённые изменения', 'Выйти без сохранения?', [{ text: 'Продолжить', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: onClose }]);
    else onClose();
  }

  async function saveDraft(submit = false, recount = false) {
    if (inFlight.current || stale || !validNumbers || (submit && !canSubmit)) return;
    inFlight.current = true;
    setError('');
    try {
      const updated = await save.mutateAsync({
        id: document.id, revision: editRevision ?? document.revision, recount: recount || undefined,
        reason: currentReason || undefined, note: currentNote,
        items: isWriteoff ? undefined : values.items,
        sourceLines: isWriteoff ? writeoff.input() : undefined,
        countedAt: isInventory ? time : undefined, effectiveAt: !isInventory ? time : undefined,
        finalize: submit ? canApprove ? 'post' : 'submit' : undefined,
      });
      clearEdits(updated);
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      inFlight.current = false;
    }
  }

  async function changeStatus(action: 'approve' | 'reopen' | 'reverse') {
    if (inFlight.current || stale || (action === 'reverse' && !reverseReason.trim())) return;
    inFlight.current = true;
    setError('');
    try {
      clearEdits(await transition.mutateAsync({ id: document.id, revision: document.revision, action, note: action === 'reverse' ? reverseReason.trim() : undefined }));
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      inFlight.current = false;
    }
  }

  function confirmApprove() {
    Alert.alert('Утвердить и провести?', 'Проведение изменит остатки выбранного склада.', [
      { text: 'Назад', style: 'cancel' },
      { text: 'Провести', onPress: () => void changeStatus('approve') },
    ]);
  }

  const footer: ReactNode = editable ? (
    <View style={styles.actions}>
      <Button title={needsApplyTime ? 'Применить дату и остатки' : 'Сохранить черновик'} style={styles.action} size="md" variant="secondary" disabled={!dirty || !validNumbers || pending || stale}
        onPress={() => void saveDraft()} />
      <Button title={canApprove ? 'Провести' : 'На утверждение'} style={styles.action} size="md" disabled={!canSubmit || pending || stale} onPress={() => Alert.alert(canApprove ? 'Провести документ?' : 'Отправить на утверждение?', 'Проверьте дату и фактические количества.', [{ text: 'Назад', style: 'cancel' }, { text: canApprove ? 'Провести' : 'Отправить', onPress: () => void saveDraft(true) }])} />
    </View>
  ) : reviewing ? (
    <View style={styles.actions}>
      <Button title="Вернуть в черновик" style={styles.action} size="md" variant="secondary" disabled={pending || stale} onPress={() => void changeStatus('reopen')} />
      <Button title="Утвердить и провести" style={styles.action} size="md" disabled={pending || stale} onPress={confirmApprove} />
    </View>
  ) : undefined;

  return (
    <WarehouseWorkspace onClose={close} title={documentTitle(document.kind)} footer={footer}>
      <FlatList data={isWriteoff ? [] : visibleCounts} keyExtractor={(item) => item.ingredientId}
        keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pageContent}
        ListHeaderComponent={
          <View style={styles.stack}>
            <View style={styles.row}>
              <Text style={styles.title}>{warehouseName ?? '—'}</Text>
              <Text style={styles.status} translate>{STATUS_LABELS[document.status]}</Text>
            </View>
            <Text style={styles.muted}>{documentDate(document.createdAt)}{document.createdByName ? ` · ${document.createdByName}` : ''}</Text>
            {editable ? <WarehouseTimingField label={isInventory ? 'Проверка остатков' : 'Дата списания'} value={timing} onChange={setTiming} disabled={pending || stale} inventory={isInventory} /> : <Text>{isInventory ? 'Дата проверки' : 'Учётная дата'}: {savedTime ? documentDate(savedTime) : document.postedAt ? documentDate(document.postedAt) : 'На момент проведения'}</Text>}
            {needsApplyTime ? <Text style={styles.muted}>Примените дату перед проведением. Учётные остатки будут пересчитаны, введённые фактические количества сохранятся.</Text> : null}
            {stale && dirty ? <><FormError message="Документ изменён другим сотрудником. Ваш ввод сохранён на экране. Перед сохранением загрузите актуальную версию." /><Button title="Загрузить актуальную версию" variant="secondary" onPress={() => Alert.alert('Заменить ваш ввод?', 'Будут загружены последние сохранённые значения.', [{ text: 'Назад', style: 'cancel' }, { text: 'Загрузить', onPress: () => clearEdits(incoming) }])} /></> : null}
            {document.submittedAt ? <Text style={styles.muted}>{t('Отправлено')}: {documentDate(document.submittedAt)}{document.submittedByName ? ` · ${document.submittedByName}` : ''}</Text> : null}
            {document.postedAt ? <Text style={styles.muted}>{t('Проведён')}: {documentDate(document.postedAt)}{document.postedByName ? ` · ${document.postedByName}` : ''}</Text> : null}
            {isInventory ? <Text style={styles.muted} translate>{modeLabel(document.mode)}</Text> : null}
            {editable && isFull ? <Text style={styles.muted} translate>Введите фактический остаток для каждой позиции. Если остатка нет, укажите 0.</Text> : null}
            {!isInventory && editable ? <Select title="Причина списания" placeholder="Причина списания" value={currentReason} disabled={pending || stale}
              options={REASON_OPTIONS} onChange={(value) => { markEdited(); setReason(value as StockDocumentReason); }} /> : null}
            {editable && currentReason === 'other' && !currentNote.trim() ? (
              <Text style={styles.muted} translate>Укажите причину в комментарии.</Text>
            ) : null}
            {!editable && document.reason ? <Text style={styles.muted} translate>{reasonLabel(document.reason)}</Text> : null}
            {editable ? <Field label={!isInventory && currentReason === 'other' ? 'Уточните причину' : 'Комментарий'} multiline style={styles.note} value={currentNote} maxLength={1000} editable={!pending && !stale}
              onChangeText={(value) => { markEdited(); setNote(value); }} /> : currentNote ? <Text>{currentNote}</Text> : null}
            {isWriteoff ? <WarehouseWriteoffLines editor={editable ? writeoff : undefined} sourceLines={document.sourceLines} disabled={pending || stale} showCost={showCost && !(editable && timing.mode === 'past')} /> : null}
            {isWriteoff && !editable && !document.sourceLines?.length ? <Text style={styles.muted}>{document.items?.map((item) => `${item.name}: ${item.quantity == null ? '—' : qty(item.quantity, item.unit)}`).join('\n')}</Text> : null}
            {editable && !isFull && !isWriteoff ? <Select searchable title="Добавить продукт" placeholder="+ Добавить продукт" value="" options={options} onChange={addRow} disabled={pending || stale} /> : null}
            {ingredients.isError && !ingredients.data ? <QueryError error={ingredients.error} retry={() => void ingredients.refetch()} /> : null}
            {showCost && !(editable && timing.mode === 'past') && (!dirty || isWriteoff) ? <Text style={styles.title}>{t(isInventory ? 'Итоговое расхождение' : 'Сумма списания')}: {(isWriteoff && editable ? writeoff.total : document.varianceValue) == null ? 'Стоимость неизвестна' : documentValue(document.kind, (isWriteoff && editable ? writeoff.total : document.varianceValue)!)}</Text> : null}
            {showCost && editable && timing.mode === 'past' ? <Text style={styles.muted}>Окончательная стоимость определяется на учётную дату при проведении.</Text> : null}
            {isInventory && <Card style={styles.fields}>
              <View style={styles.row}>
                <Text style={styles.muted}>Посчитано: {counted.length} из {rows.length}</Text>
                <FastPressable accessibilityRole="button" onPress={() => setCountFilter('shortage')}><Text style={styles.link}>Недостача: {shortageCount}</Text></FastPressable>
                <FastPressable accessibilityRole="button" onPress={() => setCountFilter('surplus')}><Text style={styles.link}>Излишек: {surplusCount}</Text></FastPressable>
              </View>
              <View style={styles.search}>
                <PwaIcon name="search" size={15} color={colors.textMuted} />
                <TextInput style={styles.searchInput} accessibilityLabel="Поиск продуктов и категорий инвентаризации"
                  placeholder="Быстрый поиск" value={countSearch} onChangeText={setCountSearch} />
              </View>
              <View style={styles.row}>
                <Select title="Позиции инвентаризации" style={styles.compact} value={countFilter} onChange={setCountFilter} options={[
                  { value: '', label: 'Все продукты · ' + rows.length },
                  ...(editable ? [{ value: 'uncounted' as const, label: 'Не посчитано · ' + (rows.length - counted.length) }] : []),
                  { value: 'differences', label: 'С расхождением · ' + (shortageCount + surplusCount) },
                  { value: 'shortage', label: 'Недостача · ' + shortageCount }, { value: 'surplus', label: 'Излишек · ' + surplusCount },
                ]} />
                {countFilter || searchText ? <FastPressable accessibilityRole="button" onPress={() => { setCountSearch(''); setCountFilter(''); }}>
                  <Text style={styles.link}>Сбросить фильтры · {visibleCounts.length}</Text>
                </FastPressable> : editable && counted.length < rows.length ? <FastPressable accessibilityRole="button" onPress={() => setCountFilter('uncounted')}>
                  <Text style={styles.link} translate>К непосчитанному</Text>
                </FastPressable> : null}
              </View>
            </Card>}
            {editable && isInventory && canApprove && document.submittedAt ? (
              <Button title="Обновить учётный остаток" size="md" variant="secondary" disabled={pending || !validNumbers}
                onPress={() => Alert.alert('Обновить учётный остаток?', 'Сверьте фактические значения перед сохранением.', [
                  { text: 'Назад', style: 'cancel' },
                  { text: 'Обновить', onPress: () => void saveDraft(false, true) },
                ])} />
            ) : null}
            {document.status === 'posted' && canApprove ? <><Field label="Причина сторно" value={reverseReason} onChangeText={setReverseReason} editable={!pending} maxLength={1000} /><Button title="Сторнировать документ" variant="danger" disabled={pending || !reverseReason.trim()} onPress={() => Alert.alert('Сторнировать документ?', 'Будет создано обратное движение остатков.', [{ text: 'Назад', style: 'cancel' }, { text: 'Сторнировать', style: 'destructive', onPress: () => void changeStatus('reverse') }])} /></> : null}
            {document.reversedAt ? <Text style={styles.muted}>Сторно: {documentDate(document.reversedAt)} · {document.reversalReason}</Text> : null}
            <FormError message={error} />
          </View>
        }
        ListEmptyComponent={!isWriteoff ? <Text style={styles.muted} translate>{countFilter || searchText ? 'По выбранным фильтрам ничего не найдено' : 'Позиций пока нет'}</Text> : null}
        renderItem={({ item }) => {
          const value = rawQuantity(item);
          const change = isInventory && item.expected != null
            ? parseQuantity(value) - item.expected
            : -parseQuantity(value);
          const typed = quantities[item.ingredientId] !== undefined;
          const difference = needsApplyTime ? null : typed ? (value.trim() && Number.isFinite(change) ? change : null) : item.difference;
          const differenceValue = typed
            ? difference != null && item.unitCost != null ? difference * item.unitCost : null
            : item.value;
          return (
            <View style={styles.countRow}>
              <View style={styles.row}>
                <Text style={[styles.title, styles.flex]}>{item.name}</Text>
                {editable && !isFull ? <FastPressable accessibilityRole="button" accessibilityLabel={`Убрать ${item.name}`} style={styles.remove} disabled={pending || stale}
                  onPress={() => removeRow(item.ingredientId)}><Text style={styles.muted}>×</Text></FastPressable> : null}
              </View>
              {item.expected != null && !needsApplyTime ? <Text style={styles.muted}>{t('Плановый остаток')}: {qty(item.expected, item.unit)}</Text> : null}
              {editable ? (
                <Field label={`${t(isInventory ? 'Фактический остаток' : 'Количество')} · ${item.unit}`} value={value} editable={!pending && !stale}
                  keyboardType="decimal-pad" onFocus={() => setFocusedCount(item.ingredientId)}
                  onBlur={() => setFocusedCount((current) => current === item.ingredientId ? undefined : current)} onChangeText={(next) => {
                    markEdited();
                    setQuantities((current) => ({ ...current, [item.ingredientId]: next }));
                  }} />
              ) : <Text>{t(isInventory ? 'Фактический остаток' : 'Количество')}: {item.quantity == null ? 'Не посчитано' : qty(item.quantity, item.unit)}</Text>}
              {difference != null ? <Text style={isInventory && difference < 0 ? styles.error : styles.muted}>
                {t(isInventory ? 'Расхождение' : 'Списание')}: {isInventory && difference > 0 ? '+' : ''}
                {qty(isInventory ? difference : Math.abs(difference), item.unit)}
                {showCost && differenceValue != null ? ` · ${documentValue(document.kind, differenceValue)}` : ''}
              </Text> : null}
            </View>
          );
        }}
      />
    </WarehouseWorkspace>
  );
}

function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return <View style={styles.stack}><FormError message={apiError(error)} /><Button title="Повторить" variant="secondary" size="md" onPress={retry} /></View>;
}

function FormError({ message }: { message: string }) {
  return message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null;
}

const styles = StyleSheet.create({
  pageContent: { padding: spacing.md, gap: spacing.md, paddingBottom: 32 },
  flex: { flex: 1, minWidth: 130 },
  stack: { gap: spacing.sm, paddingBottom: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  status: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  error: { fontSize: fontSize.sm, color: colors.danger },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexGrow: 1 },
  fields: { gap: spacing.sm },
  footerTotal: { width: '100%', textAlign: 'right', fontWeight: '600', color: colors.textPrimary },
  note: { minHeight: 58, textAlignVertical: 'top' },
  segmented: { flexDirection: 'row', overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 36 },
  segmentActive: { backgroundColor: colors.primarySoft },
  link: { color: colors.primary, fontSize: 13 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, minHeight: 36, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10 },
  searchInput: { flex: 1, minHeight: 34, paddingVertical: 4, fontSize: 14, color: colors.textPrimary },
  compact: { minWidth: 125, height: 36, paddingHorizontal: 9, borderRadius: 6 },
  countRow: { gap: spacing.sm, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.white },
  remove: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center' },
});
