import React, { useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import * as Crypto from 'expo-crypto';
import { isAxiosError } from 'axios';
import { Alert, Text } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button, Card, Field } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import {
  purchaseNumber as formatPurchaseNumber, useIngredients, useLastPurchasePrices, usePurchase, usePurchaseMutations, useWarehouseLocations, useWarehousePackages, useWarehouseSuppliers,
  type Purchase, type WarehouseLocation,
} from '@/services/api/warehouse';
import { unitLabel, unitsForType } from '@/services/api/warehouseUnits';
import { useStockDocuments } from '@/services/api/stockDocuments';
import { colors, radius, spacing } from '@/theme';
import { useNotifications } from '@/store/notifications';
import { balanceMoney } from '@/utils/warehouseBalance';
import {
  changePurchaseLineUnit, newPurchaseLine, purchaseCustomUnits, purchaseLastPrice, purchaseLineGross, purchaseLineInput,
  purchaseMoney, purchaseNumber, purchaseQuantity, savedPurchaseLine, type PurchaseFormLine,
} from '@/utils/warehousePurchaseForm';
import {
  warehouseDateTimeIso, warehouseLocalTime, warehouseTimeDisplay, warehouseTimingError, warehouseTimingFor, warehouseTimingValue,
} from '@/utils/warehouseTiming';
import { WarehouseDateTimeField, WarehouseTimingField } from './WarehouseTimingField';
import { WarehouseSupplierReturnForm } from './WarehouseSupplierReturnForm';
import { WarehouseWorkspace } from './WarehouseWorkspace';

type Props = {
  purchaseId: string | null;
  warehouse?: WarehouseLocation;
  warehouseLabel: (id?: string | null) => string;
  onClose: () => void;
  inline?: boolean;
  initialCorrecting?: boolean;
};

function PurchasePanel({ title, inline, onClose, footer, children }: React.PropsWithChildren<{
  title: string;
  inline?: boolean;
  onClose: () => void;
  footer?: React.ReactNode;
}>) {
  if (inline) return <View style={styles.panel}>{children}{footer}</View>;
  return <WarehouseWorkspace title={title} onClose={onClose} footer={footer}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView>
  </WarehouseWorkspace>;
}

export function PurchaseEditor({ purchaseId, initialCorrecting = false, ...props }: Props) {
  const query = usePurchase(purchaseId);
  const [reloadCount, setReloadCount] = useState(0);
  const [correcting, setCorrecting] = useState(initialCorrecting);
  const [supplierReturn, setSupplierReturn] = useState<{ documentId: string } | { sourcePurchaseId: string; warehouseId?: string } | null>(null);
  const title = query.data ? `Поставка ${formatPurchaseNumber(query.data.number)}` : purchaseId ? 'Поставка' : 'Новая поставка';
  if (supplierReturn) return <WarehouseSupplierReturnForm {...supplierReturn} onClose={() => setSupplierReturn(null)} />;
  if (purchaseId && !query.data) return <PurchasePanel {...props} title={title}>
    {query.isError ? <View style={styles.stack}>
      <Text style={styles.error}>{apiError(query.error)}</Text>
      <Button title="Повторить загрузку" variant="secondary" onPress={() => void query.refetch()} />
    </View> : <ActivityIndicator color={colors.primary} />}
  </PurchasePanel>;
  const openedVersion = query.data?.status === 'completed' && !correcting ? query.data.updatedAt : '';
  return <PurchaseForm key={`${purchaseId ?? 'new'}:${reloadCount}:${correcting}:${openedVersion}`}
    {...props} title={title} purchase={query.data} correcting={correcting} onCorrecting={setCorrecting}
    onStartReturn={(sourcePurchaseId, warehouseId) => setSupplierReturn({ sourcePurchaseId, warehouseId })}
    onOpenReturn={(documentId) => setSupplierReturn({ documentId })}
    onReload={async () => {
      const result = await query.refetch({ throwOnError: true });
      if (result.data) setReloadCount((value) => value + 1);
    }} />;
}

