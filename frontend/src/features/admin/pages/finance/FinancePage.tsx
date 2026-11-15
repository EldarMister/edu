import { useState, type ReactNode } from 'react';
import { DatePicker } from '@/components/DatePicker';
import { Select } from '@/components/Select';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { EditorPage } from '../warehouse/EditorPage';
import { QueryState } from '../warehouse/WarehouseUi';
import { useEditorRoute } from '../warehouse/workspace-route';
import { type EntryKind, type FinanceAccount, type FinanceCategory, type FinanceEntry, useFinance } from './api';
import { CashShiftsPage, FinanceTable } from './CashShiftsPage';
import { AccountForm, AccrualForm, CategoryForm, PayoutForm, TransactionForm } from './FinanceForms';
import { cashFlowHeaders, cashFlowSummary, exportCashFlow, financeDateTime, financeDay, financeMoney } from './finance-format';
import type { FinanceView } from './navigation';

const entryLabels: Record<EntryKind, string> = {
  income: 'Доход', expense: 'Расход', transfer: 'Перевод', sale: 'Продажа', refund: 'Возврат',
  salary: 'Выплата зарплаты', adjustment: 'Корректировка',
};
const nameSort = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
const filterByName = (value: string, term: string) => value.toLocaleLowerCase('ru').includes(term.trim().toLocaleLowerCase('ru'));

export function FinancePage({ view }: { view: FinanceView }) {
  return view === 'cashShifts' ? <CashShiftsPage /> : <FinanceReport view={view} />;
}

