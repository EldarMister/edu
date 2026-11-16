import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DatePicker } from '@/components/DatePicker';
import { Select } from '@/components/Select';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { EditorPage } from '../warehouse/EditorPage';
import { QueryState } from '../warehouse/WarehouseUi';
import { useEditorRoute, usePageFilters } from '../warehouse/workspace-route';
import { useListPeriod } from '../warehouse/ListPeriodFilter';
import { useFinance, usePayroll } from './api';
import { CashShiftsPage } from './CashShiftsPage';
import { CashFlowMatrix } from './CashFlowMatrix';
import { FinancePeriod } from './FinancePeriod';
import { AccountForm, AccrualForm, CategoryForm, PayoutForm, TransactionDetail, TransactionForm } from './FinanceForms';
import { FinanceRegister } from './FinanceRegister';
import { entryLabel, entryLabels, financeDateTime, financeDay, financeMoney } from './finance-format';
import type { FinanceView } from './navigation';
import { PayrollRegister } from './PayrollRegister';

const nameSort = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
const filterByName = (value: string, term: string) => value.toLocaleLowerCase('ru').includes(term.trim().toLocaleLowerCase('ru'));
const transactionDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Bishkek' });
const transactionColumns = ['date', 'category', 'note', 'amount', 'account'];

export function FinancePage({ view }: { view: FinanceView }) {
  return view === 'cashShifts' ? <CashShiftsPage /> : <FinanceReport view={view} />;
}

