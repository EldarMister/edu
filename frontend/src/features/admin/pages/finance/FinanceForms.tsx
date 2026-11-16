import { useId, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { apiError } from '@/lib/api';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { EditorPage } from '../warehouse/EditorPage';
import { DocumentField } from '../warehouse/WarehouseUi';
import {
  type AccountType, type CategoryKind, type FinanceAccount, type FinanceCategory, type FinanceEntry, type PayrollAccrual,
  type TransactionKind, useFinanceWrites, usePayroll,
} from './api';
import { entryLabel, financeDateTime, financeDay, financeLocalTime, financeMoney, parseMoney } from './finance-format';

const accountTypes = [{ value: 'cash', label: 'Наличные' }, { value: 'noncash', label: 'Безналичные' }] as const;
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

function Comment({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <DocumentField label="Комментарий"><textarea className="input w-full" value={value} onChange={(event) => onChange(event.target.value)} maxLength={500} rows={3} /></DocumentField>;
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
  const [opening, setOpening] = useState('0,00');
  const [isDefault, setDefault] = useState(account?.isDefault ?? false);
  const openingBalance = account?.openingBalance ?? parseMoney(opening);
  return <FormPage title={account ? 'Редактирование счёта' : 'Добавление счёта'} onClose={onClose}
    disabled={!name.trim() || openingBalance == null}
    onSubmit={() => saveAccount.mutateAsync({ id: account?.id, values: { name: name.trim(), type, openingBalance: openingBalance!, isDefault } })}>
    <DocumentField label="Название"><input className="input w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></DocumentField>
    <DocumentField label="Валюта"><input className="input w-full" value="Кыргызский сом (KGS)" readOnly /></DocumentField>
    {account ? <DocumentField label="Тип"><p className="pt-2">{accountTypes.find((entry) => entry.value === type)?.label}</p></DocumentField>
      : <Choice label="Тип" value={type} onChange={setType} options={accountTypes} />}
    {account ? <DocumentField label="Начальный баланс"><p className="pt-2">{financeMoney(account.openingBalance)}</p></DocumentField>
      : <Amount label="Начальный баланс" value={opening} onChange={setOpening} hint="Остаток денег на счёте на момент создания" />}
    <DocumentField label="Зачисление продаж">
      <label className="flex items-center gap-2 pt-2"><input type="checkbox" checked={isDefault} disabled={account?.isDefault}
        onChange={(event) => setDefault(event.target.checked)} /> Счёт для {type === 'cash' ? 'наличных' : 'безналичных'} оплат</label>
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

export function CategoryForm({ category, employees, positions, onClose }: {
  category?: FinanceCategory;
  employees: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { saveCategory } = useFinanceWrites();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'expense');
  const [userIds, setUserIds] = useState(category?.userIds ?? []);
  const [positionIds, setPositionIds] = useState(category?.positionIds ?? []);
  return <FormPage title={category ? 'Редактирование категории' : 'Добавление категории транзакций'} disabled={!name.trim()} onClose={onClose}
    onSubmit={() => saveCategory.mutateAsync({ id: category?.id, values: { name: name.trim(), kind, userIds, positionIds } })}>
    <DocumentField label="Название"><input className="input w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></DocumentField>
    {category ? <DocumentField label="Допустимые транзакции"><p className="pt-2">{categoryKinds.find((entry) => entry.value === kind)?.label}</p></DocumentField>
      : <OperationKind label="Допустимые транзакции" value={kind} onChange={setKind} options={categoryKinds} />}
    <DocumentField label="Доступ"><p className="pt-2 text-text-secondary">Владелец всегда может проводить операции по этой категории. Отметьте сотрудников или должности, которым хотите дать доступ.</p></DocumentField>
    <GrantList label="Должности" options={positions} value={positionIds} onChange={setPositionIds} />
    <GrantList label="Сотрудники" options={employees} value={userIds} onChange={setUserIds} />
  </FormPage>;
}

export function TransactionForm({ accounts, categories, owner, initialAccountId, initialCategoryId, onClose }: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  owner: boolean;
  initialAccountId?: string;
  initialCategoryId?: string;
  onClose: () => void;
}) {
  const { postTransaction } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const initialCategory = categories.find(({ id }) => id === initialCategoryId);
  const [kind, setKind] = useState<TransactionKind>(() => initialCategory?.kind ??
    (owner || categories.some((entry) => entry.kind === 'expense') ? 'expense' : 'income'));
  const [accountId, setAccount] = useState(() => accounts.find(({ id }) => id === initialAccountId)?.id ??
    accounts.find((account) => account.isDefault)?.id ?? accounts[0]?.id ?? '');
  const [categoryId, setCategory] = useState(initialCategory?.id ?? '');
  const [destinationAccountId, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const currentTime = financeLocalTime();
  const validAmount = parseMoney(amount);
  const effectiveTime = time ? new Date(time + ':00+06:00') : null;
  const validDate = !effectiveTime || (Number.isFinite(effectiveTime.getTime()) && effectiveTime.getTime() <= Date.now());
  const eligible = categories.filter((category) => category.kind === kind);
  const types = owner ? transactionTypes : transactionTypes.filter(({ value }) => categories.some((category) => category.kind === value));
  return <FormPage title="Новая транзакция" onClose={onClose} dialog
    disabled={!accountId || !validDate || !(validAmount != null && validAmount > 0) || (kind === 'transfer' ? !destinationAccountId : !owner && !categoryId)}
    onSubmit={() => postTransaction.mutateAsync({
      kind, accountId, amount: validAmount!, categoryId: kind === 'transfer' ? undefined : categoryId || undefined,
      destinationAccountId: kind === 'transfer' ? destinationAccountId : undefined, requestKey,
      note: note.trim() || undefined, occurredAt: effectiveTime?.toISOString(),
    })}>
    <OperationKind label="Тип" value={kind} options={types} onChange={(next) => { setKind(next); setCategory(''); }} />
    <Amount label="Сумма" value={amount} onChange={setAmount} />
    <Choice label={kind === 'transfer' ? 'Со счёта' : 'Счёт'} value={accountId} options={accounts.map(optionFor)} empty="Выберите счёт"
      onChange={(value) => { setAccount(value); if (value === destinationAccountId) setDestination(''); }} />
    {kind === 'transfer' && <Choice label="На счёт" value={destinationAccountId} onChange={setDestination}
      options={accounts.filter(({ id }) => id !== accountId).map(optionFor)} empty="Выберите счёт" />}
    {kind !== 'transfer' && <Choice label="Категория" value={categoryId} onChange={setCategory} options={eligible.map(optionFor)}
      empty={owner ? 'Без категории' : 'Выберите категорию'} />}
    <DocumentField label="Дата и время">
      <input type="datetime-local" className="input w-full" value={time || currentTime} onChange={(event) => setTime(event.target.value)} max={currentTime} />
      <span className="mt-1 block text-xs text-text-muted">По умолчанию — время проведения (Бишкек).</span>
    </DocumentField>
    <Comment value={note} onChange={setNote} />
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
  const eligible = categories.filter((category) => category.kind === entry.kind);
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? '—';
  const title = entry.editable ? 'Редактирование транзакции' : 'Транзакция';
  const fields = <>
    <DocumentField label="Тип"><p>{entryLabel(entry)}</p></DocumentField>
    <DocumentField label="Дата и время"><p>{financeDateTime(entry.occurredAt)}</p></DocumentField>
    <DocumentField label="Счёт"><p>{accountName(entry.accountId)}</p></DocumentField>
    {entry.counterpartyAccountId && <DocumentField label="Связанный счёт"><p>{accountName(entry.counterpartyAccountId)}</p></DocumentField>}
    <DocumentField label="Сумма"><p className="font-semibold tabular-nums">{financeMoney(entry.amount)}</p></DocumentField>
    <DocumentField label="Сотрудник"><p>{entry.actorName || '—'}</p></DocumentField>
    {entry.editable ? <>
      <Choice label="Категория" value={categoryId} onChange={setCategory} options={eligible.map(optionFor)}
        empty={owner ? 'Без категории' : 'Выберите категорию'} />
      <Comment value={note} onChange={setNote} />
    </> : <>
      <DocumentField label="Категория"><p>{categories.find((category) => category.id === entry.categoryId)?.name ?? '—'}</p></DocumentField>
      <DocumentField label="Комментарий"><p className="whitespace-pre-wrap">{entry.note || '—'}</p></DocumentField>
    </>}
    {entry.reversedAt && <p className="text-text-secondary">Сторнировано {financeDateTime(entry.reversedAt)}</p>}
    {entry.reversible && <button type="button" className="btn-secondary btn-md" disabled={changed} onClick={() => setShowReverse(true)}>
      Отменить транзакцию
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

function ReverseTransactionDialog({ entry, onClose, onSuccess }: { entry: FinanceEntry; onClose: () => void; onSuccess: () => void }) {
  const formId = useId();
  const busy = useRef(false);
  const [reason, setReason] = useState('');
  const { reverseTransaction } = useFinanceWrites();
  const close = () => { if (!busy.current) onClose(); };
  return <Modal open title="Отменить транзакцию?" onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" onClick={close} disabled={reverseTransaction.isPending}>Отмена</button>
    <button type="submit" form={formId} className="btn-danger btn-md"
      disabled={!reason.trim() || reverseTransaction.isPending}>Отменить транзакцию</button>
  </div>}>
    <form id={formId} className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      if (busy.current || !reason.trim()) return;
      busy.current = true;
      try {
        await reverseTransaction.mutateAsync({ id: entry.id, reason: reason.trim() });
        onSuccess();
      } catch {
        // The mutation error remains available in the dialog.
      } finally {
        busy.current = false;
      }
    }}>
      <p className="text-text-secondary">В журнале появится обратная операция, которая скорректирует баланс счёта.</p>
      <label className="grid gap-1.5">Причина
        <textarea className="input w-full" rows={3} maxLength={500} value={reason}
          onChange={(event) => setReason(event.target.value)} disabled={reverseTransaction.isPending} />
      </label>
      {reverseTransaction.error && <p role="alert" className="text-danger">{apiError(reverseTransaction.error)}</p>}
    </form>
  </Modal>;
}

export function AccrualForm({ employees, initialMonth, initialUser, calculated = false, onClose }: {
  employees: { id: string; name: string }[]; initialMonth: string; initialUser?: string; calculated?: boolean; onClose: () => void;
}) {
  const { accrue } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [userId, setUser] = useState(initialUser ?? '');
  const [month, setMonth] = useState(initialMonth);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const calculatedReport = usePayroll(month, calculated);
  const summary = calculatedReport.data?.staff.find((row) => row.userId === userId);
  const validAmount = calculated ? calculatedReport.isSuccess ? summary?.available ?? null : null : parseMoney(amount);
  return <FormPage title={calculated ? 'Начисление по расчёту' : 'Начисление зарплаты'} onClose={onClose} submitLabel="Начислить"
    disabled={!userId || !month || validAmount == null || validAmount <= 0}
    onSubmit={async () => {
      try {
        await accrue.mutateAsync({ userId, month, amount: validAmount!, note: note.trim() || undefined, requestKey, calculated });
      } catch (error) {
        if (calculated) void calculatedReport.refetch();
        throw error;
      }
    }}>
    <Choice label="Сотрудник" value={userId} onChange={setUser} options={employees.map(optionFor)} empty="Выберите сотрудника" />
    <DocumentField label="Месяц"><input type="month" className="input w-full" value={month}
      max={calculated ? financeDay().slice(0, 7) : undefined} onChange={(event) => setMonth(event.target.value)} required /></DocumentField>
    {calculated ? <>
      <DocumentField label="К начислению"><p className="pt-2 tabular-nums">{financeMoney(validAmount)}</p></DocumentField>
      {summary && <p className="text-sm text-text-muted">По ставкам {financeMoney(summary.estimate)}. Уже начислено {financeMoney(summary.accrued)}.</p>}
      {calculatedReport.isError && <p role="alert" className="text-sm text-danger">{apiError(calculatedReport.error)}</p>}
    </> : <Amount label="Сумма" value={amount} onChange={setAmount} />}
    <Comment value={note} onChange={setNote} />
    <p className="text-sm text-text-muted">Списание со счёта произойдёт при фактической выплате.</p>
  </FormPage>;
}

export function PayoutForm({ accounts, accrual, onClose }: { accounts: FinanceAccount[]; accrual: PayrollAccrual; onClose: () => void }) {
  const { payout } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [accountId, setAccount] = useState('');
  const remainder = Math.round((accrual.amount - accrual.paidAmount) * 100) / 100;
  const [amount, setAmount] = useState(String(remainder));
  const [note, setNote] = useState('');
  const validAmount = parseMoney(amount);
  return <FormPage title="Выплата зарплаты" onClose={onClose} submitLabel="Выплатить"
    disabled={!accountId || validAmount == null || validAmount <= 0 || validAmount > remainder}
    onSubmit={() => payout.mutateAsync({ id: accrual.id, values: { accountId, amount: validAmount!, requestKey, note: note.trim() || undefined } })}>
    <DocumentField label="Сотрудник"><p className="pt-2">{accrual.employeeName}</p></DocumentField>
    <DocumentField label="К выплате"><p className="pt-2">{financeMoney(remainder)}</p></DocumentField>
    <Choice label="Счёт списания" value={accountId} onChange={setAccount} options={accounts.map(optionFor)} empty="Выберите счёт" />
    <Amount label="Сумма выплаты" value={amount} onChange={setAmount} />
    <Comment value={note} onChange={setNote} />
  </FormPage>;
}
