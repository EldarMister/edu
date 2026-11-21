import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { StyleSheet } from 'react-native';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, EmptyState, Field, Loading } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { useFinanceWrites, usePayroll, useSalaryAccrual,
  type FinanceAccount, type FinanceData, type PayrollAccrual, type PayrollReport, type PayrollStaffRow, type SalaryAccrualDetails } from './api';
import { FinanceForm, FinanceLine, FinanceQueryError, MoneyField, SelectField, financeStyles } from './components';
import { financeDateTime, financeDay, financeMoney, parseMoney } from './format';
import { choice } from './rules';

type AccrualMode = 'calculated' | 'manual' | 'supplemental';
type PayrollFilter = '' | 'calculated' | 'due';
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const filters: { value: PayrollFilter; label: string }[] = [
  { value: '', label: 'Все сотрудники' }, { value: 'calculated', label: 'Нужно начислить' },
  { value: 'due', label: 'Есть остаток к выплате' },
];
const summaryFields = [
  { key: 'estimate', label: 'Рассчитано' }, { key: 'accrued', label: 'Начислено' },
  { key: 'paid', label: 'Выплачено' }, { key: 'due', label: 'К выплате' },
] as const;

function adjacentMonth(month: string, offset: number) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function remainingAccrual(accrual: PayrollAccrual) {
  return Math.round((accrual.amount - accrual.paidAmount) * 100) / 100;
}

export function PayrollRegister({ data }: { data: FinanceData }) {
  const currentMonth = financeDay().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('');
  const [filter, setFilter] = useState<PayrollFilter>('');
  const [selection, setSelection] = useState('');
  const [manualAccrualOpen, setManualAccrualOpen] = useState(false);
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= '0001-01' && month <= currentMonth;
  const report = usePayroll(month, validMonth && data.canViewAll);
  const staff = report.data?.staff ?? [];
  const positions = [...new Set(staff.map((row) => row.position).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ru'));
  const effectivePosition = positions.includes(position) ? position : '';
  const term = search.trim().toLocaleLowerCase('ru-RU');
  const employees = staff.filter((row) => (!effectivePosition || row.position === effectivePosition)
    && row.name.toLocaleLowerCase('ru-RU').includes(term)
    && (filter !== 'calculated' || row.available > 0)
    && (filter !== 'due' || row.due > 0));
  const selected = staff.find((employee) => employee.userId === selection);
  const accrualEmployees = new Map(data.employees.map(({ id, name }) => [id, { id, name }]));
  for (const row of staff) accrualEmployees.set(row.userId, { id: row.userId, name: row.name });

  function changeMonth(value: string) {
    setMonth(value);
    setSelection('');
  }

  if (!data.canViewAll) return <EmptyState text="Нет доступа к ведомости зарплаты" />;

  return (
    <View style={financeStyles.stack}>
      <View style={financeStyles.toolbar}>
        <MonthButton direction={-1} disabled={validMonth && month === '0001-01'}
          onPress={() => changeMonth(adjacentMonth(validMonth ? month : currentMonth, -1))} />
        <Field label="Расчётный месяц" value={month} onChangeText={changeMonth} placeholder="ГГГГ-ММ" maxLength={7} containerStyle={financeStyles.grow} />
        <MonthButton direction={1} disabled={!validMonth || month === currentMonth}
          onPress={() => changeMonth(adjacentMonth(month, 1))} />
      </View>
      <View style={financeStyles.toolbar}>
        <Field label="Поиск сотрудника" value={search} onChangeText={setSearch} containerStyle={financeStyles.grow} />
        <Select title="Должность" value={effectivePosition} onChange={setPosition}
          options={[{ value: '', label: 'Все должности' }, ...positions.map((name) => ({ value: name, label: name, translate: false }))]} />
        <Select title="Состояние расчёта" value={filter} onChange={setFilter} options={filters} />
      </View>
      {!validMonth ? <Text style={financeStyles.error} translate>Укажите расчётный месяц в формате ГГГГ-ММ</Text>
        : report.isPending ? <Loading />
        : report.isError ? <FinanceQueryError error={report.error} retry={() => void report.refetch()} />
        : (
          <>
            {data.canManage && accrualEmployees.size > 0 ? (
              <Button title="Начислить зарплату вручную" size="md" onPress={() => setManualAccrualOpen(true)} />
            ) : null}
            {employees.map((employee) => (
              <View key={employee.userId} style={financeStyles.card}>
                <View style={financeStyles.row}>
                  <Text style={[financeStyles.heading, financeStyles.grow]}>{employee.name}</Text>
                  <Text style={financeStyles.muted}>{employee.position}</Text>
                </View>
                {summaryFields.map(({ key, label }) => <FinanceLine key={key} label={label} value={financeMoney(employee[key])} />)}
                <Button title="Расчёт" size="md" variant="secondary" onPress={() => setSelection(employee.userId)} />
              </View>
            ))}
            {employees.length > 0 ? <View style={financeStyles.card}>
              <Text style={financeStyles.heading} translate>Итого</Text>
              {summaryFields.map(({ key, label }) => <FinanceLine key={key} label={label}
                value={financeMoney(employees.reduce((cents, row) => cents + Math.round(row[key] * 100), 0) / 100)} />)}
            </View> : <EmptyState text="Сотрудники не найдены" />}
          </>
        )}
      {manualAccrualOpen && data.canManage ? <AccrualForm month={month} mode="manual" employees={[...accrualEmployees.values()]}
        onClose={() => setManualAccrualOpen(false)} /> : null}
      {selected ? <PayrollEmployeeDetails key={month + ':' + selected.userId} employee={selected} month={month} data={data}
        entries={report.data?.records.filter(({ userId }) => userId === selected.userId) ?? []} onClose={() => setSelection('')} /> : null}
    </View>
  );
}

function MonthButton({ direction, disabled, onPress }: { direction: -1 | 1; disabled: boolean; onPress: () => void }) {
  return (
    <FastPressable accessibilityRole="button" accessibilityLabel={direction === -1 ? 'Предыдущий месяц' : 'Следующий месяц'}
      accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.monthButton, disabled ? styles.disabled : null]}>
      <PwaIcon name={direction === -1 ? 'chevronLeft' : 'chevronRight'} size={20} color={colors.textSecondary} />
    </FastPressable>
  );
}