function FinanceReport({ view }: { view: Exclude<FinanceView, 'cashShifts'> }) {
  const route = useEditorRoute();
  const { editor, openEditor, closeEditor } = route;
  const [today] = useState(() => financeDay());
  const start = new Date(today.slice(0, 7) + '-01T00:00:00Z');
  start.setUTCMonth(start.getUTCMonth() - 2);
  const [{
    financeFrom: from, financeTo: to, financeSearch: search, financeScope: scope,
    financeKind: kind, financeCategory: categoryId, payrollPosition,
  }, setFilters] = usePageFilters({
    financeFrom: view === 'cashFlow' ? start.toISOString().slice(0, 10) : today.slice(0, 7) + '-01', financeTo: today, financeSearch: '',
    financeScope: '', financeKind: '', financeCategory: '', payrollPosition: '',
  });
  const [month, setMonth] = useState(today.slice(0, 7));
  const transactionPeriod = useListPeriod('financeTransaction', 'all');
  const [ascending, setAscending] = useState(view !== 'transactions');
  const toggleSort = () => setAscending((current) => !current);
  const setSearch = (value: string) => setFilters({ financeSearch: value });
  const setScope = (value: string) => setFilters({ financeScope: value });
  const hasDates = view === 'transactions' || view === 'cashFlow';
  const rangeValid = !hasDates || (!!from && !!to && from <= to);
  const finance = useFinance({
    from: view === 'transactions' ? transactionPeriod.range.dateFrom ?? '2000-01-01' : from,
    to: view === 'transactions' ? transactionPeriod.range.dateTo ?? today : to,
    month: view === 'payroll' ? month : undefined,
    accountId: view === 'cashFlow' ? scope || undefined : undefined,
  }, rangeValid);
  const salary = usePayroll(month, view === 'payroll');
  const [salaryHistoryId, setSalaryHistory] = useState<string | null>(null);
  const data = finance.data;
  const addButton = (label: string, type: string) => <button type="button" className="btn-primary btn-md"
    onClick={() => openEditor({ type })}>{label}</button>;
  const quickSearch = <WorkspaceSearch value={search} onChange={setSearch} label="Быстрый поиск" />;
  const dateFilters = hasDates && <div className="flex flex-wrap items-center gap-2">
    <DatePicker value={from} onChange={(value) => setFilters({ financeFrom: value })} max={to || today} className="input w-[125px]" aria-label="С даты" />
    <span className="text-text-muted">—</span>
    <DatePicker value={to} onChange={(value) => setFilters({ financeTo: value })} min={from} max={today} className="input w-[125px]" aria-label="По дату" />
  </div>;

  const transactionEditor = view === 'transactions' && editor?.type === 'financeTransaction' ? editor : null;
  if (data && editor && !transactionEditor) {
    if (data.canManage) {
      if (view === 'accounts' && editor.type === 'financeAccount') {
        const account = data.accounts.find(({ id }) => id === editor.id);
        if (!editor.id || account) return <AccountForm key={editor.id ?? 'new'} account={account} onClose={closeEditor} />;
      }
      if (view === 'categories' && editor.type === 'financeCategory') {
        const category = data.categories.find(({ id }) => id === editor.id);
        if (!editor.id || category) return <CategoryForm key={editor.id ?? 'new'} category={category}
          employees={data.employees.filter(({ role }) => role === 'ADMIN')} positions={data.positions} onClose={closeEditor} />;
      }
      if (view === 'payroll' && editor.type === 'financeAccrual') {
        return <AccrualForm key={(editor.id ?? 'new') + (editor.action ?? '')} employees={data.employees}
          initialMonth={month} initialUser={editor.id} calculated={editor.action === 'calculated'} onClose={closeEditor} />;
      }
      if (view === 'payroll' && editor.type === 'financePayout') {
        const accrual = data.payroll.find(({ id }) => id === editor.id);
        if (accrual && accrual.paidAmount < accrual.amount && data.accounts.length) {
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
        : dateFilters}
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
      <FinanceRegister title="Счета" columns={[
        { key: 'name', label: 'Название', width: '45%', sort: { ascending, toggle: toggleSort } },
        { key: 'type', label: 'Тип', width: '29%' },
        { key: 'balance', label: 'Баланс', numeric: true },
      ]} defaultColumns={['name', 'type', 'balance']}
        filters={<>{quickSearch}<RegisterFilter active={!!scope}><Select ariaLabel="Тип счёта" value={scope} onChange={setScope} options={[
          { value: '', label: 'Все счета' }, { value: 'cash', label: 'Наличные' }, { value: 'noncash', label: 'Безналичные' },
        ]} /></RegisterFilter></>}
        tools={data.canManage && addButton('Добавить счёт', 'financeAccount')}
        totals={data.canManage ? { name: { value: 'Итого' }, balance: { value: total, display: financeMoney(total) } } : undefined}
        rows={accounts.map((account) => ({ id: account.id, values: {
          name: { value: account.name, display: <div className="flex flex-wrap items-center gap-2">
            <Link className="text-primary hover:underline" to={{ search: new URLSearchParams({
              section: 'finance', view: 'cashFlow', financeScope: account.id,
            }).toString() }}>{account.name}</Link>
            {account.isDefault && <span className="text-xs text-text-muted">Для оплат</span>}
          </div> },
          type: { value: account.type === 'cash' ? 'Наличные' : 'Безналичные' },
          balance: { value: account.balance, display: <span className={account.balance == null || account.balance === 0 ? 'text-text-muted'
            : account.balance < 0 ? 'text-danger' : undefined}>{financeMoney(account.balance)}</span> },
        }, action: data.canManage && <EditButton name={account.name} onClick={() => openEditor({ type: 'financeAccount', id: account.id })} /> }))}
        empty="Счета не найдены" />
      {data.canManage && <p className="mt-4 px-3 text-sm text-text-secondary">
        Здесь учитываются операции с момента запуска «Финансов». Начальный остаток указывается при добавлении счёта.
      </p>}
    </>;
  }

  if (view === 'categories') {
    const categories = data.categories.filter(({ name, kind }) => (!scope || kind === scope) && filterByName(name, search))
      .sort((a, b) => ascending ? nameSort(a, b) : nameSort(b, a));
    const employeeNames = new Map(data.employees.map(({ id, name }) => [id, name]));
    const positionNames = new Map(data.positions.map(({ id, name }) => [id, name]));
    return <>
      <WorkspaceHeaderCount count={categories.length} />
      <FinanceRegister title="Категории" columns={[
        { key: 'name', label: 'Название', width: '37%', sort: { ascending, toggle: toggleSort } },
        { key: 'type', label: 'Допустимые транзакции', width: '25%' },
        { key: 'access', label: 'Кто может проводить' },
      ]}
        filters={<>{quickSearch}<RegisterFilter active={!!scope}><Select ariaLabel="Тип категории" value={scope} onChange={setScope} options={[
          { value: '', label: 'Все категории' }, { value: 'income', label: 'Доходы' }, { value: 'expense', label: 'Расходы' },
        ]} /></RegisterFilter></>}
        tools={data.canManage && addButton('Добавить категорию', 'financeCategory')}
        rows={categories.map((category) => {
          const delegates = [
            ...category.positionIds.map((id) => positionNames.get(id)), ...category.userIds.map((id) => employeeNames.get(id)),
          ].filter(Boolean);
          const access = delegates.length ? ['Владелец', ...delegates].join(', ') : 'Только владелец';
          return { id: category.id, values: {
            name: { value: category.name },
            type: { value: category.kind === 'income' ? 'Только доходы' : 'Только расходы' },
            access: { value: access, display: <span className="text-text-secondary">{access}</span> },
          }, action: data.canManage && <EditButton name={category.name} onClick={() => openEditor({ type: 'financeCategory', id: category.id })} /> };
        })} empty="Категории транзакций не найдены" />
    </>;
  }

  if (view === 'payroll') return <PayrollRegister report={salary} month={month} latestMonth={today.slice(0, 7)}
    changeMonth={(value) => { setMonth(value); setSalaryHistory(null); }}
    search={search} changeSearch={setSearch} position={payrollPosition}
    changePosition={(value) => setFilters({ payrollPosition: value })}
    historyId={salaryHistoryId} changeHistory={setSalaryHistory}
    canAccrue={data.canManage && data.employees.length > 0} canPay={data.canManage && data.accounts.length > 0}
    openEditor={openEditor} />;

  if (view === 'cashFlow') {
    const flow = data.flow;
    const accounts = data.accounts.filter((account) => !scope || account.id === scope);
    return flow ? <CashFlowMatrix key={[from, to, scope].join(':')} flow={flow} accounts={accounts}
      categories={data.categories} entries={data.entries} from={from} to={to} selectedAccount={scope}
      accountFilter={<Select ariaLabel="Счёт" className="poster-filter w-48" value={scope} onChange={setScope}
        options={[{ value: '', label: 'Все счета' }, ...data.accounts.map(({ id, name }) => ({ value: id, label: name }))]} />}
      period={<FinancePeriod from={from} to={to} onApply={(period) => setFilters({ financeFrom: period.from, financeTo: period.to })} />} />
      : <p role="alert" className="text-text-muted">Отчёт недоступен.</p>;
  }

  const accountNames = new Map(data.accounts.map(({ id, name }) => [id, name]));
  const categoryNames = new Map(data.categories.map(({ id, name }) => [id, name]));
  const transactions = data.entries.filter((entry) => (!scope || entry.accountId === scope) &&
    (!kind || (entry.reversalOf ? kind === 'reversal' : entry.kind === kind)) &&
    (!categoryId || entry.categoryId === categoryId) &&
    filterByName([entry.note, entry.actorName, accountNames.get(entry.accountId), entry.categoryId && categoryNames.get(entry.categoryId)].filter(Boolean).join(' '), search))
    .sort((a, b) => ascending ? a.occurredAt.localeCompare(b.occurredAt) : b.occurredAt.localeCompare(a.occurredAt));
  const selectedEntry = data.entries.find(({ id }) => id === transactionEditor?.id);
  const total = transactions.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) / 100;
  return <>
    <WorkspaceHeaderCount count={transactions.length} />
    <FinanceRegister title="Транзакции" columns={[
      { key: 'date', label: 'Дата', width: '15%', sort: { ascending, toggle: toggleSort } },
      { key: 'category', label: 'Категория', width: '15%' },
      { key: 'note', label: 'Комментарий' },
      { key: 'amount', label: 'Сумма', width: '14%', numeric: true },
      { key: 'account', label: 'Счёт', width: '29%' },
      { key: 'type', label: 'Тип' }, { key: 'actor', label: 'Сотрудник' },
    ]} defaultColumns={transactionColumns}
      filters={<>{quickSearch}
        {data.categories.length > 0 && <Select ariaLabel="Категория транзакции" value={categoryId}
          onChange={(value) => setFilters({ financeCategory: value })}
          options={[{ value: '', label: 'Категория' }, ...data.categories.map(({ id, name }) => ({ value: id, label: name }))]} />}
        <Select ariaLabel="Счёт" value={scope} onChange={setScope}
          options={[{ value: '', label: 'Счёт' }, ...data.accounts.map(({ id, name }) => ({ value: id, label: name }))]} />
        <RegisterFilter active={!!kind}>
          <Select ariaLabel="Тип транзакции" value={kind} onChange={(value) => setFilters({ financeKind: value })}
            options={[{ value: '', label: 'Все операции' }, ...Object.entries(entryLabels).map(([value, label]) => ({ value, label })),
              { value: 'reversal', label: 'Сторно' }]} />
        </RegisterFilter>
        {(scope || kind || categoryId || search) && <button type="button" className="finance-tool"
          onClick={() => setFilters({ financeScope: '', financeKind: '', financeCategory: '', financeSearch: '' })}>Сбросить</button>}
      </>}
      tools={<>{transactionPeriod.filter}
        {data.accounts.length > 0 && (data.canManage || data.categories.length > 0) && addButton('Добавить транзакцию', 'financeTransaction')}
      </>}
      totals={{ date: { value: 'Итого' }, amount: { value: total, display: <span className={total < 0 ? 'text-danger' : undefined}>{financeMoney(total)}</span> } }}
      rows={transactions.map((entry) => ({
        id: entry.id,
        values: {
          date: { value: financeDateTime(entry.occurredAt), display: <time dateTime={entry.occurredAt} title={financeDateTime(entry.occurredAt)}>
            {transactionDay.format(new Date(entry.occurredAt))}
          </time> },
          category: { value: !entry.reversalOf && entry.categoryId ? categoryNames.get(entry.categoryId) ?? entryLabel(entry) : entryLabel(entry) },
          note: { value: entry.note || '—', display: <span>{entry.note || '—'}
            {entry.reversedAt && <span className="ml-2 text-xs text-text-muted">Сторнировано</span>}
          </span> },
          amount: { value: entry.amount, display: <span className={entry.amount < 0 ? 'text-danger' : undefined}>{financeMoney(entry.amount)}</span> },
          account: { value: entry.counterpartyAccountId
            ? [accountNames.get(entry.accountId) ?? '—', entry.amount < 0 ? '→' : '←', accountNames.get(entry.counterpartyAccountId) ?? '—'].join(' ')
            : accountNames.get(entry.accountId) ?? '—' },
          type: { value: entryLabel(entry) }, actor: { value: entry.actorName || '—' },
        },
        action: <button type="button" className="text-primary hover:underline"
          aria-label={(entry.editable ? 'Редактировать транзакцию ' : 'Открыть транзакцию ') + financeDateTime(entry.occurredAt)}
          onClick={() => openEditor({ type: 'financeTransaction', id: entry.id })}>
          {entry.editable ? 'Ред.' : 'Открыть'}
        </button>,
      }))} empty="За этот период нет транзакций по выбранным условиям" />
    {transactionEditor && (selectedEntry ? <TransactionDetail key={selectedEntry.id} entry={selectedEntry} accounts={data.accounts}
      categories={data.categories} owner={data.canManage} onClose={closeEditor} />
      : !transactionEditor.id && data.accounts.length > 0 ? <TransactionForm accounts={data.accounts}
        categories={data.categories} owner={data.canManage} initialAccountId={scope} initialCategoryId={categoryId} onClose={closeEditor} />
      : <EditorPage title="Транзакция недоступна" onClose={closeEditor}>
        <p role="alert" className="text-text-secondary">Проверьте период или права доступа к транзакции.</p>
      </EditorPage>)}
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
