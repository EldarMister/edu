import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, EmptyState, Field, Loading } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { api } from '@/lib/api';
import { cashShiftKey, financeKey, shiftEndpoint, useCashShifts, type CashShift, type EntryKind, type FinanceCategory } from './api';
import { FinanceForm, FinanceLine, FinanceQueryError, MoneyField, SelectField, SwitchField, financeStyles } from './components';
import { entryLabels, financeDateTime, financeDay, financeLocalTime, financeMoney, parseMoney } from './format';
import { categoryChoices, transactionDate } from './rules';

type OperationKind = 'expense' | 'income' | 'collection';
type EditableCount = 'openingAmount' | 'actualAmount';
type Operation = {
  id: string; occurredAt: string; kind: EntryKind; category: string | null; categoryId: string | null;
  note: string | null; actorName: string | null; amount: number; cash: boolean; editable: boolean;
  collection?: boolean; deletedAt?: string; deletedByName?: string | null; reconciliation: 'open' | 'close' | null;
};

function useCashShiftRefresh() {
  const query = useQueryClient();
  return async (withStaff = false) => {
    const keys: (readonly string[])[] = [cashShiftKey, financeKey, ['audit']];
    if (withStaff) keys.push(['waiter', 'shift'], ['staff', 'work-shift'], ['admin', 'staff']);
    await Promise.all(keys.map((queryKey) => query.invalidateQueries({ queryKey })));
  };
}

export function CashShiftRegister({ canManage }: { canManage: boolean }) {
  const today = financeDay();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [selection, setSelection] = useState('');
  const [editing, setEditing] = useState<'open' | 'close' | null>(null);
  const valid = !!from && !!to && from <= to && to <= today;
  const shifts = useCashShifts(valid, shiftEndpoint, { from, to });
  const current = shifts.data?.current ?? null;
  const history = shifts.data?.history.filter(({ id }) => id !== current?.id) ?? [];
  const row = current?.id === selection ? current : history.find(({ id }) => id === selection);

  return (
    <View style={financeStyles.stack}>
      <View style={financeStyles.row}>
        <DateField label="С даты" value={from} onChangeText={setFrom} containerStyle={financeStyles.grow} />
        <DateField label="По дату" value={to} onChangeText={setTo} containerStyle={financeStyles.grow} />
      </View>
      {!valid ? <Text style={financeStyles.error} translate>Укажите корректный период</Text>
        : shifts.isPending ? <Loading />
        : shifts.isError ? <FinanceQueryError error={shifts.error} retry={() => void shifts.refetch()} />
        : (
          <>
            {current ? (
              <View style={financeStyles.card}>
                <Text style={financeStyles.heading} translate>Текущая кассовая смена</Text>
                <FinanceLine label={'Смена №' + current.number} value={financeDateTime(current.openedAt)} />
                <FinanceLine label="По расчёту в кассе" value={financeMoney(current.expectedAmount)} />
                <View style={financeStyles.toolbar}>
                  <Button title="Открыть" size="md" variant="secondary" onPress={() => setSelection(current.id)} />
                  {canManage ? <Button title="Закрыть смену" size="md" onPress={() => setEditing('close')} /> : null}
                </View>
              </View>
            ) : shifts.data.enabled ? (
              canManage ? <Button title="Открыть кассовую смену" size="md" onPress={() => setEditing('open')} /> : null
            ) : <Text style={financeStyles.muted} translate>Кассовые смены выключены</Text>}
            {history.map((shift) => (
              <View style={financeStyles.card} key={shift.id}>
                <Text style={financeStyles.heading} translate>Смена №{shift.number}</Text>
                <FinanceLine label="Открытие" value={financeDateTime(shift.openedAt)} />
                <FinanceLine label="Закрытие" value={financeDateTime(shift.closedAt)} />
                <FinanceLine label="Разница" value={financeMoney(shift.difference)} />
                <Button title="Открыть" size="md" variant="secondary" onPress={() => setSelection(shift.id)} />
              </View>
            ))}
            {!history.length ? <EmptyState text="За выбранный период нет закрытых смен" /> : null}
          </>
        )}
      {row ? <CashShiftDetails key={row.id} shift={row} canManage={canManage} onClose={() => setSelection('')} /> : null}
      {editing && (editing === 'open' || current) ? (
        <CashShiftForm current={editing === 'close' ? current : null} onClose={() => setEditing(null)} />
      ) : null}
    </View>
  );
}

