import { useId, useRef, useState, type ReactNode } from 'react';
import { apiError } from '@/lib/api';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { EditorPage } from '../warehouse/EditorPage';
import { DocumentField } from '../warehouse/WarehouseUi';
import {
  type AccountType, type CategoryKind, type FinanceAccount, type FinanceCategory, type PayrollAccrual,
  type TransactionKind, useFinanceWrites,
} from './api';
import { financeLocalTime, financeMoney, parseMoney } from './finance-format';

const accountTypes = [{ value: 'cash', label: 'Наличные' }, { value: 'noncash', label: 'Безналичные' }] as const;
const categoryKinds = [{ value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }] as const;
const transactionTypes = [...categoryKinds, { value: 'transfer', label: 'Перевод' }] as const;
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

function Amount({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <DocumentField label={label}>
    <input className="input w-full tabular-nums" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0,00" maxLength={17} />
  </DocumentField>;
}

function Comment({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <DocumentField label="Комментарий"><textarea className="input w-full" value={value} onChange={(event) => onChange(event.target.value)} maxLength={500} rows={3} /></DocumentField>;
}

function FormPage({ children, title, onClose, onSubmit, submitLabel = 'Сохранить', disabled = false }: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  onSubmit: () => Promise<unknown>;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const busy = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { markSaved } = useEditorDirty(dirty);
  return <EditorPage title={title} onClose={() => { if (!busy.current) onClose(); }} footer={
    <button form={id} type="submit" className="btn-primary btn-md" disabled={disabled || saving}>{saving ? 'Сохранение…' : submitLabel}</button>
  }>
    <form id={id} onChangeCapture={() => setDirty(true)} onSubmit={async (event) => {
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
    }} className="poster-form poster-form--directory">
      <fieldset disabled={saving} className="min-w-0 space-y-4">{children}</fieldset>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
    </form>
  </EditorPage>;
}

export function AccountForm({ account, onClose }: { account?: FinanceAccount; onClose: () => void }) {
  const { saveAccount } = useFinanceWrites();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'cash');
  const [opening, setOpening] = useState(String(account?.openingBalance ?? 0));
  const [isDefault, setDefault] = useState(account?.isDefault ?? false);
  const openingBalance = parseMoney(opening);
  return <FormPage title={account ? 'Редактирование счёта' : 'Новый счёт'} onClose={onClose}
    disabled={!name.trim() || openingBalance == null}
    onSubmit={() => saveAccount.mutateAsync({ id: account?.id, values: { name: name.trim(), type, openingBalance: openingBalance!, isDefault } })}>
    <DocumentField label="Название"><input className="input w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></DocumentField>
    <DocumentField label="Валюта"><p className="pt-2">Кыргызский сом</p></DocumentField>
    {account ? <DocumentField label="Тип"><p className="pt-2">{accountTypes.find((entry) => entry.value === type)?.label}</p></DocumentField>
      : <Choice label="Тип" value={type} onChange={setType} options={accountTypes} />}
    {account ? <DocumentField label="Начальный баланс"><p className="pt-2">{financeMoney(account.openingBalance)}</p></DocumentField>
      : <Amount label="Начальный баланс" value={opening} onChange={setOpening} />}
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
  return <FormPage title={category ? 'Редактирование категории' : 'Новая категория'} disabled={!name.trim()} onClose={onClose}
    onSubmit={() => saveCategory.mutateAsync({ id: category?.id, values: { name: name.trim(), kind, userIds, positionIds } })}>
    <DocumentField label="Название"><input className="input w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></DocumentField>
    {category ? <DocumentField label="Тип"><p className="pt-2">{categoryKinds.find((entry) => entry.value === kind)?.label}</p></DocumentField>
      : <Choice label="Тип" value={kind} onChange={setKind} options={categoryKinds} />}
    <DocumentField label="Доступ"><p className="pt-2 text-text-secondary">Владелец всегда может проводить операции по этой категории. Отметьте сотрудников или должности, которым хотите дать доступ.</p></DocumentField>
    <GrantList label="Должности" options={positions} value={positionIds} onChange={setPositionIds} />
    <GrantList label="Сотрудники" options={employees} value={userIds} onChange={setUserIds} />
  </FormPage>;
}

export function TransactionForm({ accounts, categories, owner, onClose }: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  owner: boolean;
  onClose: () => void;
}) {
  const { postTransaction } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<TransactionKind>(owner || categories.some((entry) => entry.kind === 'expense') ? 'expense' : 'income');
  const [accountId, setAccount] = useState(accounts.find((account) => account.isDefault)?.id ?? accounts[0]?.id ?? '');
  const [categoryId, setCategory] = useState('');
  const [destinationAccountId, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const validAmount = parseMoney(amount);
  const effectiveTime = time ? new Date(time + ':00+06:00') : null;
  const validDate = !effectiveTime || (Number.isFinite(effectiveTime.getTime()) && effectiveTime.getTime() <= Date.now());
  const eligible = categories.filter((category) => category.kind === kind);
  const types = owner ? transactionTypes : categoryKinds.filter(({ value }) => categories.some((category) => category.kind === value));
  return <FormPage title="Новая транзакция" onClose={onClose} submitLabel="Провести"
    disabled={!accountId || !validDate || !(validAmount != null && validAmount > 0) || (kind === 'transfer' ? !destinationAccountId : !owner && !categoryId)}
    onSubmit={() => postTransaction.mutateAsync({
      kind, accountId, amount: validAmount!, categoryId: kind === 'transfer' ? undefined : categoryId || undefined,
      destinationAccountId: kind === 'transfer' ? destinationAccountId : undefined, requestKey,
      note: note.trim() || undefined, occurredAt: effectiveTime?.toISOString(),
    })}>
    <Choice label="Тип" value={kind} options={types} onChange={(next) => { setKind(next); setCategory(''); }} />
    <Choice label={kind === 'transfer' ? 'Со счёта' : 'Счёт'} value={accountId} options={accounts.map(optionFor)} empty="Выберите счёт"
      onChange={(value) => { setAccount(value); if (value === destinationAccountId) setDestination(''); }} />
    {kind === 'transfer'
      ? <Choice label="На счёт" value={destinationAccountId} onChange={setDestination} options={accounts.filter(({ id }) => id !== accountId).map(optionFor)} empty="Выберите счёт" />
      : <Choice label="Категория" value={categoryId} onChange={setCategory} options={eligible.map(optionFor)} empty={owner ? 'Без категории' : 'Выберите категорию'} />}
    <Amount label="Сумма" value={amount} onChange={setAmount} />
    <DocumentField label="Дата и время (Бишкек)">
      <input type="datetime-local" className="input w-full" value={time} onChange={(event) => setTime(event.target.value)} max={financeLocalTime()} />
      <span className="mt-1 block text-xs text-text-muted">По умолчанию используется время проведения.</span>
    </DocumentField>
    <Comment value={note} onChange={setNote} />
  </FormPage>;
}

export function AccrualForm({ employees, initialMonth, onClose }: {
  employees: { id: string; name: string }[]; initialMonth: string; onClose: () => void;
}) {
  const { accrue } = useFinanceWrites();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [userId, setUser] = useState('');
  const [month, setMonth] = useState(initialMonth);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const validAmount = parseMoney(amount);
  return <FormPage title="Начисление зарплаты" onClose={onClose} submitLabel="Начислить"
    disabled={!userId || !month || validAmount == null || validAmount <= 0}
    onSubmit={() => accrue.mutateAsync({ userId, month, amount: validAmount!, note: note.trim() || undefined, requestKey })}>
    <Choice label="Сотрудник" value={userId} onChange={setUser} options={employees.map(optionFor)} empty="Выберите сотрудника" />
    <DocumentField label="Месяц"><input type="month" className="input w-full" value={month} onChange={(event) => setMonth(event.target.value)} required /></DocumentField>
    <Amount label="Сумма" value={amount} onChange={setAmount} />
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
