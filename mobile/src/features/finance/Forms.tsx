import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { DateField } from '@/components/DateField';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Field, Loading } from '@/components/ui';
import { WarehouseMultiSelect } from '@/screens/admin/WarehouseMultiSelect';
import {
  useFinanceCategoryRemoval, useFinanceWrites,
  type AccountType, type CategoryKind, type FinanceAccount, type FinanceCategory, type FinanceData,
  type FinanceEntry, type TransactionKind,
} from './api';
import { FinanceForm, FinanceLine, FinanceQueryError, MoneyField, SelectField, SwitchField, financeStyles } from './components';
import { financeLocalTime, financeMoney, parseMoney } from './format';
import { acceptsTransaction, categoryChoices, choice, compatibleParent, transactionDate } from './rules';

export const accountTypes: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Наличные' }, { value: 'noncash', label: 'Безналичный' },
];
export const categoryKinds: { value: CategoryKind; label: string }[] = [
  { value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }, { value: 'both', label: 'Доход и расход' },
];
export const transactionKinds: { value: TransactionKind; label: string }[] = [
  { value: 'income', label: 'Доход' }, { value: 'expense', label: 'Расход' }, { value: 'transfer', label: 'Перевод' },
];

export function AccountForm({ account, onClose }: { account?: FinanceAccount; onClose: () => void }) {
  const { saveAccount } = useFinanceWrites();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'cash');
  const [balance, setBalance] = useState(String(account?.openingBalance ?? 0));
  const [isDefault, setDefault] = useState(account?.isDefault ?? false);
  const openingBalance = parseMoney(balance);
  return (
    <FinanceForm title={account ? 'Редактирование счёта' : 'Добавление счёта'} onClose={onClose}
      disabled={!name.trim() || openingBalance === null}
      submit={() => saveAccount.mutateAsync({ id: account?.id, values: { name: name.trim(), type, openingBalance: openingBalance!, isDefault } })}>
      <Field label="Название" value={name} onChangeText={setName} maxLength={120} />
      <SelectField label="Тип счёта" value={type} options={accountTypes} onChange={setType} disabled={!!account} />
      <MoneyField label="Начальный баланс" value={balance} onChange={setBalance} />
      {account?.isCollection ? <Text style={financeStyles.muted} translate>Сейф для инкассаций</Text> : (
        <SwitchField label="Счёт по умолчанию" checked={isDefault} onChange={setDefault} disabled={account?.isDefault} />
      )}
    </FinanceForm>
  );
}

export function ArchiveAccountForm({ account, onClose }: { account: FinanceAccount; onClose: () => void }) {
  const { archiveAccount } = useFinanceWrites();
  return (
    <FinanceForm title="Удалить счёт?" submitLabel="Удалить" danger onClose={onClose}
      submit={() => archiveAccount.mutateAsync(account.id)}>
      <Text style={financeStyles.label}>{account.name}</Text>
      <Text style={financeStyles.muted} translate>Счёт переместится в корзину. История транзакций сохранится.</Text>
    </FinanceForm>
  );
}

export function CategoryForm({ data, category, onClose }: { data: FinanceData; category?: FinanceCategory; onClose: () => void }) {
  const { saveCategory } = useFinanceWrites();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'expense');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [showOnPos, setShowOnPos] = useState(category?.showOnPos ?? false);
  const [userIds, setUserIds] = useState(category?.userIds ?? []);
  const [positionIds, setPositionIds] = useState(category?.positionIds ?? []);
  const parents = categoryChoices(data.categories, (parent) => compatibleParent(data.categories, parent, category?.id));
  return (
    <FinanceForm title={category ? 'Редактирование категории' : 'Добавление категории транзакций'} onClose={onClose}
      disabled={!name.trim() || (!!parentId && !parents.some(({ value }) => value === parentId))}
      submit={() => saveCategory.mutateAsync({ id: category?.id, values: {
        name: name.trim(), kind, parentId: parentId || null, showOnPos, userIds, positionIds,
      } })}>
      <Field label="Название" value={name} onChangeText={setName} maxLength={120} />
      <SelectField label="Тип" value={kind} options={categoryKinds} onChange={setKind} />
      <SelectField label="Родительская категория" value={parentId} options={[{ value: '', label: 'Без категории' }, ...parents]} onChange={setParentId} />
      <SwitchField label="Показывать на кассе" checked={showOnPos} onChange={setShowOnPos} />
      {data.canEditPermissions ? (
        <>
          <WarehouseMultiSelect label="Сотрудники" options={data.employees.map(choice)} value={userIds} onChange={setUserIds} />
          <WarehouseMultiSelect label="Должности" options={data.positions.map(choice)} value={positionIds} onChange={setPositionIds} />
        </>
      ) : null}
    </FinanceForm>
  );
}