export function CashShiftForm({ current, onClose, endpoint = shiftEndpoint, onComplete }: {
  current: Pick<CashShift, 'id' | 'expectedAmount'> | null;
  onClose: () => void;
  endpoint?: string;
  onComplete?: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [closeStaff, setCloseStaff] = useState(false);
  const [expectedAmount] = useState(current?.expectedAmount);
  const [stale, setStale] = useState(false);
  const { canAction } = usePermissions();
  const canCloseStaff = canAction('closeShift');
  const refresh = useCashShiftRefresh();
  const value = parseMoney(amount);
  return (
    <FinanceForm title={current ? 'Закрытие кассовой смены' : 'Открытие кассовой смены'} onClose={onClose} onComplete={onComplete}
      disabled={value === null || value < 0 || stale} submitLabel={current ? 'Закрыть смену' : 'Открыть'}
      submit={async () => {
        try {
          await api.post(endpoint + (current ? '/close' : '/open'), current ? {
            amount: value, shiftId: current.id, expectedAmount,
            closingComment: comment.trim() || undefined, closeEmployeeShifts: canCloseStaff && closeStaff ? true : undefined,
          } : { amount: value });
        } catch (error) {
          if (isAxiosError(error) && error.response?.status === 409) setStale(true);
          throw error;
        } finally {
          await refresh(!!current && canCloseStaff && closeStaff);
        }
      }}>
      {current ? <FinanceLine label="По расчёту в кассе" value={financeMoney(expectedAmount)} /> : null}
      <MoneyField label={current ? 'Остаток наличных после инкассации' : 'Остаток в кассе'} value={amount} onChange={setAmount} />
      {current ? <>
        <Field label="Комментарий" value={comment} maxLength={500} onChangeText={setComment} />
        {canCloseStaff ? <SwitchField label="Закрыть смены сотрудников" checked={closeStaff} onChange={setCloseStaff} /> : null}
      </> : null}
    </FinanceForm>
  );
}

function operationLabel(operation: Operation) {
  if (operation.reconciliation === 'open') return 'Сверка при открытии';
  if (operation.reconciliation === 'close') return 'Сверка при закрытии';
  if (operation.collection) return 'Инкассация';
  if (operation.kind === 'sale' || operation.kind === 'refund') return entryLabels[operation.kind] + (operation.cash ? ' наличными' : ' безналично');
  return entryLabels[operation.kind];
}

function CashShiftDetails({ shift, canManage, onClose }: { shift: CashShift; canManage: boolean; onClose: () => void }) {
  const [operation, setOperation] = useState<Operation | 'new' | null>(null);
  const [removal, setRemoval] = useState<Operation>();
  const [count, setCount] = useState<EditableCount>();
  const endpoint = shiftEndpoint + '/' + shift.id;
  const movements = useQuery({
    queryKey: [...cashShiftKey, 'movements', shift.id],
    queryFn: async ({ signal }) => (await api.get<Operation[]>(endpoint + '/movements', { signal })).data,
  });
  const refresh = useCashShiftRefresh();
  return (
    <BottomSheet visible title={'Кассовая смена №' + shift.number} maxHeight="92%" onClose={onClose}>
      <SheetScrollView contentContainerStyle={financeStyles.body}>
        <View style={financeStyles.card}>
          <FinanceLine label="Открытие" value={financeDateTime(shift.openedAt)} />
          <FinanceLine label="Открыл" value={shift.openedByName ?? '—'} />
          <FinanceLine label="Закрытие" value={financeDateTime(shift.closedAt)} />
          <FinanceLine label="Закрыл" value={shift.closedByName ?? '—'} />
          {shift.closingComment ? <Text style={financeStyles.muted}>{shift.closingComment}</Text> : null}
          <FinanceLine label="Наличные в начале смены" value={financeMoney(shift.openingAmount)} />
          <FinanceLine label="Разница при открытии" value={financeMoney(shift.openingDifference)} />
          <FinanceLine label="Инкассация" value={financeMoney(shift.collectionAmount)} />
          <FinanceLine label="Книжный баланс" value={financeMoney(shift.expectedAmount)} />
          <FinanceLine label="Фактический баланс" value={financeMoney(shift.actualAmount)} />
          <FinanceLine label="Разница" value={financeMoney(shift.difference)} />
        </View>
        {canManage ? <View style={financeStyles.toolbar}>
          <Button title="Исправить остаток при открытии" variant="secondary" size="md" onPress={() => setCount('openingAmount')} />
          {shift.actualAmount !== null ? (
            <Button title="Исправить остаток при закрытии" variant="secondary" size="md" onPress={() => setCount('actualAmount')} />
          ) : null}
          <Button title="Добавить транзакцию" size="md" onPress={() => setOperation('new')} />
        </View> : null}
        <Text style={financeStyles.heading} translate>Транзакции смены</Text>
        {movements.isPending ? <Loading /> : null}
        {movements.isError ? <FinanceQueryError error={movements.error} retry={() => void movements.refetch()} /> : null}
        {movements.isSuccess && !movements.data.length ? <EmptyState text="По этой смене нет операций" /> : null}
        {movements.data?.map((row) => (
          <View key={row.id} style={financeStyles.card}>
            <FinanceLine label={operationLabel(row)} value={financeMoney(row.amount)} />
            <Text style={financeStyles.muted}>{financeDateTime(row.occurredAt)} · {row.actorName ?? '—'}</Text>
            {row.category ? <Text style={financeStyles.muted}>{row.category}</Text> : null}
            {row.note ? <Text style={financeStyles.muted}>{row.note}</Text> : null}
            {row.deletedAt ? <FinanceLine label="Удалена" value={financeDateTime(row.deletedAt)} /> : null}
            {!row.deletedAt && row.editable && canManage ? <View style={financeStyles.toolbar}>
              <Button title="Редактировать" size="md" variant="secondary" onPress={() => setOperation(row)} />
              <Button title="Удалить" size="md" variant="secondary" danger onPress={() => setRemoval(row)} />
            </View> : null}
          </View>
        ))}
        {operation ? <CashOperationForm endpoint={endpoint} operation={operation === 'new' ? undefined : operation} onClose={() => setOperation(null)} /> : null}
        {count ? <CashCountForm key={count} endpoint={endpoint} field={count} amount={shift[count] ?? 0} onClose={() => setCount(undefined)} /> : null}
        {removal ? <FinanceForm title="Удалить транзакцию?" submitLabel="Удалить" danger onClose={() => setRemoval(undefined)}
          submit={async () => { await api.delete(endpoint + '/operations/' + removal.id); await refresh(); }}>
          <FinanceLine label={operationLabel(removal)} value={financeMoney(removal.amount)} />
        </FinanceForm> : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

function CashCountForm({ endpoint, field, amount, onClose }: { endpoint: string; field: EditableCount; amount: number; onClose: () => void }) {
  const [value, setValue] = useState(String(amount));
  const parsed = parseMoney(value);
  const refresh = useCashShiftRefresh();
  return (
    <FinanceForm title="Исправить остаток" disabled={parsed === null || parsed < 0} onClose={onClose}
      submit={async () => { await api.patch(endpoint + '/counts', { [field]: parsed }); await refresh(); }}>
      <MoneyField label="Фактический остаток" value={value} onChange={setValue} />
    </FinanceForm>
  );
}

const kinds: { value: OperationKind; label: string }[] = [
  { value: 'expense', label: 'Расход' }, { value: 'income', label: 'Внесение' }, { value: 'collection', label: 'Инкассация' },
];

export function CashOperationForm({ endpoint, onClose, operation, cashier = false }: {
  endpoint: string;
  onClose: () => void;
  operation?: Operation;
  cashier?: boolean;
}) {
  const [requestKey] = useState(randomUUID);
  const [kind, setKind] = useState<OperationKind>(operation?.kind === 'transfer' ? 'collection' : operation?.kind === 'income' ? 'income' : 'expense');
  const [amount, setAmount] = useState(operation ? String(Math.abs(operation.amount)) : '');
  const [note, setNote] = useState(operation?.note ?? '');
  const [categoryId, setCategoryId] = useState(operation?.categoryId ?? '');
  const initial = operation ? financeLocalTime(new Date(operation.occurredAt)) : '';
  const [date, setDate] = useState(initial.slice(0, 10));
  const [time, setTime] = useState(initial.slice(11));
  const baseEndpoint = cashier ? '/cash-shifts' : shiftEndpoint;
  const categories = useQuery({
    queryKey: [...cashShiftKey, 'operation-categories', baseEndpoint],
    queryFn: async ({ signal }) => (await api.get<FinanceCategory[]>(baseEndpoint + '/operation-categories', { signal })).data,
    enabled: kind !== 'collection',
  });
  const refresh = useCashShiftRefresh();
  const timestamp = date ? transactionDate(date, time || '00:00') : null;
  const parsed = parseMoney(amount);
  const options = categoryChoices(categories.data ?? [], (category) => category.kind === kind || category.kind === 'both');
  return (
    <FinanceForm title={operation ? 'Редактирование транзакции' : 'Создать транзакцию'} submitLabel={operation ? 'Сохранить' : 'Добавить'}
      disabled={parsed == null || parsed <= 0 || (!!date && !timestamp)} onClose={onClose}
      submit={async () => {
        const values = { kind, amount: parsed, note: note.trim(), categoryId: kind === 'collection' ? undefined : categoryId || undefined,
          occurredAt: cashier || initial === date + 'T' + time ? undefined : timestamp?.toISOString() };
        if (operation) await api.patch(endpoint + '/operations/' + operation.id, values);
        else await api.post(endpoint + '/operations', { ...values, requestKey });
        await refresh();
      }}>
      <SelectField label="Тип транзакции" value={kind} options={kinds} onChange={(value) => { setKind(value); setCategoryId(''); }} />
      <MoneyField value={amount} onChange={setAmount} />
      {kind === 'collection' ? <Text style={financeStyles.muted} translate>Наличные будут переведены из кассы в сейф.</Text> : (
        <>
          <SelectField label="Категория" value={categoryId} onChange={setCategoryId}
            options={[{ value: '', label: 'Кассовые смены' }, ...options,
              ...(categoryId && !options.some(({ value }) => value === categoryId) ? [{ value: categoryId, label: 'Текущая категория' }] : [])]} />
          {categories.isError ? <FinanceQueryError error={categories.error} retry={() => void categories.refetch()} /> : null}
        </>
      )}
      {!cashier ? (
        <>
          <View style={financeStyles.row}>
            <DateField label="Дата" value={date} onChangeText={setDate} containerStyle={financeStyles.grow} />
            <Field label="Время" value={time} onChangeText={setTime} maxLength={5} placeholder="чч:мм" />
          </View>
          <Text style={financeStyles.muted} translate>Если дата не указана, используется время проведения или закрытия смены.</Text>
        </>
      ) : null}
      <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={500} multiline />
    </FinanceForm>
  );
}