function FinanceReport({ view }: { view: Exclude<FinanceView, 'cashShifts'> }) {
  const route = useEditorRoute();
  const { editor, openEditor, closeEditor } = route;
  const [today] = useState(() => financeDay());
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('');
  const [kind, setKind] = useState('');
  const [categoryId, setCategory] = useState('');
  const hasDates = view === 'transactions' || view === 'cashFlow';
  const rangeValid = !hasDates || (!!from && !!to && from <= to);
  const finance = useFinance({
    from, to, month: view === 'payroll' ? month : undefined,
    accountId: view === 'cashFlow' ? scope || undefined : undefined,
  }, rangeValid);
  const data = finance.data;
  const dateFilters = hasDates && <div className="flex flex-wrap items-center gap-2">
    <DatePicker value={from} onChange={setFrom} max={to || today} className="input w-[125px]" aria-label="С даты" />
    <span className="text-text-muted">—</span>
    <DatePicker value={to} onChange={setTo} min={from} max={today} className="input w-[125px]" aria-label="По дату" />
  </div>;

  if (data && editor) {
    if (view === 'transactions' && editor.type === 'financeTransaction' && data.accounts.length) {
      return <TransactionForm accounts={data.accounts} categories={data.categories} owner={data.canManage} onClose={closeEditor} />;
    }
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
        return <AccrualForm employees={data.employees} initialMonth={month} onClose={closeEditor} />;
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
    {dateFilters}
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
    const accounts = data.accounts.filter(({ name, type }) => (!scope || type === scope) && filterByName(name, search)).sort(nameSort);
    return <>
      <WorkspaceHeaderCount count={accounts.length} />
      {toolbar(<Select ariaLabel="Тип счёта" value={scope} onChange={setScope} options={[
        { value: '', label: 'Все счета' }, { value: 'cash', label: 'Наличные' }, { value: 'noncash', label: 'Безналичные' },
      ]} />, data.canManage ? { label: 'Добавить счёт', editor: 'financeAccount' } : undefined)}
      {data.canManage && <p className="mb-3 px-3 text-sm text-text-secondary">
        Здесь учитываются операции с момента запуска «Финансов». Для нового счёта укажите начальный остаток, а для существующего — внесите разницу через «Транзакции».
      </p>}
      <FinanceTable headers={['Название', 'Тип', 'Зачисление продаж', 'Баланс', '']} amounts={[3]}
        totals={accounts.length > 0 && data.canManage ? [
          'Итого', null, null, financeMoney(accounts.reduce((sum, account) => sum + (account.balance ?? 0), 0)), null,
        ] : undefined}
        rows={accounts.map((account) => ({ key: account.id, cells: [
          account.name, account.type === 'cash' ? 'Наличные' : 'Безналичные', account.isDefault ? 'Да' : '—',
          <span className={account.balance != null && account.balance < 0 ? 'text-danger' : undefined}>{financeMoney(account.balance)}</span>,
          data.canManage && <EditButton name={account.name} onClick={() => openEditor({ type: 'financeAccount', id: account.id })} />,
        ] }))} empty="Счета не найдены" />
    </>;
  }

  if (view === 'categories') {
    const categories = data.categories.filter(({ name, kind }) => (!scope || kind === scope) && filterByName(name, search)).sort(nameSort);
    const employeeNames = new Map(data.employees.map(({ id, name }) => [id, name]));
    const positionNames = new Map(data.positions.map(({ id, name }) => [id, name]));
    return <>
      <WorkspaceHeaderCount count={categories.length} />
      {toolbar(<Select ariaLabel="Тип категории" value={scope} onChange={setScope} options={[
        { value: '', label: 'Все категории' }, { value: 'income', label: 'Доходы' }, { value: 'expense', label: 'Расходы' },
      ]} />, data.canManage ? { label: 'Добавить категорию', editor: 'financeCategory' } : undefined)}
      <FinanceTable headers={['Название', 'Тип', 'Доступ', '']} rows={categories.map((category) => ({ key: category.id, cells: [
        category.name, entryLabels[category.kind], ['Владелец',
          ...category.positionIds.map((id) => positionNames.get(id)).filter(Boolean),
          ...category.userIds.map((id) => employeeNames.get(id)).filter(Boolean),
        ].join(', '),
        data.canManage && <EditButton name={category.name} onClick={() => openEditor({ type: 'financeCategory', id: category.id })} />,
      ] }))} empty="Категории транзакций не найдены" />
    </>;
  }

  if (view === 'payroll') {
    const payroll = data.payroll.filter((entry) => filterByName(entry.employeeName, search));
    return <>
      <WorkspaceHeaderCount count={payroll.length} />
      {toolbar(<label className="flex items-center gap-2 text-text-secondary">Месяц
        <input type="month" className="input" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} />
      </label>, data.canManage && data.employees.length ? { label: 'Начислить зарплату', editor: 'financeAccrual' } : undefined)}
      <FinanceTable headers={['Сотрудник', 'Месяц', 'Начислено', 'Выплачено', 'К выплате', 'Комментарий', '']} amounts={[2, 3, 4]}
        rows={payroll.map((entry) => ({ key: entry.id, cells: [
          entry.employeeName, entry.month, financeMoney(entry.amount), financeMoney(entry.paidAmount),
          financeMoney(entry.amount - entry.paidAmount), entry.note || '—',
          data.canManage && data.accounts.length > 0 && entry.amount > entry.paidAmount
            ? <button type="button" className="text-primary" onClick={() => openEditor({ type: 'financePayout', id: entry.id })}>Выплатить</button> : null,
        ] }))} empty="За этот месяц нет начислений" />
    </>;
  }

  if (view === 'cashFlow') {
    const flow = data.flow;
    const accounts = data.accounts.filter((account) => !scope || account.id === scope);
    return <>
      {toolbar(<>
        <Select ariaLabel="Счёт" value={scope} onChange={setScope}
          options={[{ value: '', label: 'Все счета' }, ...data.accounts.map(({ id, name }) => ({ value: id, label: name }))]} />
        {flow && <button type="button" className="btn-secondary btn-md ml-auto"
          onClick={() => exportCashFlow(flow, from, to, scope ? accounts[0]?.name ?? 'Выбранный счёт' : 'Все счета')}>Экспорт CSV</button>}
      </>, undefined, false)}
      {flow ? <>
        <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cashFlowSummary(flow).map(([label, amount]) => <div key={label} className="rounded-xl border border-border px-4 py-3">
            <dt className="text-sm text-text-muted">{label}</dt><dd className="text-lg font-semibold tabular-nums">{financeMoney(amount)}</dd>
          </div>)}
        </dl>
        <FinanceTable headers={cashFlowHeaders} amounts={[1, 2, 3, 4]}
          rows={flow.days.map((day) => ({ key: day.date, cells: [
            day.date.split('-').reverse().join('.'), financeMoney(day.income), financeMoney(day.expense), financeMoney(day.net), financeMoney(day.balance),
          ] }))} empty="За этот период нет движений" />
        <CashFlowDetails accounts={accounts} categories={data.categories} entries={data.entries} from={from} to={to}
          includeTransfers={!!scope} />
      </> : <p role="alert" className="text-text-muted">Отчёт недоступен.</p>}
    </>;
  }

  const accountNames = new Map(data.accounts.map(({ id, name }) => [id, name]));
  const categoryNames = new Map(data.categories.map(({ id, name }) => [id, name]));
  const transactions = data.entries.filter((entry) => (!scope || entry.accountId === scope) && (!kind || entry.kind === kind) &&
    (!categoryId || entry.categoryId === categoryId) &&
    filterByName([entry.note, entry.actorName, accountNames.get(entry.accountId), entry.categoryId && categoryNames.get(entry.categoryId)].filter(Boolean).join(' '), search));
  return <>
    <WorkspaceHeaderCount count={transactions.length} />
    {toolbar(<>
      <Select ariaLabel="Счёт" value={scope} onChange={setScope}
        options={[{ value: '', label: 'Все счета' }, ...data.accounts.map(({ id, name }) => ({ value: id, label: name }))]} />
      <Select ariaLabel="Тип транзакции" value={kind} onChange={setKind}
        options={[{ value: '', label: 'Все операции' }, ...Object.entries(entryLabels).map(([value, label]) => ({ value, label }))]} />
      {data.categories.length > 0 && <Select ariaLabel="Категория транзакции" value={categoryId} onChange={setCategory}
        options={[{ value: '', label: 'Все категории' }, ...data.categories.map(({ id, name }) => ({ value: id, label: name }))]} />}
    </>, data.accounts.length && (data.canManage || data.categories.length) ? { label: 'Добавить транзакцию', editor: 'financeTransaction' } : undefined)}
    <FinanceTable headers={['Дата', 'Категория', 'Комментарий', 'Сумма', 'Счёт', 'Тип', 'Сотрудник']} amounts={[3]}
      rows={transactions.map((entry) => ({ key: entry.id, cells: [
        financeDateTime(entry.occurredAt), entry.categoryId ? categoryNames.get(entry.categoryId) ?? '—' : '—',
        entry.note || '—',
        <span className={entry.amount < 0 ? 'text-danger' : 'text-success'}>{financeMoney(entry.amount)}</span>,
        entry.counterpartyAccountId
          ? [accountNames.get(entry.accountId) ?? '—', entry.amount < 0 ? '→' : '←', accountNames.get(entry.counterpartyAccountId) ?? '—'].join(' ')
          : accountNames.get(entry.accountId) ?? '—',
        entryLabels[entry.kind] ?? entry.kind, entry.actorName || '—',
      ] }))} empty="За этот период нет транзакций по выбранным условиям" />
  </>;
}

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return <button type="button" className="text-primary" aria-label={'Редактировать ' + name} onClick={onClick}>Ред.</button>;
}

