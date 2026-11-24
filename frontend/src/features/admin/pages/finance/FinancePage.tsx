import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Select } from '@/components/Select';
import { useSocketEvent } from '@/lib/socket';
import { IconTrash } from '../../components/icons';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { EditorPage } from '../warehouse/EditorPage';
import { QueryState } from '../warehouse/WarehouseUi';
import { useEditorRoute, usePageFilters } from '../warehouse/workspace-route';
import { useListPeriod } from '../warehouse/ListPeriodFilter';
import { financeKey, useFinance, useFinanceWrites, usePayroll, type FinanceAccount, type FinanceEntry } from './api';
import { AccountTrashPage, ArchiveAccountDialog } from './AccountTrashPage';
import { CashShiftsPage } from './CashShiftsPage';
import { CashHandoverPage } from './CashHandoverPage';
import { CashFlowMatrix } from './CashFlowMatrix';
import { FinancePeriod } from './FinancePeriod';
import { AccountForm, AccrualForm, CategoryForm, PayoutForm, ReverseTransactionDialog, TransactionDetail, TransactionForm } from './FinanceForms';
import { FinanceRegister } from './FinanceRegister';
import { FinanceRowMenu } from './FinanceRowMenu';
import { CategoryDirectory } from './CategoryDirectory';
import { TransactionCell } from './TransactionCell';
import { categoryAccepts, categoryAncestors, categoryOptions } from './category-options';
import { entryCategoryLabel, entryLabel, entryLabels, financeDateTime, financeDay, financeLocalTime, financeMoney } from './finance-format';
import type { FinanceView } from './navigation';
import { PayrollRegister } from './PayrollRegister';
import { SalaryAccrualCard } from './SalaryAccrualCard';

const nameSort = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
const filterByName = (value: string, term: string) => value.toLocaleLowerCase('ru').includes(term.trim().toLocaleLowerCase('ru'));
const transactionDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Bishkek' });
const transactionColumns = ['date', 'category', 'note', 'amount', 'account'];

export function FinancePage({ view }: { view: FinanceView }) {
  if (view === 'cashShifts') return <CashShiftsPage />;
  if (view === 'cashHandover') return <CashHandoverPage />;
  return <FinanceReport view={view} />;
}

