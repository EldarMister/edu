import React, { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button, Card, Field, PillTabs } from './ui';
import { apiError } from '@/lib/api';
import { useCashAccess, useCashCategories, useCashOperation, useCashShiftState, useChangeCashShift, type CurrentCashShift } from '@/services/api/cash-shifts';
import { colors, fontSize, spacing } from '@/theme';
import { makeIdempotencyKey, money } from '@/utils/format';
import { moneyCents } from '@/utils/payment';

type Mode = 'open' | 'close' | 'operation';
const kinds = [{ key: 'income', label: 'Внесение' }, { key: 'expense', label: 'Расход' }, { key: 'collection', label: 'Инкассация' }] as const;

function parseDealDay(value: string) {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return null;
  const iso = value.split('.').reverse().join('-');
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function CashShiftPanel() {
  const { canView, canManage } = useCashAccess();
  const shift = useCashShiftState(canView);
  const [mode, setMode] = useState<Mode | null>(null);
  if (!canView || !shift.data?.enabled) return null;
  const current = shift.data.current;
  return <Card style={styles.group}>
    <Text style={styles.title}>Кассовая смена</Text>
    <Text>{current ? `Книжный баланс · ${money(current.expectedAmount)}` : 'Кассовая смена не открыта'}</Text>
    {canManage && current ? <Button title="Операция с наличными" variant="secondary" onPress={() => setMode('operation')} /> : null}
    {canManage ? <Button title={current ? 'Закрыть кассовую смену' : 'Открыть кассовую смену'} variant="secondary"
      onPress={() => setMode(current ? 'close' : 'open')} /> : null}
    {mode && (mode === 'open' || current) ? <CashShiftEditor mode={mode} current={current} onClose={() => setMode(null)} /> : null}
  </Card>;
}

export function CashShiftEditor({ mode, current, onClose, onComplete }: {
  mode: Mode; current: CurrentCashShift | null; onClose: () => void; onComplete?: () => void;
}) {
  const { canCloseStaff } = useCashAccess();
  const [kind, setKind] = useState<(typeof kinds)[number]['key']>('expense');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [closeStaff, setCloseStaff] = useState(false);
  const [separateDate, setSeparateDate] = useState(false);
  const [dealDay, setDealDay] = useState(() => new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [requestKey] = useState(makeIdempotencyKey);
  const submitting = useRef(false);
  const change = useChangeCashShift();
  const create = useCashOperation();
  const operation = mode === 'operation';
  const closing = mode === 'close';
  const categories = useCashCategories(operation && kind !== 'collection');
  const availableCategories = categories.data?.filter((category) => category.kind === kind || category.kind === 'both');
  const amountInCents = moneyCents(amount);
  const hasDealDate = operation && kind !== 'collection' && separateDate;
  const dealDate = hasDealDate ? parseDealDay(dealDay) : null;
  const valid = amountInCents != null && (!operation || amountInCents > 0) && (!hasDealDate || dealDate !== null);
  const busy = change.isPending || create.isPending;
  const error = change.error ?? create.error ?? (operation && kind !== 'collection' ? categories.error : null);
  const finish = onComplete ?? onClose;

  function dismiss() {
    if (submitting.current) return;
    if (amount || note || closeStaff || categoryId || hasDealDate) {
      Alert.alert('Есть несохранённые изменения', 'Закрыть форму без сохранения?', [
        { text: 'Продолжить редактирование', style: 'cancel' }, { text: 'Выйти', onPress: onClose },
      ]);
    } else onClose();
  }

  async function submit() {
    if (submitting.current || !valid || amountInCents === null || (mode !== 'open' && !current)) return;
    submitting.current = true;
    const value = amountInCents / 100;
    try {
      if (operation && current) await create.mutateAsync({ shiftId: current.id, amount: value, kind,
        categoryId: kind === 'collection' ? undefined : categoryId, note: note.trim(), requestKey, dealDate });
      else await change.mutateAsync(closing && current ? { amount: value, shiftId: current.id,
        expectedAmount: current.expectedAmount, closingComment: note.trim() || undefined,
        closeEmployeeShifts: canCloseStaff && closeStaff ? true : undefined } : { amount: value });
      finish();
    } catch {
      // Keep the amount and comment so the operation can be retried.
    } finally {
      submitting.current = false;
    }
  }

  const title = operation ? 'Операция с наличными' : closing ? 'Закрытие кассовой смены' : 'Открытие кассовой смены';
  return <BottomSheet visible title={title} onClose={dismiss} maxHeight="88%" bodyStyle={styles.sheetBody}
    footer={<View style={styles.group}>
      <Button title={operation ? 'Сохранить' : closing ? 'Закрыть смену' : 'Открыть смену'}
        disabled={!valid} loading={busy} onPress={() => void submit()} />
      <Button title="Отмена" variant="secondary" disabled={busy} onPress={dismiss} />
    </View>}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.group}>
      {operation ? <PillTabs items={kinds.map((item) => ({ ...item }))} value={kind}
        onChange={(value) => { if (!busy) { setCategoryId(undefined); setKind(value as typeof kind); } }} /> : null}
      {closing && current ? <Text>По расчёту в кассе · {money(current.expectedAmount)}</Text> : null}
      <Field label={operation ? 'Сумма' : 'Фактический остаток наличных'} autoFocus keyboardType="decimal-pad"
        editable={!busy} value={amount} placeholder="0,00" onChangeText={setAmount} />
      {operation && kind !== 'collection' && availableCategories?.length ? <PillTabs
        items={[{ key: '', label: 'Кассовые смены' }, ...availableCategories.map(({ id, name }) => ({ key: id, label: name }))]}
        value={categoryId ?? ''} onChange={(value) => { if (!busy) setCategoryId(value || undefined); }} /> : null}
      {operation && kind !== 'collection' && <View style={styles.row}>
        <Text>Дата сделки другая</Text>
        <Switch accessibilityLabel="Дата сделки другая" value={separateDate} disabled={busy} onValueChange={setSeparateDate} />
      </View>}
      {hasDealDate && <Field label="Дата сделки" placeholder="ДД.ММ.ГГГГ" keyboardType="number-pad" editable={!busy} value={dealDay}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '').slice(0, 8);
          setDealDay([digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('.'));
        }} />}
      {operation || closing ? <Field label="Комментарий" maxLength={500} editable={!busy} value={note} onChangeText={setNote} /> : null}
      {closing && canCloseStaff ? <View style={styles.row}>
        <Text>Закрыть смены сотрудников</Text>
        <Switch accessibilityLabel="Закрыть смены сотрудников" value={closeStaff} disabled={busy} onValueChange={setCloseStaff} />
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{apiError(error)}</Text> : null}
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  group: { gap: spacing.sm },
  sheetBody: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { color: colors.danger },
});