export function RemoveCategoryForm({ category, categories, onClose }: { category: FinanceCategory; categories: FinanceCategory[]; onClose: () => void }) {
  const { deleteCategory } = useFinanceWrites();
  const removal = useFinanceCategoryRemoval(category.id);
  const [replacementId, setReplacementId] = useState('');
  const context = removal.data;
  const replacements = categoryChoices(categories, (candidate) => context?.replacementIds.includes(candidate.id) ?? false);
  const needsReplacement = (context?.entryCount ?? 0) > 0;
  return (
    <FinanceForm title="Удалить категорию?" submitLabel="Удалить" danger onClose={onClose}
      disabled={!context || (needsReplacement && !replacements.some(({ value }) => value === replacementId))}
      submit={() => deleteCategory.mutateAsync({ id: category.id, replacementId: replacementId || undefined })}>
      <Text style={financeStyles.label}>{category.name}</Text>
      {removal.isPending ? <Loading /> : null}
      {removal.isError ? <FinanceQueryError error={removal.error} retry={() => void removal.refetch()} /> : null}
      {context ? (
        <>
          <FinanceLine label="Транзакции" value={String(context.entryCount)} />
          <FinanceLine label="Подкатегории" value={String(context.childCount)} />
          {context.childCount > 0 ? <Text style={financeStyles.muted} translate>Подкатегории перейдут на уровень выше.</Text> : null}
          {needsReplacement ? (
            <SelectField label="Перенести транзакции в категорию" value={replacementId} onChange={setReplacementId}
              options={[{ value: '', label: 'Выберите категорию' }, ...replacements]} />
          ) : null}
        </>
      ) : null}
    </FinanceForm>
  );
}