function FinanceReport({ view }: { view: Exclude<FinanceView, 'cashShifts' | 'cashHandover'> }) {
  const route = useEditorRoute();
  const { editor, openEditor, closeEditor } = route;
  const [today] = useState(() => financeDay());
  const start = new Date(today.slice(0, 7) + '-01T00:00:00Z');
  start.setUTCMonth(start.getUTCMonth() - 2);
  const [{
    financeFrom: from, financeTo: to, financeSearch: search, financeScope: scope,
    financeKind: kind, financeCategory: categoryId, payrollPosition, payrollMonth, payrollFrom, payrollTo, payrollEmployee,
  }, setFilters] = usePageFilters({
    financeFrom: view === 'cashFlow' ? start.toISOString().slice(0, 10) : today.slice(0, 7) + '-01', financeTo: today, financeSearch: '',
    financeScope: '', financeKind: '', financeCategory: '', payrollPosition: '',
    payrollMonth: today.slice(0, 7), payrollFrom: '', payrollTo: '', payrollEmployee: '',
  });
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(payrollMonth) && payrollMonth <= today.slice(0, 7) ? payrollMonth : today.slice(0, 7);
  const transactionPeriod = useListPeriod('financeTransaction', 'all');
  const { editTransaction } = useFinanceWrites();
  const [ascending, setAscending] = useState(view !== 'transactions');
  const toggleSort = () => setAscending((current) => !current);
  const setSearch = (value: string) => setFilters({ financeSearch: value });
  const setScope = (value: string) => setFilters({ financeScope: value });
  const rangeValid = view !== 'cashFlow' || (!!from && !!to && from <= to);
  const finance = useFinance({
    from: view === 'transactions' ? transactionPeriod.range.dateFrom ?? '2000-01-01' : from,
    to: view === 'transactions' ? transactionPeriod.range.dateTo ?? today : to,
    month: view === 'payroll' ? month : undefined,
    accountIds: view === 'cashFlow' ? scope || undefined : undefined,
  }, rangeValid);
  const payrollRange = payrollFrom && payrollTo && payrollFrom <= payrollTo ? { from: payrollFrom, to: payrollTo } : undefined;
  const salary = usePayroll(payrollRange ?? month, view === 'payroll');
  const queryClient = useQueryClient();
  const refreshPayroll = () => {
    if (view === 'payroll') void queryClient.invalidateQueries({ queryKey: [...financeKey, 'payroll'] });
  };
  useSocketEvent('waiter:shift_ended', refreshPayroll, [view, queryClient]);
  useSocketEvent('waiter:shift_updated', refreshPayroll, [view, queryClient]);
  const [reversingEntryId, setReversingEntryId] = useState<string | null>(null);
  const [archivingAccount, setArchivingAccount] = useState<FinanceAccount | null>(null);
  const data = finance.data;
  const addButton = (label: string, type: string) => <button type="button" className="btn-primary btn-md"
    onClick={() => openEditor({ type })}>{label}</button>;
  const quickSearch = <WorkspaceSearch value={search} onChange={setSearch} label="Быстрый поиск" />;

  const transactionEditor = view === 'transactions' && editor?.type === 'financeTransaction' ? editor : null;
  if (data && editor && !transactionEditor) {
    if (data.canViewAll && view === 'payroll' && editor.type === 'financeAccrualDetail' && editor.id) {
      return <SalaryAccrualCard id={editor.id} onClose={closeEditor} canEdit={data.canManage}
        onPay={() => openEditor({ type: 'financePayout', id: editor.id })} canPay={data.canManage && data.accounts.length > 0} />;
    }
    if (data.canManage) {
      if (view === 'accounts' && editor.type === 'financeAccountTrash') return <AccountTrashPage onClose={closeEditor} />;
      if (view === 'accounts' && editor.type === 'financeAccount') {
        const account = data.accounts.find(({ id }) => id === editor.id);
        if (!editor.id || account) return <AccountForm key={editor.id ?? 'new'} account={account} onClose={closeEditor} />;
      }
      if (view === 'categories' && editor.type === 'financeCategory') {
        const category = data.categories.find(({ id }) => id === editor.id);
        if (!editor.id || category) return <CategoryForm key={editor.id ?? 'new'} category={category} categories={data.categories}
          employees={data.employees.filter(({ adminAccess }) => adminAccess)} positions={data.positions}
          canEditPermissions={data.canEditPermissions} onClose={closeEditor} />;
      }
      if (view === 'payroll' && editor.type === 'financeAccrual') {
        const employees = new Map(data.employees.map(({ id, name }) => [id, { id, name }]));
        for (const row of salary.data?.staff ?? []) employees.set(row.userId, { id: row.userId, name: row.name });
        return <AccrualForm key={(editor.id ?? 'new') + (editor.action ?? '')} employees={[...employees.values()]}
          initialMonth={month} initialUser={editor.id}
          calculated={editor.action === 'calculated'} supplemental={editor.action === 'bonus'} onClose={closeEditor} />;
      }
      if (view === 'payroll' && editor.type === 'financePayout') {
        const accrual = salary.data?.records.find(({ id }) => id === editor.id);
        if (salary.isPending) return <EditorPage title="Выплата зарплаты" onClose={closeEditor}><QueryState pending /></EditorPage>;
        if (accrual && !accrual.voidedAt && accrual.paidAmount < accrual.amount && data.accounts.length) {
          return <PayoutForm key={accrual.id} accounts={data.accounts} accrual={accrual} onClose={closeEditor} />;
        }
      }
    }
    return <EditorPage title="Запись недоступна" onClose={closeEditor}>
      <p role="alert" className="text-text-secondary">Проверьте, существует ли запись и есть ли у вас доступ.</p>
    </EditorPage>;
  }

  const toolbar = (filters: ReactNode, add?: { label: string; editor: string }, showSearch = true) => <div className="poster-toolbar">
    {showSearch && <WorkspaceSearch value={search} onChange={setSearch} label="Быстрый поиск" />}
      {view === 'cashFlow'
        ? <FinancePeriod from={from} to={to} onApply={(period) => setFilters({ financeFrom: period.from, financeTo: period.to })} />
        : view === 'transactions' ? transactionPeriod.filter : null}
    {filters}
    {add && <button type="button" className="btn-primary btn-md ml-auto" onClick={() => openEditor({ type: add.editor })}>{add.label}</button>}
  </div>;
  if (!rangeValid) return <>
    {toolbar(null, undefined, false)}
    <p role="alert" className="text-sm text-danger">Укажите начало и конец периода.</p>
  </>;
  if (!data || finance.isError) return <>
    {toolbar(null, undefined, false)}
    <QueryState pending={finance.isPending} error={finance.error} />
    {finance.isError && <button type="button" className="btn-secondary btn-md" onClick={() => void finance.refetch()}>Повторить</button>}
  </>;

  if (view === 'accounts') {
    const accounts = data.accounts.filter(({ name, type }) => (!scope || type === scope) && filterByName(name, search))
      .sort((a, b) => ascending ? nameSort(a, b) : nameSort(b, a));
    const total = accounts.reduce((sum, account) => sum + (account.balance ?? 0), 0);
    return <>
      <WorkspaceHeaderCount count={accounts.length} />
      <FinanceRegister title="Счета" columnPreference="finance-accounts" columns={[
        { key: 'name', label: 'Название', width: '45%', sort: { ascending, toggle: toggleSort } },
        { key: 'type', label: 'Тип', width: '29%' },
        { key: 'balance', label: 'Баланс', numeric: true },
      ]} defaultColumns={['name', 'type', 'balance']}
        filters={<>{quickSearch}<RegisterFilter active={!!scope}><Select ariaLabel="Тип счёта" value={scope} onChange={setScope} options={[
          { value: '', label: 'Все счета' }, { value: 'cash', label: 'Наличные' }, { value: 'noncash', label: 'Безналичные' },
        ]} /></RegisterFilter></>}
        tools={data.canManage && <>
          <button type="button" className="finance-tool" onClick={() => openEditor({ type: 'financeAccountTrash' })}>
            <IconTrash aria-hidden="true" /> Корзина
          </button>
          {addButton('Добавить счёт', 'financeAccount')}
        </>}
        totals={data.canViewAll ? { name: { value: 'Итого' }, balance: { value: total, display: financeMoney(total) } } : undefined}
        rows={accounts.map((account) => ({ id: account.id, values: {
          name: { value: account.name, display: <div className="flex flex-wrap items-center gap-2">
            {account.name}
            {account.isDefault && <span className="text-xs text-text-muted">Для оплат</span>}
            {account.isCollection && <span className="text-xs text-text-muted">Для инкассации</span>}
          </div> },
          type: { value: account.type === 'cash' ? 'Наличные' : 'Безналичный счёт' },
          balance: { value: account.balance, display: <span className={account.balance == null || account.balance === 0 ? 'text-text-muted'
            : account.balance < 0 ? 'text-danger' : undefined}>{financeMoney(account.balance)}</span> },
        }, action: data.canViewAll && <div className="flex justify-end gap-3">
          {data.canManage && <EditButton name={account.name} onClick={() => openEditor({ type: 'financeAccount', id: account.id })} />}
          <Link className="text-primary text-base" title="Движение денег" aria-label={'Движение денег: ' + account.name}
            to={{ search: new URLSearchParams({ section: 'finance', view: 'cashFlow', financeScope: account.id }).toString() }}>→</Link>
          {data.canManage && !account.isDefault && !account.isCollection && <FinanceRowMenu label={account.name} action="Удалить"
            onAction={() => setArchivingAccount(account)} />}
        </div> }))}
        empty="Счета не найдены" />
      {archivingAccount && <ArchiveAccountDialog account={archivingAccount} onClose={() => setArchivingAccount(null)} />}
    </>;
  }

  if (view === 'categories') {
    return <CategoryDirectory categories={data.categories} employees={data.employees} positions={data.positions}
      search={search} kind={scope} ascending={ascending} toggleSort={toggleSort}
      filters={<>{quickSearch}<RegisterFilter active={!!scope}><Select ariaLabel="Тип категории" value={scope} onChange={setScope} options={[
        { value: '', label: 'Все категории' }, { value: 'income', label: 'Доходы' }, { value: 'expense', label: 'Расходы' },
        { value: 'both', label: 'Доходы и расходы' },
      ]} /></RegisterFilter></>}
      add={data.canManage && addButton('Добавить категорию', 'financeCategory')}
      edit={data.canManage ? (id) => openEditor({ type: 'financeCategory', id }) : undefined} />;
  }

  if (view === 'payroll') return <PayrollRegister report={salary} month={month} range={payrollRange}
    periodPicker={<FinancePeriod from={payrollFrom || month + '-01'} to={payrollTo || today}
      onApply={({ from, to }) => setFilters({ payrollFrom: from, payrollTo: to, payrollEmployee: '' })} />}
    changeMonth={(value) => setFilters({ payrollMonth: value, payrollFrom: '', payrollTo: '', payrollEmployee: '' })}
    search={search} changeSearch={setSearch} position={payrollPosition}
    changePosition={(value) => setFilters({ payrollPosition: value })}
    historyId={payrollEmployee || null} changeHistory={(id) => setFilters({ payrollEmployee: id ?? '' })}
    canAccrue={!payrollRange && data.canManage && (data.employees.length > 0 || (salary.data?.staff.length ?? 0) > 0)}
    canPay={!payrollRange && data.canManage && data.accounts.length > 0}
    accounts={data.accounts} openEditor={openEditor} />;

  if (view === 'cashFlow') {
    const flow = data.flow;
    return flow ? <CashFlowMatrix flow={flow} accounts={data.accounts}
      categories={data.categories} entries={data.entries} from={from} to={to} selectedAccounts={scope} setAccounts={setScope}
      period={<FinancePeriod from={from} to={to} allFrom={flow.firstFinancialDay}
        onApply={(period) => setFilters({ financeFrom: period.from, financeTo: period.to })} />} />
      : <p role="alert" className="text-text-muted">Отчёт недоступен.</p>;
  }

  const accountNames = new Map(data.accounts.map(({ id, name }) => [id, name]));
  const categoriesById = new Map(data.categories.map((category) => [category.id, category]));
  const categoryChoices = categoryOptions(data.categories);
  const editCategoryChoices = (entryKind: 'income' | 'expense') => [
    ...(data.canManage ? [{ value: '', label: 'Без категории' }] : []),
    ...categoryChoices.filter(({ value }) => categoryAccepts(categoriesById.get(value)!, entryKind)),
  ];
  const incomeCategories = editCategoryChoices('income');
  const expenseCategories = editCategoryChoices('expense');
  const selectedCategories = new Set(categoryId ? data.categories.filter((category) => category.id === categoryId
    || categoryAncestors(category, categoriesById).some(({ id }) => id === categoryId)).map(({ id }) => id) : []);
  const categoryName = (entry: FinanceEntry) => entry.kind === 'transfer' && !entry.reversalOf ? 'Переводы'
    : entryCategoryLabel(entry, entry.categoryId ? categoriesById.get(entry.categoryId)?.name : undefined);
  const showDeleted = kind === 'reversal';
  const transactions = data.entries.filter((entry) => (!scope || entry.accountId === scope) &&
    (scope || entry.kind !== 'transfer' || !entry.counterpartyAccountId || entry.counterpartyArchived || entry.amount < 0) &&
    (showDeleted ? !!(entry.reversalOf || entry.reversedAt) : !entry.reversalOf && !entry.reversedAt && (!kind || entry.kind === kind)) &&
    (!categoryId || (entry.categoryId && selectedCategories.has(entry.categoryId))) &&
    filterByName([entry.note, entry.actorName, accountNames.get(entry.accountId),
      entry.counterpartyAccountId && (accountNames.get(entry.counterpartyAccountId) ?? entry.counterpartyName),
      categoryName(entry), entryLabel(entry), financeDateTime(entry.occurredAt), transactionDay.format(new Date(entry.occurredAt)),
      financeMoney(!scope && entry.kind === 'transfer' ? Math.abs(entry.amount) : entry.amount)].filter(Boolean).join(' '), search))
    .sort((a, b) => (ascending ? 1 : -1) * (a.occurredAt.localeCompare(b.occurredAt)
      || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id)));
  const selectedEntry = data.entries.find(({ id }) => id === transactionEditor?.id);
  const reversingEntry = data.entries.find(({ id }) => id === reversingEntryId);
  const total = transactions.reduce((sum, entry) => sum + (!scope && entry.kind === 'transfer' ? 0 : Math.round(entry.amount * 100)), 0) / 100;
  return <>
    <WorkspaceHeaderCount count={transactions.length} />
    <FinanceRegister title="Транзакции" columnPreference="finance-transactions" columns={[
      { key: 'date', label: 'Дата', width: 132, sort: { ascending, toggle: toggleSort } },
      { key: 'time', label: 'Время', width: 86 },
      { key: 'category', label: 'Категория', width: 152 },
      { key: 'note', label: 'Комментарий', width: 220 },
      { key: 'amount', label: 'Сумма', width: 128, numeric: true },
      ...(data.canViewAll ? [{ key: 'balance', label: 'Баланс', width: 128, numeric: true }] : []),
      { key: 'account', label: 'Счёт', width: 156 },
      { key: 'type', label: 'Тип', width: 112 }, { key: 'actor', label: 'Сотрудник', width: 156 },
    ]} defaultColumns={transactionColumns}
      filters={<>{quickSearch}
        {data.categories.length > 0 && <Select searchable ariaLabel="Категория транзакции" value={categoryId}
          onChange={(value) => setFilters({ financeCategory: value })}
          options={[{ value: '', label: 'Категория' }, ...categoryChoices]} />}
        <Select searchable ariaLabel="Счёт" value={scope} onChange={setScope}
          options={[{ value: '', label: 'Счёт' }, ...data.accounts.map(({ id, name }) => ({ value: id, label: name }))]} />
        <RegisterFilter active={!!kind}>
          <Select ariaLabel="Тип транзакции" value={kind} onChange={(value) => setFilters({ financeKind: value })}
            options={[{ value: '', label: 'Все операции' }, ...Object.entries(entryLabels).map(([value, label]) => ({ value, label })),
              { value: 'reversal', label: 'Удалённые' }]} />
        </RegisterFilter>
        {(scope || kind || categoryId || search) && <button type="button" className="finance-tool"
          onClick={() => setFilters({ financeScope: '', financeKind: '', financeCategory: '', financeSearch: '' })}>Сбросить</button>}
      </>}
      tools={<>{transactionPeriod.filter}
        {data.accounts.length > 0 && (data.canManage || !data.canViewAll && data.categories.length > 0) && addButton('Добавить транзакцию', 'financeTransaction')}
      </>}
      totals={showDeleted ? undefined : { date: { value: 'Итого' }, amount: { value: total, display: <span className={total < 0 ? 'text-danger' : undefined}>{financeMoney(total)}</span> } }}
      rows={transactions.map((entry, index) => {
        const categoryLabel = categoryName(entry);
        const comment = <span>{entry.note || '—'}{entry.reversedAt && <span className="ml-2 text-xs text-text-muted">Удалена</span>}</span>;
        const showDate = !index || financeDay(new Date(entry.occurredAt)) !== financeDay(new Date(transactions[index - 1].occurredAt));
        const amount = !scope && entry.kind === 'transfer' ? Math.abs(entry.amount) : entry.amount;
        const accountName = accountNames.get(entry.accountId) ?? '—';
        const counterpartyName = entry.counterpartyAccountId
          ? accountNames.get(entry.counterpartyAccountId) ?? entry.counterpartyName ?? '—' : null;
        const available = entry.kind === 'income' ? incomeCategories : expenseCategories;
        const currentCategory = entry.categoryId;
        const editOptions = entry.editable && currentCategory && !available.some(({ value }) => value === currentCategory)
          ? [...available, { value: currentCategory, label: categoryLabel }] : available;
        return {
          id: entry.id,
          values: {
            date: { value: financeDateTime(entry.occurredAt), display: <time className={showDate ? undefined : 'sr-only'} dateTime={entry.occurredAt} title={financeDateTime(entry.occurredAt)}>
              {transactionDay.format(new Date(entry.occurredAt))}
            </time> },
            time: { value: financeLocalTime(new Date(entry.occurredAt)).slice(11) },
            category: { value: categoryLabel, display: entry.editable ? <TransactionCell field="category" value={entry.categoryId ?? ''}
              display={categoryLabel} options={editOptions} onSave={(value) => editTransaction.mutateAsync({ id: entry.id, categoryId: value || null })} /> : undefined },
            note: { value: entry.note || '—', display: entry.editable ? <TransactionCell field="note" value={entry.note ?? ''}
              display={comment} onSave={(value) => editTransaction.mutateAsync({ id: entry.id, note: value })} /> : comment },
            amount: { value: amount, display: <span className={amount < 0 ? 'text-danger' : undefined}>{financeMoney(amount)}</span> },
            balance: { value: entry.balanceAfter ?? null, display: <span
              title={entry.balanceAfter == null ? undefined : `Баланс счёта «${accountName}» после транзакции`}
              className={entry.balanceAfter != null && entry.balanceAfter < 0 ? 'text-danger' : undefined}>
              {financeMoney(entry.balanceAfter)}
            </span> },
            account: { value: counterpartyName
              ? (entry.amount < 0 ? [accountName, counterpartyName] : [counterpartyName, accountName]).join(' → ')
              : accountName },
            type: { value: entryLabel(entry) }, actor: { value: entry.actorName || '—' },
          },
          action: <div className="flex items-center justify-end gap-2">
            <button type="button" className="text-primary hover:underline"
              aria-label={(entry.detailsEditable || entry.editable ? 'Редактировать транзакцию ' : 'Открыть транзакцию ') + financeDateTime(entry.occurredAt)}
              onClick={() => openEditor({ type: 'financeTransaction', id: entry.id })}>
              {entry.detailsEditable || entry.editable ? 'Ред.' : 'Открыть'}
            </button>
            {entry.reversible && <FinanceRowMenu label={entry.note || financeDateTime(entry.occurredAt)}
              action="Удалить" onAction={() => setReversingEntryId(entry.id)} />}
          </div>,
        };
      })} empty="За этот период нет транзакций по выбранным условиям" />
    {transactionEditor && (selectedEntry ? selectedEntry.detailsEditable
      ? <TransactionForm key={selectedEntry.id} entry={selectedEntry} accounts={data.accounts} categories={data.categories} owner onClose={closeEditor} />
      : <TransactionDetail key={selectedEntry.id} entry={selectedEntry} accounts={data.accounts}
        categories={data.categories} owner={data.canManage} onClose={closeEditor} />
      : !transactionEditor.id && data.accounts.length > 0 && (data.canManage || !data.canViewAll) ? <TransactionForm accounts={data.accounts}
        categories={data.categories} owner={data.canManage} initialAccountId={scope} initialCategoryId={categoryId} onClose={closeEditor} />
      : <EditorPage title="Транзакция недоступна" onClose={closeEditor}>
        <p role="alert" className="text-text-secondary">Проверьте период или права доступа к транзакции.</p>
      </EditorPage>)}
    {reversingEntry && <ReverseTransactionDialog key={reversingEntry.id} entry={reversingEntry}
      onClose={() => setReversingEntryId(null)} onSuccess={() => setReversingEntryId(null)} />}
  </>;
}

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return <button type="button" className="text-primary" aria-label={'Редактировать ' + name} onClick={onClick}>Ред.</button>;
}

function RegisterFilter({ active, children }: { active: boolean; children: ReactNode }) {
  return <details className="finance-extra-filter">
    <summary>{active ? 'Фильтр •' : '+ Фильтр'}</summary>
    <div>{children}</div>
  </details>;
}