function PurchaseForm({ title, warehouse, warehouseLabel, onClose, inline, purchase, correcting, onCorrecting,
  onStartReturn, onOpenReturn, onReload }: Omit<Props, 'purchaseId' | 'initialCorrecting'> & {
  title: string;
  purchase?: Purchase;
  correcting: boolean;
  onCorrecting: (value: boolean) => void;
  onStartReturn: (purchaseId: string, warehouseId?: string) => void;
  onOpenReturn: (documentId: string) => void;
  onReload: () => Promise<void>;
}) {
  const [original] = useState(purchase);
  const [requestKey] = useState(() => Crypto.randomUUID());
  const [supplier, setSupplier] = useState(original?.supplier ?? '');
  const [note, setNote] = useState(original?.note ?? '');
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [invoiceTime, setInvoiceTime] = useState(() => warehouseLocalTime(original?.date));
  const [timing, setTiming] = useState(() => warehouseTimingFor(original?.effectiveAt));
  const [lines, setLines] = useState<PurchaseFormLine[]>(() => original?.items?.length
    ? original.items.map(savedPurchaseLine) : [newPurchaseLine(Crypto.randomUUID())]);
  const [discount, setDiscount] = useState(String(original?.discount ?? 0));
  const [discountVisible, setDiscountVisible] = useState(Number(original?.discount ?? 0) > 0);
  const [warehouseSelection, setWarehouseSelection] = useState(original?.warehouseId ?? warehouse?.id ?? '');
  const [errorText, setErrorText] = useState('');
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const working = React.useRef(false);
  const wide = useWindowDimensions().width >= 850;
  const permissions = usePermissions();
  const notify = useNotifications((state) => state.push);
  const completed = original?.status === 'completed';
  const canEdit = permissions.can('actions.warehouseReceive') && permissions.can('actions.warehouseCosts');
  const editable = canEdit && (!original || original.status === 'draft' || (completed && correcting));
  const stockEditable = editable && (!completed || original?.canCorrectStock === true);
  const historical = completed && original?.historicalStockCorrection === true;
  const compositionEditable = stockEditable && !historical;
  const locations = useWarehouseLocations();
  const defaultWarehouse = locations.data?.locations.find(({ isDefault }) => isDefault);
  const warehouseId = warehouseSelection || defaultWarehouse?.id;
  const ingredients = useIngredients('', warehouseId, stockEditable);
  const packages = useWarehousePackages(compositionEditable);
  const suppliers = useWarehouseSuppliers(editable);
  const lastPrices = useLastPurchasePrices(lines.map(({ ingredientId }) => ingredientId), warehouseId, original?.id, stockEditable);
  const returns = useStockDocuments('supplier_return', original?.warehouseId ?? undefined, undefined, !!completed && canEdit);
  const linkedReturns = (returns.data ?? []).filter(({ sourcePurchaseId }) => sourcePurchaseId === original?.id);
  const availablePackages = packages.data ?? [];
  const ingredientById = new Map((ingredients.data ?? []).map((ingredient) => [ingredient.id, ingredient]));
  const ingredientOptions = (ingredients.data ?? []).filter(({ isActive, preparationMode }) => isActive && preparationMode !== 'virtual')
    .map(({ id, name, category }) => ({ value: id, label: name, searchText: category ?? undefined, translate: false }));
  const mutations = usePurchaseMutations();
  const busy = reloading || mutations.create.isPending || mutations.update.isPending || mutations.cancel.isPending;
  const subtotal = purchaseMoney(lines.reduce((total, line) => total + (Number.isFinite(purchaseLineGross(line)) ? purchaseLineGross(line) : 0), 0));
  const discountAmount = discount.trim() ? purchaseNumber(discount) : 0;
  const total = purchaseMoney(subtotal - (Number.isFinite(discountAmount) ? discountAmount : 0));
  const signature = JSON.stringify({ supplier, note, invoiceTime, timing, lines, discount, warehouseSelection });
  const initialSignature = React.useRef(signature).current;

  const updateLine = (key: string, update: (line: PurchaseFormLine) => PurchaseFormLine) =>
    setLines((current) => current.map((line) => line.key === key ? update(line) : line));

  async function save(complete: boolean) {
    if (busy || stale || !editable || working.current) return;
    const date = warehouseDateTimeIso(invoiceTime, original?.date);
    if (!date || !supplier.trim()) {
      setErrorText('Укажите поставщика, дату и время накладной.');
      return;
    }
    if (original && completed && !original.updatedAt) {
      setErrorText('Обновите поставку перед исправлением.');
      setStale(true);
      return;
    }
    if (stockEditable && (!warehouseId || !Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal)) {
      if (warehouseId) setDiscountVisible(true);
      setErrorText(warehouseId ? 'Скидка должна быть от 0 до суммы товаров.' : 'Выберите склад.');
      return;
    }
    const effectiveAt = warehouseTimingValue(timing, original?.effectiveAt);
    if (!completed && (effectiveAt === undefined || warehouseTimingError(timing))) {
      setErrorText(warehouseTimingError(timing) || 'Проверьте дату складской операции.');
      return;
    }
    const supplierName = supplier.trim();
    const supplierId = suppliers.data?.find(({ name }) => name === supplierName)?.id;
    const metadata = {
      ...(!original || supplierName !== original.supplier ? { supplier: supplierName, supplierId } : {}),
      date, note: note.trim() || null,
    };
    const enteredLines = lines.filter((line) => line.ingredientId || line.quantity.trim() || line.price.trim() || line.gross?.trim());
    const items = stockEditable ? enteredLines.map((line) => purchaseLineInput(line, ingredientById.get(line.ingredientId))) : undefined;
    if (stockEditable && (!items?.length || items.some((item) => item === null))) {
      setErrorText('Добавьте товары и проверьте количество, единицы и цену.');
      return;
    }
    const stock = items?.every((item) => item !== null) ? { items, discount: discountAmount, warehouseId } : {};
    setErrorText('');
    working.current = true;
    try {
      if (original) await mutations.update.mutateAsync({
        id: original.id, expectedUpdatedAt: original.updatedAt, ...metadata, ...stock,
        ...(!completed ? { effectiveAt, complete } : {}),
      });
      else if (items?.every((item) => item !== null)) await mutations.create.mutateAsync({
        ...metadata, requestKey, items, discount: discountAmount, warehouseId, effectiveAt, complete,
      });
      notify({ message: completed ? 'Исправления поставки сохранены' : complete
        ? 'Поставка проведена. Остатки обновлены.' : 'Черновик сохранён. Остатки не изменились.', at: new Date().toISOString() });
      onClose();
    } catch (error) {
      const message = apiError(error);
      setErrorText(message);
      setStale(!!original && isAxiosError(error) && error.response?.status === 409 && message.includes('Поставка изменилась'));
    } finally {
      working.current = false;
    }
  }

  async function reload() {
    setReloading(true);
    try { await onReload(); }
    catch (error) { setErrorText(apiError(error)); }
    finally { setReloading(false); }
  }

  function cancelDraft() {
    if (!original) return;
    Alert.alert('Отменить поставку?', 'Черновик будет отменён.', [
      { text: 'Назад', style: 'cancel' },
      { text: 'Отменить поставку', style: 'destructive', onPress: () => {
        void mutations.cancel.mutateAsync(original.id).then(onClose).catch((error) => setErrorText(apiError(error)));
      } },
    ]);
  }

  function close() {
    if (busy) return;
    if (!editable || signature === initialSignature) {
      onClose();
      return;
    }
    Alert.alert('Есть несохранённые изменения', 'Изменения в поставке ещё не сохранены.', [
      { text: 'Продолжить редактирование', style: 'cancel' },
      { text: 'Выйти без сохранения', style: 'destructive', onPress: onClose },
    ]);
  }

  const showCost = permissions.can('actions.warehouseCosts');
  const totalLabel = 'Итого: ' + balanceMoney(stockEditable ? total : original?.totalAmount ?? 0);
  const ready = !stockEditable || ingredients.isSuccess && (!compositionEditable || packages.isSuccess);
  const footer = <View style={styles.footer}>
    <View style={styles.actions}>
      {editable ? <>
        <Button title={completed ? 'Сохранить исправление' : 'Сохранить'} size="md" disabled={busy || stale || !ready}
          onPress={() => void save(true)} />
        {completed
          ? <Button title="Отменить изменения" size="md" variant="secondary" disabled={busy} onPress={() => onCorrecting(false)} />
          : <Button title="Сохранить черновик" size="md" variant="secondary" disabled={busy || stale || !ready} onPress={() => void save(false)} />}
      </> : <>
        <Text style={styles.status} translate>{completed ? 'Поставка проведена' : original?.status === 'cancelled' ? 'Проведение отменено' : 'Черновик'}</Text>
        {completed && canEdit && <Button title={original.canCorrectStock ? 'Исправить' : 'Исправить реквизиты'} size="md"
          onPress={() => onCorrecting(true)} />}
        {completed && canEdit && <Button title="Возврат поставщику" size="md" variant="secondary"
          disabled={!purchase?.returnableItems?.some((item) => item.remainingQuantityBase > 0)}
          onPress={() => onStartReturn(original.id, original.warehouseId ?? warehouseId)} />}
      </>}
    </View>
    {showCost && <Text style={styles.label}>{totalLabel}</Text>}
  </View>;

  return <PurchasePanel title={title} inline={inline} onClose={close} footer={footer}>
    <View style={styles.stack}>
      {completed ? <Text style={styles.muted}>
        {correcting ? (historical ? 'Изменение количества или цены пересчитает последующие движения. Склад, товары и фасовки закреплены.'
          : original.correctionBlockedReason ?? 'Исправление сохранит предыдущую версию в истории поставки.')
          : 'Поставка проведена' + (original.postedAt ? ' ' + warehouseTimeDisplay(original.postedAt) + ' (Бишкек)' : '') + '.'}
      </Text> : editable ? <Text style={styles.muted} translate>«Сохранить» оприходует товары с выбранного момента. Черновик не меняет остатки. Дата накладной хранится отдельно.</Text> : null}
      <Card style={styles.metadata}>
        {editable
          ? <WarehouseDateTimeField label="Дата накладной" value={invoiceTime} onChange={setInvoiceTime} disabled={busy} />
          : <ReadValue label="Дата накладной" value={original?.date ? warehouseTimeDisplay(original.date) : '—'} />}
        {editable && !completed ? <WarehouseTimingField label="Оприходовать товары" value={timing} onChange={setTiming} disabled={busy} />
          : <ReadValue label="Дата складской операции" value={original?.effectiveAt || original?.postedAt
            ? warehouseTimeDisplay((original.effectiveAt ?? original.postedAt)!) + ' · Бишкек'
            : 'На момент проведения'} />}
        {editable ? <View style={styles.fieldGroup}>
          <Field label="Поставщик" value={supplier} onChangeText={setSupplier} editable={!busy} maxLength={160}
            placeholder="Введите название" style={styles.documentField} />
          {!!suppliers.data?.length && <Select title="Поставщик из справочника" value={supplier} searchable
            placeholder="Выбрать из справочника" disabled={busy} style={styles.select}
            options={suppliers.data.map(({ name }) => ({ value: name, label: name, translate: false }))}
            onChange={setSupplier} />}
          {suppliers.isError && <InlineAction label="Повторить загрузку поставщиков" onPress={() => void suppliers.refetch()} />}
        </View> : <ReadValue label="Поставщик" value={supplier || '—'} />}
        {compositionEditable ? <View style={styles.fieldGroup}>
          <Text style={styles.smallLabel} translate>Склад</Text>
          <Select title="Склад поставки" placeholder="Выберите склад" value={warehouseId ?? ''} disabled={busy} onChange={setWarehouseSelection}
            style={styles.select} options={(locations.data?.locations ?? []).map(({ id, name }) => ({ value: id, label: name, translate: false }))} />
        </View> : <ReadValue label="Склад" value={warehouseLabel(original?.warehouseId ?? warehouseId)} />}
        {editable ? <Field label="Комментарий" value={note} onChangeText={setNote} editable={!busy} maxLength={2000}
          multiline style={styles.note} /> : <ReadValue label="Комментарий" value={note || '—'} />}
      </Card>
      {compositionEditable && ingredients.isError && <Button title="Повторить загрузку товаров" variant="secondary"
        onPress={() => void ingredients.refetch()} />}
      {compositionEditable && packages.isError && <Button title="Повторить загрузку фасовок" variant="secondary"
        onPress={() => void packages.refetch()} />}
      <Card style={styles.products}>
        {stockEditable && !ready && !ingredients.isError && !packages.isError &&
          <Text style={styles.muted} translate>Загрузка продуктов и фасовок…</Text>}
        {lines.map((line) => {
        const ingredient = ingredientById.get(line.ingredientId);
        const options = ingredientOptions.some(({ value }) => value === line.ingredientId) || !line.saved ? ingredientOptions
          : [...ingredientOptions, { value: line.ingredientId, label: line.saved.ingredientName, translate: false }];
        const compatible = availablePackages.filter((pack) => pack.isActive && pack.unitType === ingredient?.unitType);
        const unitOptions = [...(ingredient ? unitsForType(ingredient.unitType) : []), ...purchaseCustomUnits(ingredient)
          .map(({ name, factor }, index) => ({ value: `custom:${index}`, label: `${name} (${factor} ${ingredient?.unit ?? ''})`, translate: false })), ...compatible
          .map((pack) => ({ value: `package:${pack.id}`, label: `${pack.name} (${pack.quantity} ${unitLabel(pack.unit)})`, translate: false }))];
        const savedUnit = line.saved?.packageName
          ? line.saved.packageName + (line.saved.packageQuantity != null && line.saved.packageUnit
            ? ` (${line.saved.packageQuantity} ${unitLabel(line.saved.packageUnit)})` : '')
          : line.saved?.unit ?? '—';
        if (line.saved?.packageId && line.unit === `package:${line.saved.packageId}`) {
          const choice = unitOptions.find((option) => option.value === line.unit);
          if (choice) { choice.label = savedUnit; }
        }
        if (line.saved && !unitOptions.some(({ value }) => value === line.unit)) {
          unitOptions.push({ value: line.unit, label: savedUnit, translate: false });
        }
        const gross = purchaseLineGross(line);
        const previous = lastPrices.data?.find(({ ingredientId }) => ingredientId === line.ingredientId);
        const previousPrice = previous ? purchaseLastPrice(line, previous, ingredient, availablePackages) : undefined;
        const disabled = busy || !ready || !line.ingredientId;
        return <View key={line.key} style={styles.line}>
          <View style={styles.lineHeading}>
          <View style={styles.product}>
          {compositionEditable ? <Select title="Наименование продукта" placeholder="Наименование" value={line.ingredientId}
            options={options} searchable disabled={busy || !ready} style={styles.select}
            onChange={(ingredientId) => updateLine(line.key, (previous) => previous.ingredientId === ingredientId ? previous : ({
              ...newPurchaseLine(previous.key), ingredientId, unit: ingredientById.get(ingredientId)?.displayUnit ?? 'kg', quantity: '1',
            }))} /> : <Text style={styles.label}>{ingredient?.name ?? line.saved?.ingredientName}</Text>}
          </View>
          {compositionEditable && <FastPressable style={styles.remove} accessibilityRole="button" accessibilityLabel="Убрать строку" disabled={busy}
            onPress={() => setLines((current) => current.length > 1 ? current.filter(({ key }) => key !== line.key) : [newPurchaseLine(Crypto.randomUUID())])}>
            <PwaIcon name="close" size={16} color={colors.textMuted} />
          </FastPressable>}
          </View>
          <View style={[styles.columns, wide && styles.columnsWide]}>
            <View style={[styles.cell, wide && styles.cellWide]}>
              <Text style={styles.smallLabel} translate>Фасовки</Text>
              {compositionEditable ? <Select title="Единица закупки" placeholder="—" value={line.unit} options={unitOptions}
                disabled={disabled} style={styles.select}
                onChange={(unit) => updateLine(line.key, (value) => changePurchaseLineUnit(value, unit, ingredient, availablePackages))} />
                : <Text style={styles.readValue}>{savedUnit}</Text>}
            </View>
            <View style={[styles.cell, wide && styles.cellWide]}>
              {stockEditable ? <Field label="Количество" accessibilityLabel="Количество" value={line.quantity} keyboardType="decimal-pad"
                editable={!disabled} style={styles.numeric} onChangeText={(quantity) => updateLine(line.key, (value) => ({ ...value, quantity, gross: undefined }))} />
                : <ReadValue stacked label="Количество" value={line.quantity || '—'} />}
            </View>
            {showCost && <>
              <View style={[styles.cell, wide && styles.cellWide]}>
                {stockEditable ? <Field label="Цена за единицу" accessibilityLabel="Цена за единицу" value={line.price} keyboardType="decimal-pad"
                  editable={!disabled} style={styles.numeric} onChangeText={(price) => updateLine(line.key, (value) => ({ ...value, price, gross: undefined }))} />
                  : <ReadValue stacked label="Цена за единицу" value={line.price ? balanceMoney(Number(line.price)) : '—'} />}
                {stockEditable && !line.price.trim() && previous && previousPrice !== undefined &&
                  <InlineAction label={`Предыдущая: ${balanceMoney(previousPrice)} · ${warehouseTimeDisplay(previous.date).split(',')[0]}`}
                    disabled={disabled} onPress={() => updateLine(line.key, (value) => ({ ...value, price: String(previousPrice), gross: undefined }))} />}
              </View>
              <View style={[styles.cell, wide && styles.cellWide]}>
                {stockEditable ? <Field label="Общая сумма" accessibilityLabel="Общая сумма" keyboardType="decimal-pad"
                  value={line.gross ?? (Number.isFinite(gross) ? String(gross) : '')}
                  editable={!disabled && purchaseNumber(line.quantity) > 0} style={styles.numeric} onChangeText={(sum) => updateLine(line.key, (value) => {
                    const amount = purchaseNumber(sum);
                    const quantity = purchaseQuantity(purchaseNumber(value.quantity));
                    const price = Number.isFinite(amount) && quantity > 0 ? String(Math.round(amount / quantity * 1e8) / 1e8) : value.price;
                    return { ...value, price, gross: sum };
                  })} /> : <ReadValue stacked label="Общая сумма" value={Number.isFinite(gross) ? balanceMoney(gross) : '—'} />}
              </View>
            </>}
          </View>
        </View>;
        })}
        <View style={styles.actions}>
          {compositionEditable && <InlineAction label="+ Добавить ещё" disabled={busy || !ready}
            onPress={() => setLines((current) => [...current, newPurchaseLine(Crypto.randomUUID())])} />}
          {stockEditable && !discountVisible && <InlineAction label="+ Скидка поставщика" disabled={busy} onPress={() => setDiscountVisible(true)} />}
        </View>
        {showCost && discountVisible && <View style={styles.fieldGroup}>
          {discountAmount > 0 && <Text style={styles.muted}>До скидки: {balanceMoney(subtotal)}</Text>}
          {stockEditable ? <Field label="Скидка поставщика" value={discount} onChangeText={setDiscount}
            keyboardType="decimal-pad" editable={!busy} style={styles.numeric} />
            : <ReadValue label="Скидка поставщика" value={balanceMoney(discountAmount)} />}
        </View>}
      </Card>
      {completed && canEdit && <Card style={styles.advanced}>
        <Text style={styles.label} translate>Возвраты по поставке</Text>
        {returns.isPending && <ActivityIndicator color={colors.primary} />}
        {returns.isError && <InlineAction label="Повторить загрузку возвратов" onPress={() => void returns.refetch()} />}
        {returns.isSuccess && !linkedReturns.length && <Text style={styles.muted} translate>Возвратов пока нет.</Text>}
        {linkedReturns.map((entry) => <View key={entry.id}>
          <ReadValue label={'Возврат · ' + warehouseTimeDisplay(entry.createdAt)}
            value={entry.status === 'posted' ? 'Проведён' : entry.status === 'reversed' ? 'Отменён' : entry.status === 'submitted' ? 'На проверке' : 'Черновик'} />
          <InlineAction label="Открыть возврат" onPress={() => onOpenReturn(entry.id)} />
        </View>)}
      </Card>}
      {!!original?.corrections?.length && <Card style={styles.advanced}>
        <SectionToggle title={`История исправлений (${original.corrections.length})`} open={correctionsOpen}
          onPress={() => setCorrectionsOpen((value) => !value)} />
        {correctionsOpen && original.corrections.map((entry) => <View key={entry.id} style={styles.line}>
          <Text style={styles.readValue}>{warehouseTimeDisplay(entry.createdAt)} · {entry.actorName ?? 'Сотрудник'}</Text>
          <Text style={styles.muted}>{entry.reason ?? 'Исправление реквизитов'}{showCost && entry.before.totalAmount !== entry.after.totalAmount
            ? ` · ${balanceMoney(entry.before.totalAmount)} → ${balanceMoney(entry.after.totalAmount)}` : ''}</Text>
        </View>)}
      </Card>}
      {errorText ? <Text accessibilityRole="alert" style={styles.error}>{errorText}</Text> : null}
      {stale && <Button title="Загрузить изменения" size="md" variant="secondary" loading={reloading} onPress={() => void reload()} />}
      {editable && original?.status === 'draft' && <Button title="Отменить поставку" size="md" variant="danger" disabled={busy} onPress={cancelDraft} />}
    </View>
  </PurchasePanel>;
}