export function TransactionForm({ data, entry, initialAccountId, onClose }: {
  data: FinanceData;
  entry?: FinanceEntry;
  initialAccountId?: string;
  onClose: () => void;
}) {
  const { postTransaction, editTransactionDetails } = useFinanceWrites();
  const [requestKey] = useState(randomUUID);
  const kinds = transactionKinds.filter(({ value }) => value === 'transfer' ? data.canManage && data.accounts.length > 1
    : data.canManage || data.categories.some((category) => acceptsTransaction(category, value)));
  const [kind, setKind] = useState<TransactionKind>(
    entry?.kind === 'income' || entry?.kind === 'expense' || entry?.kind === 'transfer' ? entry.kind : kinds[0]?.value ?? 'expense',
  );
  const [accountId, setAccountId] = useState(entry?.accountId ?? (initialAccountId || data.accounts[0]?.id || ''));
  const [destinationAccountId, setDestination] = useState(entry?.counterpartyAccountId ?? '');
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? '');
  const [amount, setAmount] = useState(entry ? String(Math.abs(entry.amount)) : '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [initialTimestamp] = useState(() => financeLocalTime(entry ? new Date(entry.occurredAt) : undefined));
  const [date, setDate] = useState(initialTimestamp.slice(0, 10));
  const [time, setTime] = useState(initialTimestamp.slice(11));
  const validAmount = parseMoney(amount);
  const timestamp = transactionDate(date, time);
  const accountOptions = data.accounts.map(choice);
  const eligible = categoryChoices(data.categories, (category) => acceptsTransaction(category, kind));
  const validAccount = accountOptions.some(({ value }) => value === accountId);
  const validRoute = kind === 'transfer'
    ? accountId !== destinationAccountId && accountOptions.some(({ value }) => value === destinationAccountId)
    : categoryId ? eligible.some(({ value }) => value === categoryId) : data.canManage;
  return (
    <FinanceForm title={entry ? 'Редактирование транзакции' : 'Добавить транзакцию'} onClose={onClose}
      disabled={!validAmount || validAmount < 0 || !timestamp || timestamp.getTime() > Date.now() || !validAccount || !validRoute || !kinds.some(({ value }) => value === kind)}
      submit={() => {
        const values = {
          kind, accountId, amount: validAmount!,
          destinationAccountId: kind === 'transfer' ? destinationAccountId : undefined,
          categoryId: kind !== 'transfer' ? categoryId || undefined : undefined,
          note: note.trim(),
          occurredAt: date + 'T' + time === initialTimestamp ? undefined : timestamp?.toISOString(),
        };
        return entry ? editTransactionDetails.mutateAsync({ id: entry.id, values }) : postTransaction.mutateAsync({ ...values, requestKey });
      }}>
      <SelectField label="Тип" value={kind} options={kinds} onChange={(value) => { setKind(value); setCategoryId(''); }} />
      <SelectField label="Счёт" value={accountId} options={accountOptions} onChange={setAccountId} />
      {kind === 'transfer' ? (
        <SelectField label="На счёт" value={destinationAccountId} onChange={setDestination}
          options={[{ value: '', label: 'Выберите счёт' }, ...accountOptions.filter(({ value }) => value !== accountId)]} />
      ) : (
        <SelectField label="Категория" value={categoryId} onChange={setCategoryId}
          options={[{ value: '', label: data.canManage ? 'Без категории' : 'Выберите категорию' }, ...eligible]} />
      )}
      <MoneyField value={amount} onChange={setAmount} />
      <View style={financeStyles.row}>
        <DateField label="Дата" value={date} onChangeText={setDate} maximumDate={new Date()} containerStyle={financeStyles.grow} />
        <Field label="Время" value={time} onChangeText={setTime} maxLength={5} placeholder="чч:мм" />
      </View>
      <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={500} multiline />
    </FinanceForm>
  );
}

export function TransactionCommentForm({ entry, categories, onClose }: { entry: FinanceEntry; categories: FinanceCategory[]; onClose: () => void }) {
  const { editTransaction } = useFinanceWrites();
  const [categoryId, setCategoryId] = useState(entry.categoryId ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const kind = entry.amount < 0 ? 'expense' : 'income';
  const options = categoryChoices(categories, (category) => category.id === entry.categoryId || acceptsTransaction(category, kind));
  return (
    <FinanceForm title="Редактирование транзакции" onClose={onClose}
      submit={() => editTransaction.mutateAsync({ id: entry.id, categoryId: categoryId || null, note: note.trim() })}>
      <SelectField label="Категория" value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'Без категории' }, ...options]} />
      <Field label="Комментарий" value={note} onChangeText={setNote} maxLength={500} multiline />
    </FinanceForm>
  );
}

export function ReverseTransactionForm({ entry, onClose }: { entry: FinanceEntry; onClose: () => void }) {
  const { reverseTransaction } = useFinanceWrites();
  const [reason, setReason] = useState('');
  return (
    <FinanceForm title="Удалить транзакцию?" submitLabel="Сторнировать" danger onClose={onClose} disabled={!reason.trim()}
      submit={() => reverseTransaction.mutateAsync({ id: entry.id, reason: reason.trim() })}>
      <FinanceLine label="Сумма" value={financeMoney(entry.amount)} />
      <Field label="Причина" value={reason} onChangeText={setReason} maxLength={500} multiline />
    </FinanceForm>
  );
}
