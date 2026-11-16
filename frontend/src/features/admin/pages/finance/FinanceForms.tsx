import { useId, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { DatePicker } from '@/components/DatePicker';
import { apiError } from '@/lib/api';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { EditorPage } from '../warehouse/EditorPage';
import { DocumentField } from '../warehouse/WarehouseUi';
import {
  type AccountType, type CategoryKind, type FinanceAccount, type FinanceCategory, type FinanceEntry, type PayrollAccrual,
  type TransactionKind, useFinanceWrites, usePayroll,
} from './api';
import { entryLabel, financeDateTime, financeDay, financeLocalTime, financeMoney, parseMoney } from './finance-format';
import { categoryAccepts, categoryAncestors, categoryOptions } from './category-options';

const accountTypes = [{ value: 'cash', label: 'Наличные' }, { value: 'noncash', label: 'Безналичный счёт' }] as const;
const categoryKinds = [{ value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }] as const;
const transactionTypes = [categoryKinds[1], categoryKinds[0], { value: 'transfer', label: 'Перевод' }] as const;
const optionFor = ({ id, name }: { id: string; name: string }) => ({ value: id, label: name });

function Choice<T extends string>({ label, value, onChange, options, empty }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  empty?: string;
}) {
  return <DocumentField label={label}>
    <select className="input w-full" aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {empty && <option value="">{empty}</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </DocumentField>;
}

function Amount({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <DocumentField label={label}>
    <input className="input w-full tabular-nums" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0,00" maxLength={17} />
    {hint && <small className="mt-1.5 block text-text-muted">{hint}</small>}
  </DocumentField>;
}

function OperationKind<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const group = useId();
  return <DocumentField label={label}>
    <span className="finance-operation-kind">
      {options.map((option) => <label key={option.value}>
        <input type="radio" name={group} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </span>
  </DocumentField>;
}

function Comment({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const input = { className: 'input w-full', value, maxLength: 500,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  return <DocumentField label="Комментарий">{compact ? <input {...input} /> : <textarea {...input} rows={3} />}</DocumentField>;
}

function FormPage({ children, title, onClose, onSubmit, submitLabel = 'Сохранить', disabled = false, dialog = false, suspended = false }: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  onSubmit: () => Promise<unknown>;
  submitLabel?: string;
  disabled?: boolean;
  dialog?: boolean;
  suspended?: boolean;
}) {
  const id = useId();
  const busy = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { markSaved } = useEditorDirty(dirty);
  const close = () => { if (!busy.current) onClose(); };
  const save =
    <button form={id} type="submit" className="btn-primary btn-md" disabled={disabled || saving}>{saving ? 'Сохранение…' : submitLabel}</button>;
  const footer = dialog ? <div className="finance-transaction-footer">
    {save}
    <button type="button" className="btn-secondary btn-md" onClick={close} disabled={saving}>Отменить</button>
  </div> : save;
  const body = <form id={id} onChangeCapture={() => setDirty(true)} onSubmit={async (event) => {
      event.preventDefault();
      if (disabled || busy.current) return;
      busy.current = true;
      setSaving(true);
      setError('');
      try {
        await onSubmit();
        markSaved();
        onClose();
      } catch (cause) {
        setError(apiError(cause));
      } finally {
        busy.current = false;
        setSaving(false);
      }
    }} className={dialog ? undefined : 'poster-form poster-form--directory'}>
      <fieldset disabled={saving} className="min-w-0 space-y-4">{children}</fieldset>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
    </form>;
  return dialog
    ? <Modal open title={title} onClose={close} footer={footer} panelClassName="finance-transaction-modal max-w-[520px]" suspended={suspended}>{body}</Modal>
    : <EditorPage title={title} onClose={close} footer={footer}>{body}</EditorPage>;
}

export function AccountForm({ account, onClose }: { account?: FinanceAccount; onClose: () => void }) {
  const { saveAccount } = useFinanceWrites();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'noncash');
  const [opening, setOpening] = useState(() => (account?.openingBalance ?? 0).toFixed(2).replace('.', ','));
  const [isDefault, setDefault] = useState(account?.isDefault ?? false);
  const openingBalance = parseMoney(opening);
  return <FormPage title={account ? 'Редактирование счёта' : 'Добавление счёта'} onClose={onClose}
    disabled={!name.trim() || openingBalance == null}
    onSubmit={() => saveAccount.mutateAsync({ id: account?.id, values: { name: name.trim(), type, openingBalance: openingBalance!, isDefault } })}>
    <DocumentField label="Название"><input className="input w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></DocumentField>
    <DocumentField label="Валюта"><input className="input w-full" value="Кыргызский сом (KGS)" readOnly /></DocumentField>
    {account ? <DocumentField label="Тип"><input className="input w-full" value={accountTypes.find((entry) => entry.value === type)?.label ?? ''} readOnly /></DocumentField>
      : <Choice label="Тип" value={type} onChange={setType} options={accountTypes} />}
    <Amount label="Начальный баланс" value={opening} onChange={setOpening}
      hint="Остаток до первых операций. Для уже сверенной кассы исправится актуализация при первом открытии; фактические остатки смен сохранятся." />
    <DocumentField label="Зачисление продаж">
      {account?.isCollection ? <p className="pt-2">Сейф для инкассаций</p>
        : <label className="flex items-center gap-2 pt-2"><input type="checkbox" checked={isDefault} disabled={account?.isDefault}
          onChange={(event) => setDefault(event.target.checked)} /> Счёт для {type === 'cash' ? 'наличных' : 'безналичных'} оплат</label>}
    </DocumentField>
  </FormPage>;
}

function GrantList({ label, options, value, onChange }: {
  label: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  if (!options.length) return null;
  return <DocumentField label={label}>
    <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border border-border p-3">
      {options.map(({ id, name }) => <label className="flex items-center gap-2" key={id}>
        <input type="checkbox" checked={value.includes(id)} onChange={(event) =>
          onChange(event.target.checked ? [...value, id] : value.filter((item) => item !== id))} />{name}
      </label>)}
    </div>
  </DocumentField>;
}

export function CategoryForm({ category, categories, employees, positions, canEditPermissions, onClose }: {
  category?: FinanceCategory;
  categories: FinanceCategory[];
  employees: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  canEditPermissions: boolean;
  onClose: () => void;
}) {
  const { saveCategory } = useFinanceWrites();
  const [name, setName] = useState(category?.name ?? '');
  const [income, setIncome] = useState(() => !!category && categoryAccepts(category, 'income'));
  const [expense, setExpense] = useState(() => !!category && categoryAccepts(category, 'expense'));
  const [parentId, setParent] = useState(category?.parentId ?? '');
  const [showOnPos, setShowOnPos] = useState(category?.showOnPos ?? false);
  const [userIds, setUserIds] = useState(category?.userIds ?? []);
  const [positionIds, setPositionIds] = useState(category?.positionIds ?? []);
  const kind: CategoryKind = income ? (expense ? 'both' : 'income') : 'expense';
  const byId = new Map(categories.map((entry) => [entry.id, entry]));
  const parentOptions = categoryOptions(categories, (entry) => !category || (entry.id !== category.id
    && !categoryAncestors(entry, byId).some(({ id }) => id === category.id)));
  return <FormPage title={category ? 'Редактирование категории' : 'Добавление категории транзакций'}
    disabled={!name.trim() || (!income && !expense)} onClose={onClose}
    onSubmit={() => saveCategory.mutateAsync({ id: category?.id, values: { name: name.trim(), kind, parentId: parentId || null, showOnPos, userIds, positionIds } })}>
    <DocumentField label="Название"><input className="input w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></DocumentField>
    <Choice label="Родительская категория" value={parentId} onChange={setParent} options={parentOptions} empty="Главный уровень" />
    <DocumentField label="Допустимые транзакции">
      <div className="grid gap-2 py-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={income} onChange={(event) => setIncome(event.target.checked)} />Доходы</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={expense} onChange={(event) => setExpense(event.target.checked)} />Расходы</label>
      </div>
    </DocumentField>
    <OperationKind label="Показывать на кассе" value={showOnPos ? 'yes' : 'no'} onChange={(value) => setShowOnPos(value === 'yes')}
      options={[{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Нет' }]} />
    {canEditPermissions && <div className="border-t border-border pt-4">
      <h2 className="mb-3 font-semibold text-text-primary">Ограниченный доступ к категории</h2>
      <div className="grid gap-4">
        <GrantList label="Должности" options={positions} value={positionIds} onChange={setPositionIds} />
        <GrantList label="Сотрудники" options={employees} value={userIds} onChange={setUserIds} />
        <p className="text-sm text-text-secondary">Для сотрудников без полного доступа к финансам. Полный доступ к разделу «Финансы» задаётся в должности и разрешает операции по всем категориям.</p>
      </div>
    </div>}
  </FormPage>;
}

export function TransactionForm({ accounts, categories, owner, entry, initialAccountId, initialCategoryId, onClose }: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  owner: boolean;
  entry?: FinanceEntry;
  initialAccountId?: string;
  initialCategoryId?: string;
  onClose: () => void;
}) {
  const { postTransaction, editTransactionDetails } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const initialCategory = categories.find(({ id }) => id === (entry?.categoryId ?? initialCategoryId));
  const incoming = entry?.kind === 'transfer' && entry.amount > 0;
  const [kind, setKind] = useState<TransactionKind>(() => {
    if (entry?.kind === 'income' || entry?.kind === 'expense' || entry?.kind === 'transfer') return entry.kind;
    if (initialCategory?.kind === 'income') return 'income';
    return owner || categories.some((category) => categoryAccepts(category, 'expense')) ? 'expense' : 'income';
  });
  const [accountId, setAccount] = useState(() => {
    const id = entry ? incoming ? entry.counterpartyAccountId : entry.accountId : initialAccountId;
    return accounts.find((account) => account.id === id)?.id ?? '';
  });
  const [categoryId, setCategory] = useState(initialCategory?.id ?? '');
  const [destinationAccountId, setDestination] = useState(() => (incoming ? entry.accountId : entry?.counterpartyAccountId) ?? '');
  const [amount, setAmount] = useState(() => entry ? String(Math.abs(entry.amount)).replace('.', ',') : '');
  const [initialDateTime] = useState(() => financeLocalTime(entry ? new Date(entry.occurredAt) : undefined));
  const [date, setDate] = useState(initialDateTime.slice(0, 10));
  const [hour, setHour] = useState(initialDateTime.slice(11, 13));
  const [minute, setMinute] = useState(initialDateTime.slice(14, 16));
  const [note, setNote] = useState(entry?.note ?? '');
  const validAmount = parseMoney(amount);
  const time = [hour, minute].map((part) => part.padStart(2, '0')).join(':');
  const effectiveTime = new Date(date + 'T' + time + ':00+06:00');
  const validTime = /^\d{1,2}$/.test(hour) && Number(hour) < 24 && /^\d{1,2}$/.test(minute) && Number(minute) < 60;
  const validDate = validTime && Number.isFinite(effectiveTime.getTime()) && effectiveTime.getTime() <= Date.now();
  const eligible = categoryOptions(categories, (category) => categoryAccepts(category, kind));
  const types = owner ? transactionTypes : transactionTypes.filter(({ value }) => categories.some((category) => categoryAccepts(category, value)));
  return <FormPage title={entry ? 'Редактирование транзакции' : 'Добавить транзакцию'} onClose={onClose} dialog
    disabled={!accountId || !validDate || !(validAmount != null && validAmount > 0) || (kind === 'transfer' ? !destinationAccountId : !owner && !categoryId)}
    onSubmit={() => {
      const values = {
        kind, accountId, amount: validAmount!, categoryId: kind === 'transfer' ? undefined : categoryId || undefined,
        destinationAccountId: kind === 'transfer' ? destinationAccountId : undefined,
        note: note.trim() || undefined, occurredAt: date + 'T' + time === initialDateTime ? undefined : effectiveTime.toISOString(),
      };
      return entry ? editTransactionDetails.mutateAsync({ id: entry.id, values }) : postTransaction.mutateAsync({ ...values, requestKey });
    }}>
    <OperationKind label="Тип" value={kind} options={types} onChange={(next) => { setKind(next); setCategory(''); }} />
    <Amount label="Сумма" value={amount} onChange={setAmount} />
    {kind === 'transfer' && <Choice label="На счёт" value={destinationAccountId} onChange={setDestination}
      options={accounts.filter(({ id }) => id !== accountId).map(optionFor)} empty="Выберите счёт" />}
    <Choice label={kind === 'income' ? 'На счёт' : 'Со счёта'} value={accountId}
      options={accounts.filter(({ id }) => kind !== 'transfer' || id !== destinationAccountId).map(optionFor)} empty="Выберите счёт"
      onChange={(value) => { setAccount(value); if (value === destinationAccountId) setDestination(''); }} />
    {kind !== 'transfer' && <Choice label="Категория" value={categoryId} onChange={setCategory} options={eligible} empty="Выберите категорию" />}
    <DocumentField label="Дата транзакции">
      <div className="finance-transaction-date">
        <DatePicker value={date} onChange={setDate} max={financeDay()} className="input w-[118px]" aria-label="Дата транзакции" required />
        <span className="inline-flex items-center gap-1">
          <input className="input w-11 px-1 text-center tabular-nums" aria-label="Часы транзакции" inputMode="numeric"
            value={hour} onChange={(event) => setHour(event.target.value)} onBlur={() => setHour(hour.length === 1 ? '0' + hour : hour)}
            pattern="[0-9]{1,2}" maxLength={2} required />
          <span aria-hidden="true">:</span>
          <input className="input w-11 px-1 text-center tabular-nums" aria-label="Минуты транзакции" inputMode="numeric"
            value={minute} onChange={(event) => setMinute(event.target.value)} onBlur={() => setMinute(minute.length === 1 ? '0' + minute : minute)}
            pattern="[0-9]{1,2}" maxLength={2} required />
        </span>
      </div>
    </DocumentField>
    <Comment value={note} onChange={setNote} compact />
  </FormPage>;
}

export function TransactionDetail({ entry, accounts, categories, owner, onClose }: {
  entry: FinanceEntry;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  owner: boolean;
  onClose: () => void;
}) {
  const { editTransaction } = useFinanceWrites();
  const [categoryId, setCategory] = useState(entry.categoryId ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const [showReverse, setShowReverse] = useState(false);
  const changed = categoryId !== (entry.categoryId ?? '') || note.trim() !== (entry.note ?? '');
  const eligible = categoryOptions(categories, (category) => categoryAccepts(category, entry.kind) || category.id === entry.categoryId);
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? '—';
  const primary = accountName(entry.accountId);
  const counterparty = entry.counterpartyName ?? (entry.counterpartyAccountId ? accountName(entry.counterpartyAccountId) : '—');
  const incoming = entry.kind === 'transfer' && entry.amount > 0;
  const title = entry.editable ? 'Редактирование транзакции' : 'Транзакция';
  const fields = <>
    <DocumentField label="Тип"><p>{entryLabel(entry)}</p></DocumentField>
    <DocumentField label="Дата и время"><p>{financeDateTime(entry.occurredAt)}</p></DocumentField>
    {entry.kind === 'transfer' ? <>
      <DocumentField label="На счёт"><p>{incoming ? primary : counterparty}</p></DocumentField>
      <DocumentField label="Со счёта"><p>{incoming ? counterparty : primary}</p></DocumentField>
    </> : <DocumentField label="Счёт"><p>{primary}</p></DocumentField>}
    <DocumentField label="Сумма"><p className="font-semibold tabular-nums">{financeMoney(entry.amount)}</p></DocumentField>
    <DocumentField label="Сотрудник"><p>{entry.actorName || '—'}</p></DocumentField>
    {entry.editable ? <>
      <Choice label="Категория" value={categoryId} onChange={setCategory} options={eligible}
        empty={owner ? 'Без категории' : 'Выберите категорию'} />
      <Comment value={note} onChange={setNote} />
    </> : <>
      <DocumentField label="Категория"><p>{categories.find((category) => category.id === entry.categoryId)?.name ?? '—'}</p></DocumentField>
      <DocumentField label="Комментарий"><p className="whitespace-pre-wrap">{entry.note || '—'}</p></DocumentField>
    </>}
    {entry.reversedAt && <p className="text-text-secondary">Удалена {financeDateTime(entry.reversedAt)}</p>}
    {entry.reversible && <button type="button" className="btn-secondary btn-md" disabled={changed} onClick={() => setShowReverse(true)}>
      Удалить транзакцию
    </button>}
  </>;
  return <>
    {entry.editable ? <FormPage title={title} onClose={onClose} dialog suspended={showReverse}
      disabled={(!owner && !categoryId) || !changed}
      onSubmit={() => editTransaction.mutateAsync({ id: entry.id, categoryId: categoryId || null, note: note.trim() })}>
      {fields}
    </FormPage> : <Modal open title={title} onClose={onClose} panelClassName="finance-transaction-modal max-w-[520px]" suspended={showReverse}>
      <div className="space-y-4">{fields}</div>
    </Modal>}
    {showReverse && <ReverseTransactionDialog entry={entry} onClose={() => setShowReverse(false)} onSuccess={() => {
      setShowReverse(false);
      onClose();
    }} />}
  </>;
}

export function ReverseTransactionDialog({ entry, onClose, onSuccess }: { entry: FinanceEntry; onClose: () => void; onSuccess: () => void }) {
  const formId = useId();
  const busy = useRef(false);
  const { reverseTransaction } = useFinanceWrites();
  const close = () => { if (!busy.current) onClose(); };
  return <Modal open title="Удалить транзакцию?" onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" onClick={close} disabled={reverseTransaction.isPending}>Отмена</button>
    <button type="submit" form={formId} className="btn-danger btn-md"
      disabled={reverseTransaction.isPending}>Удалить</button>
  </div>}>
    <form id={formId} className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      if (busy.current) return;
      busy.current = true;
      try {
        await reverseTransaction.mutateAsync({ id: entry.id, reason: 'Удалено из журнала транзакций' });
        onSuccess();
      } catch {
        // The mutation error remains available in the dialog.
      } finally {
        busy.current = false;
      }
    }}>
      <p className="text-text-secondary">Транзакция исчезнет из текущего списка, а баланс счёта пересчитается.</p>
      {reverseTransaction.error && <p role="alert" className="text-danger">{apiError(reverseTransaction.error)}</p>}
    </form>
  </Modal>;
}

export function AccrualForm({ employees, initialMonth, initialUser, calculated = false, supplemental = false, dialog = false, fixedContext = false, onClose }: {
  employees: { id: string; name: string }[]; initialMonth: string; initialUser?: string; calculated?: boolean;
  supplemental?: boolean; dialog?: boolean; fixedContext?: boolean; onClose: () => void;
}) {
  const { accrue } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [userId, setUser] = useState(initialUser ?? '');
  const [month, setMonth] = useState(initialMonth);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const calculatedReport = usePayroll(month, calculated && /^\d{4}-\d{2}$/.test(month));
  const summary = calculatedReport.data?.staff.find((row) => row.userId === userId);
  const employeeOptions = calculated ? (calculatedReport.data?.staff ?? []).map(({ userId: id, name }) => ({ id, name })) : employees;
  const validAmount = calculated ? calculatedReport.isSuccess ? summary?.available ?? null : null : parseMoney(amount);
  return <FormPage title={calculated ? 'Подтвердить расчёт зарплаты' : supplemental ? 'Премия или доплата' : 'Начислить зарплату вручную'} onClose={onClose} submitLabel="Начислить" dialog={dialog}
    disabled={!userId || !month || validAmount == null || validAmount <= 0}
    onSubmit={async () => {
      try {
        await accrue.mutateAsync({ userId, month, amount: validAmount!, note: note.trim() || undefined, requestKey, calculated, supplemental });
      } catch (error) {
        if (calculated) void calculatedReport.refetch();
        throw error;
      }
    }}>
    {fixedContext ? <p className="text-text-secondary">{employees.find(({ id }) => id === userId)?.name} · {month.split('-').reverse().join('.')}</p> : <><DocumentField label="Расчётный месяц"><input type="month" className="input w-full" value={month}
      max={calculated ? financeDay().slice(0, 7) : undefined} onChange={(event) => setMonth(event.target.value)} required /></DocumentField>
    <Choice label="Сотрудник" value={userId} onChange={setUser} options={employeeOptions.map(optionFor)} empty="Выберите сотрудника" /></>}
    {calculated ? <>
      <p className="text-sm text-text-muted">Подтвердите зарплату по закрытым рабочим сменам и продажам за месяц. Уже начисленная основная зарплата вычтена из суммы.</p>
      <DocumentField label="К начислению за месяц"><p className="pt-2 tabular-nums">{financeMoney(validAmount)}</p></DocumentField>
      {summary && <p className="text-sm text-text-muted">По ставкам {financeMoney(summary.estimate)}. Основная зарплата уже начислена: {financeMoney(summary.baseAccrued)}. Доплаты: {financeMoney(summary.supplementalAccrued)}.</p>}
      {summary && summary.hours === 0 && <p className="text-sm text-text-muted">В выбранном месяце нет закрытых рабочих смен. Часы и смены появятся после завершения рабочего дня в табеле.</p>}
      {calculatedReport.isError && <p role="alert" className="text-sm text-danger">{apiError(calculatedReport.error)}</p>}
    </> : <><Amount label={supplemental ? 'Сумма доплаты' : 'Сумма зарплаты'} value={amount} onChange={setAmount} />
      <p className="text-sm text-text-muted">{supplemental
        ? 'Сумма добавится к зарплате по ставкам за выбранный месяц. Она не уменьшает основное начисление.'
        : 'Основная зарплата за выбранный месяц. При последующем начислении по ставкам эта сумма будет вычтена, чтобы не начислить зарплату дважды.'}</p></>}
    <Comment value={note} onChange={setNote} />
    <p className="text-sm text-text-muted">Списание со счёта произойдёт при фактической выплате.</p>
  </FormPage>;
}

export function PayoutForm({ accounts, accrual: initialAccrual, accruals = [], dialog = false, onClose }: {
  accounts: FinanceAccount[]; accrual: PayrollAccrual; accruals?: PayrollAccrual[]; dialog?: boolean; onClose: () => void;
}) {
  const { payout } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [accountId, setAccount] = useState('');
  const [accrualId, setAccrualId] = useState(initialAccrual.id);
  const accrual = accruals.find(({ id }) => id === accrualId) ?? initialAccrual;
  const remainder = Math.round((accrual.amount - accrual.paidAmount) * 100) / 100;
  const [amount, setAmount] = useState(String(remainder));
  const [note, setNote] = useState('');
  const validAmount = parseMoney(amount);
  return <FormPage title="Выплата зарплаты" onClose={onClose} submitLabel="Выплатить" dialog={dialog}
    disabled={!accountId || validAmount == null || validAmount <= 0 || validAmount > remainder}
    onSubmit={() => payout.mutateAsync({ id: accrual.id, values: { accountId, amount: validAmount!, requestKey, note: note.trim() || undefined } })}>
    <DocumentField label="Сотрудник"><p className="pt-2">{accrual.employeeName}</p></DocumentField>
    <DocumentField label="За расчётный месяц"><p className="pt-2">{accrual.month.split('-').reverse().join('.')}</p></DocumentField>
    {accruals.length > 1 && <Choice label="Что выплатить" value={accrualId} onChange={(id) => {
      setAccrualId(id);
      const selected = accruals.find((entry) => entry.id === id);
      if (selected) setAmount(String(Math.round((selected.amount - selected.paidAmount) * 100) / 100));
    }} options={accruals.map((entry) => ({ value: entry.id,
      label: `${entry.supplemental ? 'Доплата' : 'Зарплата'} от ${financeDateTime(entry.createdAt)} · остаток ${financeMoney(entry.amount - entry.paidAmount)}` }))} />}
    <DocumentField label="К выплате"><p className="pt-2">{financeMoney(remainder)}</p></DocumentField>
    <Choice label="Счёт списания" value={accountId} onChange={setAccount} options={accounts.map(optionFor)} empty="Выберите счёт" />
    <Amount label="Сумма выплаты" value={amount} onChange={setAmount} />
    <p className="text-sm text-text-muted">Можно выплатить часть суммы. Остаток сохранится в расчёте сотрудника за этот месяц.</p>
    <Comment value={note} onChange={setNote} />
  </FormPage>;
}
