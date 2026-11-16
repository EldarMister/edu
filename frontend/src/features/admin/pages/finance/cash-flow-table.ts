import type { AccountType, CashFlow, FinanceAccount, FinanceCategory, FinanceEntry } from './api';
import { entryCategoryLabel, financeDay } from './finance-format';

export type FlowMovement = { id: string; at: string; month: string; accountId: string; category: string; note: string; cents: number; internalTransfer: boolean };
export type FlowLine = {
  id: string; label: string; movements?: FlowMovement[]; children?: FlowLine[];
  measure?: 'opening' | 'closing' | 'net'; accountId?: string;
};
type Balance = { opening: number; closing: number };
type CategoryLine = { id: string; label: string; movements: FlowMovement[]; children: Map<string, CategoryLine> };
export type FlowPeriod = { key: string; label: string; shortLabel: string; balance: Balance; accounts: Map<string, Balance> };
export type FlowColumn = { id: string; label: string; period: FlowPeriod; type?: AccountType; percent?: boolean };
const amountCents = (value: number) => Math.round(value * 100);
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
const upperFirst = (value: string) => value.slice(0, 1).toLocaleUpperCase('ru') + value.slice(1);
const totalKey = 'total';

export function buildCashFlowTable(flow: CashFlow, accounts: FinanceAccount[], categories: FinanceCategory[], entries: FinanceEntry[],
  from: string, to: string, selectedAccount: string) {
  const byAccount = new Map(accounts.map((account) => [account.id, account]));
  const byCategory = new Map(categories.map((category) => [category.id, category]));
  const movements: FlowMovement[] = [];
  const groups = { income: new Map<string, CategoryLine>(), expense: new Map<string, CategoryLine>() };

  function add(movement: FlowMovement, categoryId?: string) {
    movements.push(movement);
    if (movement.internalTransfer) return;
    const group = groups[movement.cents > 0 ? 'income' : 'expense'];
    const categoryPath: Pick<FinanceCategory, 'id' | 'name'>[] = [];
    const visited = new Set<string>();
    let category = categoryId ? byCategory.get(categoryId) : undefined;
    while (category && !visited.has(category.id)) {
      visited.add(category.id);
      categoryPath.unshift(category);
      category = category.parentId ? byCategory.get(category.parentId) : undefined;
    }
    if (!categoryPath.length) categoryPath.push({ id: 'system:' + movement.category, name: movement.category });
    let level = group;
    for (const part of categoryPath) {
      const line: CategoryLine = level.get(part.id) ?? { id: part.id, label: part.name, movements: [], children: new Map() };
      if (!level.has(part.id)) level.set(part.id, line);
      line.movements.push(movement);
      level = line.children;
    }
  }

  for (const account of accounts) {
    const day = financeDay(new Date(account.createdAt));
    if (!account.openingBalance || day < from || day > to) continue;
    add({ id: 'opening:' + account.id, at: account.createdAt, month: day.slice(0, 7), accountId: account.id,
      category: 'Начальный баланс', note: 'Начальный баланс счёта', cents: amountCents(account.openingBalance), internalTransfer: false });
  }
  for (const entry of entries) {
    if (!byAccount.has(entry.accountId) || !entry.amount || entry.reversalOf || entry.reversedAt) continue;
    const day = financeDay(new Date(entry.occurredAt));
    if (day < from || day > to) continue;
    const internalTransfer = entry.kind === 'transfer'
      && (!selectedAccount || (!!entry.counterpartyAccountId && byAccount.has(entry.counterpartyAccountId)));
    add({ id: entry.id, at: entry.occurredAt, month: day.slice(0, 7), accountId: entry.accountId,
      category: entryCategoryLabel(entry, entry.categoryId ? byCategory.get(entry.categoryId)?.name : undefined),
      note: entry.note || '—', cents: amountCents(entry.amount), internalTransfer }, entry.categoryId);
  }

  const accountMoves = new Map<string, Map<string, number>>();
  for (const movement of movements) {
    const months = accountMoves.get(movement.accountId) ?? new Map<string, number>();
    months.set(movement.month, (months.get(movement.month) ?? 0) + movement.cents);
    accountMoves.set(movement.accountId, months);
  }
  const monthNet = new Map<string, number>();
  for (const day of flow.days) {
    const month = day.date.slice(0, 7);
    monthNet.set(month, (monthNet.get(month) ?? 0) + amountCents(day.net));
  }
  const accountBalances = new Map(Object.entries(flow.accountOpening ?? {}));
  for (const [id, amount] of accountBalances) accountBalances.set(id, amountCents(amount));
  const periods: FlowPeriod[] = [];
  let balance = amountCents(flow.opening);
  const start = new Date(from.slice(0, 7) + '-01T00:00:00Z');
  const end = new Date(to.slice(0, 7) + '-01T00:00:00Z');
  for (const cursor = start; cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const key = cursor.toISOString().slice(0, 7);
    const month = upperFirst(monthLabel.format(cursor));
    const label = from.slice(0, 4) === to.slice(0, 4) ? month : month + ' ' + cursor.getUTCFullYear();
    const closing = balance + (monthNet.get(key) ?? 0);
    const balances = new Map<string, Balance>();
    for (const [id, opening] of accountBalances) {
      const next = opening + (accountMoves.get(id)?.get(key) ?? 0);
      balances.set(id, { opening, closing: next });
      accountBalances.set(id, next);
    }
    periods.push({ key, label, shortLabel: month.slice(0, 3) + (label === month ? '' : ' ' + cursor.getUTCFullYear()),
      balance: { opening: balance, closing }, accounts: balances });
    balance = closing;
  }
  const totalBalances = new Map<string, Balance>();
  for (const [id, closing] of accountBalances) {
    totalBalances.set(id, { opening: amountCents(flow.accountOpening?.[id] ?? 0), closing });
  }
  periods.push({ key: totalKey, label: 'За период', shortLabel: 'За период',
    balance: { opening: amountCents(flow.opening), closing: amountCents(flow.closing) }, accounts: totalBalances });
  const balanceLines = (measure: 'opening' | 'closing', label: string): FlowLine => ({
    id: measure, label, measure, children: accounts.filter(({ id }) => accountBalances.has(id)).map(({ id, name }) =>
      ({ id: measure + ':' + id, label: name, measure, accountId: id })),
  });
  const lines: FlowLine[] = Object.entries(groups).flatMap(([direction, categories]) => {
    const children = sortedLines(categories);
    return children.length ? [{ id: direction, label: direction === 'income' ? 'Поступления' : 'Расходы',
      movements: children.flatMap(({ movements: entries }) => entries ?? []), children }] : [];
  });
  lines.push(balanceLines('opening', 'Деньги в начале периода'), balanceLines('closing', 'Деньги в конце периода'),
    { id: 'net', label: 'Чистый денежный поток', measure: 'net', movements });
  return { periods, lines, byAccount };
}

function sortedLines(lines: Map<string, CategoryLine>): FlowLine[] {
  return [...lines.values()].sort((a, b) => a.label.localeCompare(b.label, 'ru'))
    .map((line) => ({ ...line, children: sortedLines(line.children) }));
}

export function flowCell(line: FlowLine, column: FlowColumn, byAccount: Map<string, FinanceAccount>) {
  const { period, type } = column;
  const movements = (line.movements ?? []).filter((movement) =>
    (period.key === totalKey || movement.month === period.key)
    && (!type || byAccount.get(movement.accountId)?.type === type)
    && (!movement.internalTransfer || type));
  if (!line.measure) return { movements, cents: movements.reduce((total, movement) => total + movement.cents, 0) };
  let balance = period.balance;
  if (line.accountId || type) {
    balance = { opening: 0, closing: 0 };
    for (const [id, amounts] of period.accounts) {
      if ((line.accountId && id !== line.accountId) || (type && byAccount.get(id)?.type !== type)) continue;
      balance.opening += amounts.opening;
      balance.closing += amounts.closing;
    }
  }
  const cents = line.measure === 'net' ? balance.closing - balance.opening : balance[line.measure];
  return { movements, cents };
}