function CashFlowDetails({ accounts, categories, entries, from, to, includeTransfers }: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  entries: FinanceEntry[];
  from: string;
  to: string;
  includeTransfers: boolean;
}) {
  const names = new Map(accounts.map(({ id, name }) => [id, name]));
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const initial = accounts.flatMap(({ id, openingBalance, createdAt }) => {
    const day = financeDay(new Date(createdAt));
    return openingBalance && day >= from && day <= to ? [{
      id: 'opening-' + id, accountId: id, occurredAt: createdAt, amount: openingBalance,
      group: 'opening', label: 'Начальный баланс', note: 'Начальный баланс счёта',
    }] : [];
  });
  const motions = entries.filter((entry) => names.has(entry.accountId) && (includeTransfers || entry.kind !== 'transfer')).map((entry) => ({
    ...entry, group: entry.categoryId ? 'category:' + entry.categoryId : entry.kind,
    label: (entry.categoryId && categoryNames.get(entry.categoryId)) || entryLabels[entry.kind],
  }));
  const all = [...initial, ...motions].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  if (!all.length) return null;

  return <div className="mt-4 grid gap-3 lg:grid-cols-2">
    {(['Поступления', 'Расходы'] as const).map((label) => {
      const income = label === 'Поступления';
      const groups = new Map<string, { items: typeof all; cents: number }>();
      for (const item of all) {
        if (income ? item.amount <= 0 : item.amount >= 0) continue;
        const group = groups.get(item.group) ?? { items: [], cents: 0 };
        group.items.push(item);
        group.cents += Math.round(Math.abs(item.amount) * 100);
        groups.set(item.group, group);
      }
      return <section className="min-w-0 rounded-xl border border-border bg-card p-4" key={label}>
        <h2 className="mb-2 font-semibold">{label} по категориям</h2>
        {groups.size === 0 && <p className="text-sm text-text-muted">За этот период нет операций</p>}
        {[...groups.entries()].sort(([, a], [, b]) => b.cents - a.cents).map(([key, { cents, items }]) => (
          <details className="border-b border-border last:border-0" key={key}>
            <summary className="cursor-pointer py-2">
              {items[0].label}<span className="float-right font-medium tabular-nums">{financeMoney(cents / 100)}</span>
            </summary>
            <FinanceTable headers={['Дата', 'Счёт', 'Сумма', 'Комментарий']} amounts={[2]}
              rows={items.map((item) => ({ key: item.id, cells: [
                financeDateTime(item.occurredAt), names.get(item.accountId), financeMoney(item.amount), item.note || '—',
              ] }))} />
          </details>
        ))}
      </section>;
    })}
  </div>;
}
