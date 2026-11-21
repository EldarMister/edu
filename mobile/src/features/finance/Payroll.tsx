import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { Select } from '@/components/Select';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, EmptyState, Field, Loading } from '@/components/ui';
import { useFinanceWrites, usePayroll, useSalaryAccrual,
  type FinanceAccount, type FinanceData, type PayrollAccrual, type PayrollStaffRow, type SalaryAccrualDetails } from './api';
import { FinanceForm, FinanceLine, FinanceQueryError, MoneyField, SelectField, financeStyles } from './components';
import { financeDateTime, financeDay, financeMoney, parseMoney } from './format';
import { choice } from './rules';

type AccrualMode = 'calculated' | 'manual' | 'supplemental';

export function PayrollRegister({ data }: { data: FinanceData }) {
  const currentMonth = financeDay().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState('');
  const [positionId, setPositionId] = useState('');
  const [selection, setSelection] = useState('');
  const [editor, setEditor] = useState<{ mode: AccrualMode; row?: PayrollStaffRow }>();
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= currentMonth;
  const report = usePayroll(month, validMonth && data.canViewAll);
  const term = search.trim().toLocaleLowerCase('ru-RU');
  const employees = report.data?.staff.filter((row) => (!positionId || row.positionId === positionId) &&
    row.name.toLocaleLowerCase('ru-RU').includes(term)) ?? [];
  const records = report.data?.records ?? [];

  if (!data.canViewAll) return <EmptyState text="Нет доступа к ведомости зарплаты" />;

  return (
    <View style={financeStyles.stack}>
      <View style={financeStyles.toolbar}>
        <Field label="Расчётный месяц" value={month} onChangeText={setMonth} placeholder="ГГГГ-ММ" maxLength={7} containerStyle={financeStyles.grow} />
        <Field label="Поиск сотрудника" value={search} onChangeText={setSearch} containerStyle={financeStyles.grow} />
        <Select title="Должность" value={positionId} onChange={setPositionId}
          options={[{ value: '', label: 'Все должности' }, ...data.positions.map(choice)]} />
      </View>
      {!validMonth ? <Text style={financeStyles.error} translate>Укажите расчётный месяц в формате ГГГГ-ММ</Text>
        : report.isPending ? <Loading />
        : report.isError ? <FinanceQueryError error={report.error} retry={() => void report.refetch()} />
        : (
          <>
            {data.canManage ? <Button title="Начислить зарплату вручную" size="md" onPress={() => setEditor({ mode: 'manual' })} /> : null}
            {employees.map((employee) => (
              <View key={employee.userId} style={financeStyles.card}>
                <View style={financeStyles.row}>
                  <Text style={[financeStyles.heading, financeStyles.grow]}>{employee.name}</Text>
                  <Text style={financeStyles.muted}>{employee.position}</Text>
                </View>
                <FinanceLine label="По ставкам" value={financeMoney(employee.estimate)} />
                <FinanceLine label="Начислено" value={financeMoney(employee.accrued)} />
                <FinanceLine label="Выплачено" value={financeMoney(employee.paid)} />
                <FinanceLine label="К выплате" value={financeMoney(employee.due)} />
                {employee.timeTrackingAvailable ? (
                  <View style={financeStyles.divider}>
                    <FinanceLine label="Часы" value={String(employee.hours ?? '—')} />
                    <FinanceLine label="Смены" value={String(employee.shifts ?? '—')} />
                  </View>
                ) : null}
                {data.canManage ? (
                  <View style={financeStyles.toolbar}>
                    {employee.available > 0 ? <Button title="Начислить по ставкам" size="md" variant="secondary" onPress={() => setEditor({ mode: 'calculated', row: employee })} /> : null}
                    <Button title="Премия или доплата" size="md" variant="secondary" onPress={() => setEditor({ mode: 'supplemental', row: employee })} />
                  </View>
                ) : null}
                {records.filter((record) => record.userId === employee.userId).map((record) => (
                  <Button key={record.id} title={(record.supplemental ? 'Доплата' : 'Начисление') + ' · ' + financeMoney(record.amount)}
                    size="md" variant="secondary" onPress={() => setSelection(record.id)} />
                ))}
              </View>
            ))}
            {employees.length === 0 ? <EmptyState text="Сотрудники не найдены" /> : null}
          </>
        )}
      {editor ? <AccrualForm month={month} mode={editor.mode} employee={editor.row} employees={report.data?.staff ?? []}
        onClose={() => setEditor(undefined)} /> : null}
      {selection ? <AccrualDetails id={selection} data={data} onClose={() => setSelection('')} /> : null}
    </View>
  );
}