function InlineAction({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <FastPressable style={styles.inlineAction} accessibilityRole="button" disabled={disabled} onPress={onPress}>
    <Text style={[styles.link, disabled && styles.muted]} translate>{label}</Text>
  </FastPressable>;
}

function ReadValue({ label, value, stacked = false }: { label: string; value: string; stacked?: boolean }) {
  return <View style={stacked ? styles.fieldGroup : styles.readRow}>
    <Text style={styles.smallLabel} translate>{label}</Text>
    <Text style={stacked ? styles.readValue : styles.readValueRight}>{value}</Text>
  </View>;
}

function SectionToggle({ title, open, onPress }: { title: string; open: boolean; onPress: () => void }) {
  return <FastPressable style={styles.lineHeading} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress}>
    <Text style={styles.label} translate>{title}</Text>
    <View style={open && { transform: [{ rotate: '180deg' }] }}><PwaIcon name="chevronDown" size={16} color={colors.textMuted} /></View>
  </FastPressable>;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.lg },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
  stack: { gap: spacing.md },
  metadata: { padding: 12, gap: 12 },
  products: { paddingHorizontal: 12, paddingVertical: 6, gap: 6 },
  advanced: { padding: 12, gap: 8 },
  fieldGroup: { gap: 5 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  columns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', rowGap: spacing.sm },
  columnsWide: { flexWrap: 'nowrap' },
  cell: { width: '50%', paddingRight: 8, minWidth: 0, gap: 5 },
  cellWide: { width: '25%' },
  line: { paddingVertical: 8, gap: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  lineHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  product: { flex: 1, minWidth: 0 },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textPrimary, fontWeight: '600' },
  smallLabel: { color: colors.textSecondary, fontSize: 13 },
  select: { height: 36, borderRadius: radius.sm, paddingHorizontal: 9 },
  documentField: { height: 36, borderRadius: radius.sm },
  numeric: { height: 36, borderRadius: radius.sm, textAlign: 'right' },
  note: { minHeight: 56, height: 'auto', textAlignVertical: 'top', borderRadius: radius.sm, paddingTop: 8, paddingBottom: 8 },
  readRow: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' },
  readValue: { color: colors.textPrimary, fontSize: 14, flexShrink: 1 },
  readValueRight: { color: colors.textPrimary, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  inlineAction: { minHeight: 32, justifyContent: 'center' },
  link: { color: colors.primary, fontSize: 13 },
  status: { color: colors.textMuted, fontWeight: '600', alignSelf: 'center' },
  muted: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.danger },
});
