import { Fragment, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import type { CashFlow, FinanceAccount, FinanceCategory, FinanceEntry } from './api';
import { entryLabels, financeDateTime, financeDay, financeMoney } from './finance-format';
import { FinanceTable } from './CashShiftsPage';
import { downloadRegister } from './FinanceRegister';

type Bucket = { key: string; label: string; opening: number; income: number; expense: number; closing: number };
type Movement = { id: string; at: string; month: string; accountId: string; group: string; label: string; note: string; cents: number };
type Direction = 'income' | 'expense';
const cents = (value: number) => Math.round(value * 100);
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });

function monthsFor(flow: CashFlow, from: string, to: string) {
  const amounts = new Map<string, { income: number; expense: number }>();
  for (const day of flow.days) {
    const key = day.date.slice(0, 7);
    const amount = amounts.get(key) ?? { income: 0, expense: 0 };
    amount.income += cents(day.income);
    amount.expense += cents(day.expense);
    amounts.set(key, amount);
  }
  let balance = cents(flow.opening);
  const months: Bucket[] = [];
  const start = new Date(from.slice(0, 7) + '-01T00:00:00Z');
  const end = new Date(to.slice(0, 7) + '-01T00:00:00Z');
  for (const cursor = start; cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const key = cursor.toISOString().slice(0, 7);
    const { income, expense } = amounts.get(key) ?? { income: 0, expense: 0 };
    const closing = balance + income - expense;
    const month = (from.slice(0, 4) === to.slice(0, 4) ? shortMonthFormat : monthFormat).format(cursor);
    months.push({ key, label: month[0].toLocaleUpperCase('ru') + month.slice(1), opening: balance, income, expense, closing });
    balance = closing;
  }
  months.push({
    key: 'total', label: 'За период', opening: cents(flow.opening), income: cents(flow.income),
    expense: cents(flow.expense), closing: cents(flow.closing),
  });
  return months;
}

function movementsFor(accounts: FinanceAccount[], categories: FinanceCategory[], entries: FinanceEntry[], from: string, to: string, transfers: boolean) {
  const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
  const accountIds = new Set(accounts.map(({ id }) => id));
  const movements: Movement[] = [];
  for (const account of accounts) {
    const day = financeDay(new Date(account.createdAt));
    if (!account.openingBalance || day < from || day > to) continue;
    movements.push({ id: 'opening:' + account.id, at: account.createdAt, month: day.slice(0, 7), accountId: account.id,
      group: 'opening', label: 'Начальный баланс', note: 'Начальный баланс счёта', cents: cents(account.openingBalance) });
  }
  for (const entry of entries) {
    if (!accountIds.has(entry.accountId) || !entry.amount || entry.reversalOf || entry.reversedAt || (entry.kind === 'transfer' && !transfers)) continue;
    const day = financeDay(new Date(entry.occurredAt));
    if (day < from || day > to) continue;
    movements.push({ id: entry.id, at: entry.occurredAt, month: day.slice(0, 7), accountId: entry.accountId,
      group: entry.categoryId ? 'category:' + entry.categoryId : entry.kind,
      label: (entry.categoryId && categoryNames.get(entry.categoryId)) || entryLabels[entry.kind],
      note: entry.note || '—', cents: cents(entry.amount) });
  }
  return movements;
}