function PayrollEmployeeDetails({ employee, month, data, entries, onClose }: {
  employee: PayrollStaffRow; month: string; data: FinanceData; entries: PayrollReport['records']; onClose: () => void;
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [editor, setEditor] = useState<AccrualMode | 'payout' | null>(null);
  const [historyId, setHistoryId] = useState('');
  const payable = entries.filter((entry) => !entry.voidedAt && remainingAccrual(entry) > 0);
  const canPay = data.canManage && data.accounts.length > 0 && payable.length > 0;

  return (
    <BottomSheet visible title={employee.name} onClose={onClose} maxHeight="92%">
      <SheetScrollView contentContainerStyle={financeStyles.body}>
        <View style={financeStyles.card}>
          <Text style={financeStyles.muted}>{monthFormat.format(new Date(month + '-01T00:00:00Z'))} · {employee.position || '—'}</Text>
          {summaryFields.map(({ key, label }) => <FinanceLine key={key} label={label} value={financeMoney(employee[key])} />)}
        </View>
        {data.canManage ? <View style={financeStyles.toolbar}>
          {employee.available > 0 ? <Button title="Начислить по ставкам" size="md" onPress={() => setEditor('calculated')} /> : null}
          <Button title="Начислить вручную" variant="secondary" size="md" onPress={() => setEditor('manual')} />
          <Button title="Премия или доплата" variant="secondary" size="md" onPress={() => setEditor('supplemental')} />
          {canPay ? <Button title="Выплатить зарплату" size="md" onPress={() => setEditor('payout')} /> : null}
        </View> : null}
        <View style={financeStyles.card}>
          <FastPressable accessibilityRole="button" accessibilityLabel="Расшифровка расчёта"
            accessibilityState={{ expanded: breakdownOpen }} style={financeStyles.row} onPress={() => setBreakdownOpen((isOpen) => !isOpen)}>
            <Text style={financeStyles.heading} translate>Расшифровка расчёта</Text>
            <PwaIcon name={breakdownOpen ? 'chevronDown' : 'chevronRight'} size={20} color={colors.textSecondary} />
          </FastPressable>
          {breakdownOpen ? <PayrollBreakdown employee={employee} /> : null}
        </View>
        <Text style={financeStyles.heading} translate>Начисления за месяц</Text>
        {entries.length ? entries.map((entry) => <View key={entry.id} style={financeStyles.card}>
          <View style={financeStyles.row}>
            <Text style={[financeStyles.label, financeStyles.grow]} translate>
              {entry.supplemental ? 'Премия или доплата' : entry.calculation ? 'По расчёту' : 'Вручную'}
            </Text>
            <Text style={financeStyles.muted}>{financeDateTime(entry.createdAt)}</Text>
          </View>
          <FinanceLine label="Сумма начисления" value={financeMoney(entry.amount)} />
          <FinanceLine label="Выплачено" value={financeMoney(entry.paidAmount)} />
          <FinanceLine label="К выплате" value={entry.voidedAt ? 'Отменено' : financeMoney(remainingAccrual(entry))} />
          {entry.note ? <Text style={financeStyles.muted}>{entry.note}</Text> : null}
          <Button title={data.canManage ? 'История и исправления' : 'История'} variant="secondary" size="md"
            onPress={() => setHistoryId(entry.id)} />
        </View>) : <EmptyState text="Начислений за месяц нет" />}
      </SheetScrollView>
      {historyId ? <AccrualDetails key={historyId} id={historyId} data={data} onClose={() => setHistoryId('')} /> : null}
      {editor === 'payout' && canPay ? <PayoutForm accrual={payable[0]} accruals={payable} accounts={data.accounts} onClose={() => setEditor(null)} /> : null}
      {editor && editor !== 'payout' && data.canManage ? <AccrualForm month={month} mode={editor} employee={employee}
        employees={[]} onClose={() => setEditor(null)} /> : null}
    </BottomSheet>
  );
}

function PayrollBreakdown({ employee }: { employee: PayrollStaffRow }) {
  const { rates } = employee;
  const units = (amount: number | null) => amount == null ? '—' : number.format(amount);
  const lines = [
    { label: 'За часы', rate: financeMoney(rates.hourly), base: units(employee.hours), amount: employee.hourlyPay },
    { label: 'За смены', rate: financeMoney(rates.perShift), base: units(employee.shifts), amount: employee.shiftPay },
    { label: 'Месячная ставка', rate: financeMoney(rates.monthly), base: units(employee.days), amount: employee.monthlyPay },
    { label: 'Личные продажи', rate: number.format(rates.personalPercent) + '%', base: financeMoney(employee.personalSales), amount: employee.personalCommission },
    { label: 'Продажи за рабочую смену', rate: number.format(rates.shiftPercent) + '%', base: financeMoney(employee.shiftSales), amount: employee.shiftCommission },
  ];
  return <>
    {lines.map(({ label, rate, base, amount }) => <View key={label} style={[financeStyles.group, financeStyles.divider]}>
      <FinanceLine label={label} value={financeMoney(amount)} />
      <FinanceLine label="Ставка" value={rate} />
      <FinanceLine label="За месяц" value={base} />
    </View>)}
    <Text style={financeStyles.muted} translate>
      Месячная ставка делится на календарные дни месяца и умножается на отработанные дни. Учитываются закрытые рабочие смены.
    </Text>
  </>;
}

function AccrualForm({ month, mode, employee, employees, onClose }: {
  month: string; mode: AccrualMode; employee?: PayrollStaffRow; employees: { id: string; name: string }[]; onClose: () => void;
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
          options={[{ value: '', label: 'Выберите сотрудника' }, ...employees.map(choice)]} />
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

function PayoutForm({ accrual: initialAccrual, accruals, accounts, onClose }: {
  accrual: PayrollAccrual; accruals?: PayrollAccrual[]; accounts: FinanceAccount[]; onClose: () => void;
}) {
  const { payout } = useFinanceWrites();
  const [requestKey] = useState(randomUUID);
  const [accrualId, setAccrualId] = useState(initialAccrual.id);
  const accrual = accruals?.find(({ id }) => id === accrualId) ?? (!accruals ? initialAccrual : undefined);
  const remainder = accrual ? remainingAccrual(accrual) : 0;
  const [amount, setAmount] = useState(() => String(remainingAccrual(initialAccrual)));
  const [accountId, setAccountId] = useState(accounts.find(({ isDefault }) => isDefault)?.id ?? accounts[0]?.id ?? '');
  const [note, setNote] = useState('');
  const parsed = parseMoney(amount);
  return (
    <FinanceForm title="Выплата зарплаты" submitLabel="Выплатить" onClose={onClose}
      disabled={!accrual || !!accrual.voidedAt || !accounts.some(({ id }) => id === accountId) || parsed == null || parsed <= 0 || parsed > remainder}
      submit={() => payout.mutateAsync({ id: accrualId, values: { requestKey, accountId, amount: parsed!, note: note.trim() || undefined } })}>
      <FinanceLine label="Сотрудник" value={initialAccrual.employeeName} />
      {accruals && (accruals.length > 1 || !accrual) ? <SelectField label="Что выплатить" value={accrual?.id ?? ''}
        options={accruals.map((entry) => ({ value: entry.id, label: (entry.supplemental ? 'Доплата' : 'Зарплата') + ' · ' +
          financeDateTime(entry.createdAt) + ' · ' + financeMoney(remainingAccrual(entry)) }))}
        onChange={(id) => {
          const selected = accruals.find((entry) => entry.id === id);
          if (!selected) return;
          setAccrualId(id);
          setAmount(String(remainingAccrual(selected)));
        }} /> : null}
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

const styles = StyleSheet.create({
  monthButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
    borderColor: colors.border, borderRadius: 8, backgroundColor: colors.card },
  disabled: { opacity: 0.45 },
});