function AccrualForm({ month, mode, employee, employees, onClose }: {
  month: string; mode: AccrualMode; employee?: PayrollStaffRow; employees: PayrollStaffRow[]; onClose: () => void;
}) {
  const { accrue } = useFinanceWrites();
  const [requestKey] = useState(randomUUID);
  const [userId, setUserId] = useState(employee?.userId ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const calculated = mode === 'calculated';
  const value = calculated ? employee?.available : parseMoney(amount);
  return (
    <FinanceForm title={calculated ? 'Подтвердить расчёт зарплаты' : mode === 'supplemental' ? 'Премия или доплата' : 'Начислить зарплату вручную'}
      submitLabel="Начислить" onClose={onClose} disabled={!userId || value == null || value <= 0}
      submit={() => accrue.mutateAsync({
        userId, month, requestKey, amount: value!, calculated, supplemental: mode === 'supplemental', note: note.trim() || undefined,
      })}>
      <FinanceLine label="Расчётный месяц" value={month} />
      {employee ? <FinanceLine label="Сотрудник" value={employee.name} /> : (
        <SelectField label="Сотрудник" value={userId} onChange={setUserId}
          options={[{ value: '', label: 'Выберите сотрудника' }, ...employees.map(({ userId: id, name }) => choice({ id, name }))]} />
      )}
      {calculated ? <FinanceLine label="К начислению за месяц" value={financeMoney(value)} />
        : <MoneyField label={mode === 'supplemental' ? 'Сумма доплаты' : 'Сумма зарплаты'} value={amount} onChange={setAmount} />}
      <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={500} multiline />
    </FinanceForm>
  );
}

function AccrualDetails({ id, data, onClose }: { id: string; data: FinanceData; onClose: () => void }) {
  const result = useSalaryAccrual(id);
  const row = result.data;
  const [editor, setEditor] = useState<'pay' | 'edit' | 'cancel' | 'reverse' | null>(null);
  const [paymentId, setPaymentId] = useState('');
  const closeEditor = () => setEditor(null);
  return (
    <BottomSheet visible title="Начисление зарплаты" onClose={onClose} maxHeight="92%">
      {result.isPending ? <Loading /> : result.isError ? (
        <FinanceQueryError error={result.error} retry={() => void result.refetch()} />
      ) : row ? (
        <SheetScrollView contentContainerStyle={financeStyles.body}>
          <View style={financeStyles.card}>
            <Text style={financeStyles.heading}>{row.employeeName}</Text>
            <FinanceLine label="Расчётный месяц" value={row.month} />
            <FinanceLine label="Начислено" value={financeMoney(row.amount)} />
            <FinanceLine label="Выплачено" value={financeMoney(row.paidAmount)} />
            <FinanceLine label="К выплате" value={financeMoney(row.amount - row.paidAmount)} />
            <FinanceLine label="Создал" value={row.createdByName} />
            {row.note ? <Text style={financeStyles.muted}>{row.note}</Text> : null}
            {row.voidedAt ? <FinanceLine label="Отменено" value={financeDateTime(row.voidedAt)} /> : null}
            {row.voidReason ? <Text style={financeStyles.muted}>{row.voidReason}</Text> : null}
          </View>
          {!row.voidedAt && data.canManage ? <View style={financeStyles.toolbar}>
            {row.amount > row.paidAmount && data.accounts.length ? <Button title="Выплатить" size="md" onPress={() => setEditor('pay')} /> : null}
            <Button title="Исправить начисление" size="md" variant="secondary" onPress={() => setEditor('edit')} />
            {!row.paidAmount ? <Button title="Отменить начисление" size="md" variant="secondary" danger onPress={() => setEditor('cancel')} /> : null}
          </View> : null}
          {row.payments.length ? <Text style={financeStyles.heading} translate>Выплаты</Text> : null}
          {row.payments.map((payment) => (
            <View key={payment.id} style={financeStyles.card}>
              <FinanceLine label={payment.accountName} value={financeMoney(payment.amount)} />
              <Text style={financeStyles.muted}>{financeDateTime(payment.occurredAt)} · {payment.actorName}</Text>
              {payment.note ? <Text style={financeStyles.muted}>{payment.note}</Text> : null}
              {payment.reversedAt ? <FinanceLine label="Сторнирована" value={financeDateTime(payment.reversedAt)} /> : null}
              {data.canManage && payment.reversible ? <Button title="Отменить ошибочную выплату" variant="secondary" size="md" danger
                onPress={() => { setPaymentId(payment.id); setEditor('reverse'); }} /> : null}
            </View>
          ))}
          {row.history.length ? <Text style={financeStyles.heading} translate>История изменений</Text> : null}
          {row.history.map((revision) => (
            <View key={revision.revision} style={financeStyles.card}>
              <FinanceLine label={revision.type === 'cancel' ? 'Отмена начисления' : 'Исправление'}
                value={financeDateTime(revision.at)} />
              <Text style={financeStyles.muted}>{revision.actorName} · {revision.reason}</Text>
              <Text style={financeStyles.muted}>{financeMoney(revision.before.amount)} → {financeMoney(revision.after.amount)}</Text>
            </View>
          ))}
          {editor === 'pay' ? <PayoutForm accrual={row} accounts={data.accounts} onClose={closeEditor} /> : null}
          {editor && editor !== 'pay' ? <CorrectionForm key={editor} mode={editor} accrual={row} paymentId={paymentId} onClose={closeEditor} /> : null}
        </SheetScrollView>
      ) : null}
    </BottomSheet>
  );
}

function PayoutForm({ accrual, accounts, onClose }: { accrual: PayrollAccrual; accounts: FinanceAccount[]; onClose: () => void }) {
  const { payout } = useFinanceWrites();
  const [requestKey] = useState(randomUUID);
  const remainder = Math.round((accrual.amount - accrual.paidAmount) * 100) / 100;
  const [amount, setAmount] = useState(String(remainder));
  const [accountId, setAccountId] = useState(accounts.find(({ isDefault }) => isDefault)?.id ?? accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const parsed = parseMoney(amount);
  return (
    <FinanceForm title="Выплата зарплаты" submitLabel="Выплатить" onClose={onClose}
      disabled={!accountId || parsed == null || parsed <= 0 || parsed > remainder}
      submit={() => payout.mutateAsync({ id: accrual.id, values: { requestKey, accountId, amount: parsed!, note: note.trim() || undefined } })}>
      <FinanceLine label="К выплате" value={financeMoney(remainder)} />
      <SelectField label="Счёт списания" value={accountId} options={accounts.map(choice)} onChange={setAccountId} />
      <MoneyField label="Сумма выплаты" value={amount} onChange={setAmount} />
      <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={500} multiline />
    </FinanceForm>
  );
}

function CorrectionForm({ mode, accrual, paymentId, onClose }: {
  mode: 'edit' | 'cancel' | 'reverse'; accrual: SalaryAccrualDetails; paymentId: string; onClose: () => void;
}) {
  const { editAccrual, cancelAccrual, reverseSalaryPayment } = useFinanceWrites();
  const [requestKey] = useState(randomUUID);
  const [revision] = useState(accrual.revision);
  const [amount, setAmount] = useState(String(accrual.amount));
  const [note, setNote] = useState(accrual.note ?? '');
  const [reason, setReason] = useState('');
  const parsed = parseMoney(amount);
  const title = mode === 'edit' ? 'Исправить начисление' : mode === 'cancel' ? 'Отменить начисление' : 'Отменить ошибочную выплату';
  return (
    <FinanceForm title={title} submitLabel={mode === 'edit' ? 'Сохранить' : title} onClose={onClose} danger={mode !== 'edit'}
      disabled={!reason.trim() || (mode === 'edit' && (parsed == null || parsed <= 0 || parsed < accrual.paidAmount))}
      submit={() => {
        const input = { id: accrual.id, requestKey, revision, reason: reason.trim() };
        if (mode === 'edit') return editAccrual.mutateAsync({ ...input, amount: parsed!, note: note.trim() });
        if (mode === 'cancel') return cancelAccrual.mutateAsync(input);
        return reverseSalaryPayment.mutateAsync({ id: accrual.id, paymentId, reason: reason.trim() });
      }}>
      {mode === 'edit' ? <>
        <FinanceLine label="Выплачено" value={financeMoney(accrual.paidAmount)} />
        <MoneyField value={amount} onChange={setAmount} />
        <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={500} multiline />
      </> : null}
      <Field label="Причина исправления" value={reason} onChangeText={setReason} maxLength={500} multiline />
    </FinanceForm>
  );
}