export function CashFlowMatrix({ flow, accounts, categories, entries, from, to, selectedAccount, accountFilter, period }: {
  flow: CashFlow; accounts: FinanceAccount[]; categories: FinanceCategory[]; entries: FinanceEntry[];
  from: string; to: string; selectedAccount: string;
  accountFilter: ReactNode; period: ReactNode;
}) {
  const [expanded, setExpanded] = useState<Direction[]>([]);
  const [detail, setDetail] = useState<{ label: string; rows: Movement[] } | null>(null);
  const buckets = monthsFor(flow, from, to);
  const names = new Map(accounts.map(({ id, name }) => [id, name]));
  const movements = movementsFor(accounts, categories, entries, from, to, !!selectedAccount);
  const groups = (['income', 'expense'] as const).map((direction) => {
    const rows = movements.filter((item) => direction === 'income' ? item.cents > 0 : item.cents < 0);
    const byCategory = new Map<string, { label: string; rows: Movement[] }>();
    for (const item of rows) {
      const category = byCategory.get(item.group) ?? { label: item.label, rows: [] };
      category.rows.push(item);
      byCategory.set(item.group, category);
    }
    return { direction, label: direction === 'income' ? 'Поступления' : 'Расходы', rows, byCategory };
  });
  const matching = (bucket: Bucket, rows: Movement[]) =>
    bucket.key === 'total' ? rows : rows.filter(({ month }) => month === bucket.key);
  const value = (bucket: Bucket, rows: Movement[]) => matching(bucket, rows).reduce((total, row) => total + row.cents, 0);
  const signed = (bucket: Bucket, direction: Direction) => direction === 'income' ? bucket.income : 0 - bucket.expense;
  const summary = [
    { label: 'Деньги в начале периода', get: (bucket: Bucket) => bucket.opening },
    { label: 'Деньги в конце периода', get: (bucket: Bucket) => bucket.closing },
    { label: 'Чистый денежный поток', get: (bucket: Bucket) => bucket.closing - bucket.opening },
  ];
  const exportRows = [
    ['Статья', ...buckets.map(({ label }) => label)],
    ...groups.flatMap(({ label, direction, byCategory }) => [
      [label, ...buckets.map((bucket) => signed(bucket, direction) / 100)],
      ...Array.from(byCategory.values(), (category) =>
        [category.label, ...buckets.map((bucket) => value(bucket, category.rows) / 100)]),
    ]),
    ...summary.map(({ label, get }) => [label, ...buckets.map((bucket) => get(bucket) / 100)]),
  ];
  const amountCell = (bucket: Bucket, label: string, amount: number, rows: Movement[]) => {
    const visible = matching(bucket, rows);
    return <td key={bucket.key} className="whitespace-nowrap text-right tabular-nums">
      {visible.length ? <button type="button" className="hover:text-primary"
        aria-label={label + ', ' + bucket.label + ', ' + financeMoney(amount / 100)}
        onClick={() => setDetail({ label: label + ' · ' + bucket.label, rows: visible })}>
        {financeMoney(amount / 100)} <span className="text-text-muted" aria-hidden="true">⌄</span>
      </button> : financeMoney(amount / 100)}
    </td>;
  };
  return <section className="min-w-0">
    <div className="poster-toolbar print:hidden">
      {accountFilter}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary btn-md"
          onClick={() => downloadRegister('Движение денег ' + from + ' — ' + to, [
            ['Движение денег', names.get(selectedAccount) ?? 'Все счета', from, to], ...exportRows,
          ])}>Экспорт CSV</button>
        {period}
      </div>
    </div>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Движение денег по месяцам">
      <table className="poster-register-table w-full min-w-[680px] text-left text-sm">
        <thead><tr><th scope="col">Статья</th>
          {buckets.map(({ key, label }) => <th key={key} scope="col" className="min-w-28 whitespace-nowrap text-right">{label}</th>)}
        </tr></thead>
        <tbody>
          {groups.map(({ direction, label, rows, byCategory }) => <Fragment key={direction}>
            <tr className="bg-background font-semibold">
              <th scope="row" className="px-4 py-3">
                <button type="button" className="inline-flex items-center gap-2 text-left font-semibold" aria-expanded={expanded.includes(direction)}
                  onClick={() => setExpanded((list) => list.includes(direction) ? list.filter((key) => key !== direction) : [...list, direction])}>
                  <span aria-hidden="true">{expanded.includes(direction) ? '⌄' : '›'}</span>{label}
                </button>
              </th>
              {buckets.map((bucket) => amountCell(bucket, label, signed(bucket, direction), rows))}
            </tr>
            {expanded.includes(direction) && (byCategory.size
              ? Array.from(byCategory, ([key, category]) => <tr key={key}>
                <th scope="row" className="py-3 pr-4 font-normal"><span className="block pl-5">{category.label}</span></th>
                {buckets.map((bucket) => amountCell(bucket, category.label, value(bucket, category.rows), category.rows))}
              </tr>)
              : <tr><td className="py-3 pl-8 text-text-muted" colSpan={buckets.length + 1}>Нет операций за период</td></tr>)}
          </Fragment>)}
          {summary.map(({ label, get }) => <tr key={label} className="bg-background font-semibold">
            <th scope="row" className="px-4 py-3"><span className="font-semibold">{label}</span></th>
            {buckets.map((bucket) => <td key={bucket.key} className="whitespace-nowrap text-right tabular-nums">{financeMoney(get(bucket) / 100)}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    {detail && <Modal open title={detail.label} onClose={() => setDetail(null)} panelClassName="max-w-3xl">
      <FinanceTable headers={['Дата', 'Категория', 'Счёт', 'Комментарий', 'Сумма']} amounts={[4]}
        rows={[...detail.rows].sort((a, b) => a.at.localeCompare(b.at)).map((row) => ({ key: row.id, cells: [
          financeDateTime(row.at), row.label, names.get(row.accountId) ?? '—', row.note, financeMoney(row.cents / 100),
        ] }))} />
    </Modal>}
  </section>;
}
