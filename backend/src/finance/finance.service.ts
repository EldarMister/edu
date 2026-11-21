import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, type FinanceAccount, type FinanceCategory, type FinanceEntry } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { warehouseDay } from '../warehouse/report-range';
import {
  FinanceAccountCreateDto, FinanceAccountUpdateDto, FinanceCategoryCreateDto, FinanceCategoryUpdateDto,
  FinanceQueryDto, FinanceTransactionDto, SalaryAccrualDto, SalaryPaymentDto,
  FinanceTransactionEditDto, FinanceTransactionMetadataDto, PayrollReportDto, SalaryAccrualEditDto, SalaryCorrectionDto,
} from './finance.dto';
import { assertDrawerBalance, ensureFinanceAccounts, lockFinance } from './finance-ledger';
import { cashHandoverKey } from './cash-custody';
import { currentPayrollMonth, payrollPeriodReport, payrollReport } from './payroll';
import { canReverseEntry, type AccountShift } from './entry-reversal';
import { editSalaryAccrual, salaryAccrualDetails, reverseSalaryPayment } from './salary-corrections';
import { resolvePositionPermissions, resolveUserPermissions } from '../common/permissions';
import { assertFinanceTransactionWrite, canEditFinancePermissions, canManageFinance, canViewFinance, financeTenant } from './finance-access';

type Db = Prisma.TransactionClient;
const dayMs = 86_400_000;
const accountRestoreMs = 30 * dayMs;
const zero = new Prisma.Decimal(0);
const note = (value?: string | null) => value?.trim() || null;
const money = (value: number) => new Prisma.Decimal(value);
const monthOf = (date: Date) => warehouseDay(date).slice(0, 7);

function businessMidnight(day: string) {
  const date = new Date(day + 'T00:00:00+06:00');
  if (!Number.isFinite(date.getTime()) || warehouseDay(date) !== day) {
    throw new BadRequestException('Укажите корректную дату');
  }
  return date;
}

function transactionDate(value?: string) {
  const date = !value ? new Date() : /^\d{4}-\d{2}-\d{2}$/.test(value) ? businessMidnight(value) : new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) {
    throw new BadRequestException('Укажите дату, которая не позже текущего времени');
  }
  return date;
}

function period(query: FinanceQueryDto) {
  const today = warehouseDay(new Date());
  const from = businessMidnight(query.from ?? (query.to ?? today).slice(0, 7) + '-01');
  const through = businessMidnight(query.to ?? today);
  if (from > through) throw new BadRequestException('Начальная дата позже конечной');
  return { from, to: new Date(through.getTime() + dayMs) };
}

function title(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException('Введите название');
  return normalized;
}

function tenant(user: AuthUser) {
  if (!user.cafeId) throw new ForbiddenException();
  return user.cafeId;
}

function grantWhere(user: AuthUser): Prisma.FinanceCategoryWhereInput {
  return {
    cafeId: tenant(user),
    ...(canViewFinance(user) ? {} : {
      OR: [{ userIds: { has: user.id } }, ...(user.positionId ? [{ positionIds: { has: user.positionId } }] : [])],
    }),
  };
}

async function findAccount(db: Db, cafeId: string, id: string) {
  const account = await db.financeAccount.findFirst({ where: { cafeId, id, archivedAt: null } });
  if (!account) throw new NotFoundException('Счёт не найден');
  return account;
}

async function shiftForEntry(db: Db, cafeId: string, accountId: string, at: Date, amount?: Prisma.Decimal) {
  const shift = await db.cashShift.findFirst({ where: { cafeId, accountId }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }] });
  if (!shift) return undefined;
  if (shift.closedAt) {
    if (at < shift.closedAt) throw new ConflictException('Дата операции относится к закрытому кассовому периоду');
    return undefined;
  }
  if (at < shift.openedAt) throw new BadRequestException('Дата операции раньше открытия кассовой смены');
  if (amount) await assertDrawerBalance(db, shift, amount);
  return shift.id;
}

const manualKey = 'manual:';
const reversalKey = 'void:';
const isManualEntry = (entry: FinanceEntry) => entry.sourceKey?.startsWith(manualKey)
  && ['income', 'expense', 'transfer'].includes(entry.kind);
const isMetadataEntry = (entry: FinanceEntry) => isManualEntry(entry) && entry.kind !== 'transfer' && !entry.cashShiftId;
const reversalTarget = (sourceKey: string | null) =>
  sourceKey?.startsWith(reversalKey) ? sourceKey.slice(reversalKey.length) : null;

async function latestAccountShifts(db: Db, cafeId: string, accountIds: string[]) {
  const shifts = await db.cashShift.findMany({
    where: { cafeId, accountId: { in: accountIds } }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    distinct: ['accountId'], select: { id: true, accountId: true, openedAt: true, closedAt: true },
  });
  return new Map(shifts.map((shift) => [shift.accountId, shift]));
}

function canReverseCounterparty(entry: FinanceEntry, latest?: AccountShift) {
  return !latest || entry.occurredAt >= (latest.closedAt ?? latest.openedAt);
}

function canEditAt(at: Date, shift?: AccountShift) {
  return !shift || (shift.closedAt !== null && at >= shift.closedAt);
}

function canEditDetails(entry: FinanceEntry, shifts: Map<string, AccountShift>) {
  return !!isManualEntry(entry) && !entry.cashShiftId && !entry.pendingCashShift
    && canEditAt(entry.occurredAt, shifts.get(entry.accountId))
    && (!entry.counterpartyAccountId || canEditAt(entry.occurredAt, shifts.get(entry.counterpartyAccountId)));
}

async function transactionLegs(db: Db, cafeId: string, entry: FinanceEntry) {
  if (entry.kind !== 'transfer' || !entry.sourceKey) return { outgoing: entry };
  const key = entry.sourceKey.endsWith(':in') ? entry.sourceKey.slice(0, -3) : entry.sourceKey;
  const legs = await db.financeEntry.findMany({ where: { cafeId, sourceKey: { in: [key, key + ':in'] } } });
  const outgoing = legs.find(({ sourceKey }) => sourceKey === key);
  const incoming = legs.find(({ sourceKey }) => sourceKey === key + ':in');
  if (outgoing?.kind !== 'transfer' || incoming?.kind !== 'transfer' || !outgoing.amount.isNegative()
    || outgoing.accountId !== incoming.counterpartyAccountId || incoming.accountId !== outgoing.counterpartyAccountId
    || !incoming.amount.eq(outgoing.amount.negated()) || +incoming.occurredAt !== +outgoing.occurredAt) {
    throw new ConflictException('Не удалось сверить обе стороны перевода');
  }
  return { outgoing, incoming };
}

const visibleFinanceMovement: Prisma.FinanceEntryWhereInput = {
  cashCustodianId: null,
  account: { archivedAt: null },
};

async function findEntry(db: Db, cafeId: string, id: string) {
  const entry = await db.financeEntry.findFirst({ where: {
    cafeId, id, ...visibleFinanceMovement,
    OR: [{ counterpartyAccountId: null }, { counterparty: { is: { archivedAt: null } } }],
  } });
  if (!entry) throw new NotFoundException('Транзакция не найдена');
  return entry;
}

export function buildCashFlow(
  accounts: Pick<FinanceAccount, 'openingBalance'>[],
  before: Prisma.Decimal,
  entries: Pick<FinanceEntry, 'occurredAt' | 'amount' | 'kind'>[],
) {
  const opening = accounts.reduce((sum, account) => sum.add(account.openingBalance), before);
  const days = new Map<string, { income: Prisma.Decimal; expense: Prisma.Decimal; transfers: Prisma.Decimal }>();
  for (const { occurredAt, amount, kind } of entries) {
    const key = warehouseDay(occurredAt);
    const totals = days.get(key) ?? { income: zero, expense: zero, transfers: zero };
    if (kind === 'transfer') totals.transfers = totals.transfers.add(amount);
    else if (amount.isPositive()) totals.income = totals.income.add(amount);
    else if (amount.isNegative()) totals.expense = totals.expense.sub(amount);
    days.set(key, totals);
  }

  let income = zero;
  let expense = zero;
  let transfers = zero;
  let balance = opening;
  const rows = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amounts]) => {
    income = income.add(amounts.income);
    expense = expense.add(amounts.expense);
    transfers = transfers.add(amounts.transfers);
    const net = amounts.income.sub(amounts.expense).add(amounts.transfers);
    balance = balance.add(net);
    return {
      date, income: Number(amounts.income), expense: Number(amounts.expense),
      transfers: Number(amounts.transfers), net: Number(net), balance: Number(balance),
    };
  });
  return { opening: Number(opening), income: Number(income), expense: Number(expense),
    transfers: Number(transfers), closing: Number(balance), days: rows };
}

export function cashFlowAccountOpenings(
  accounts: Pick<FinanceAccount, 'id' | 'openingBalance'>[],
  before: { accountId: string; _sum: { amount: Prisma.Decimal | null } }[],
) {
  const balances = new Map(before.map(({ accountId, _sum }) => [accountId, _sum.amount ?? zero]));
  return Object.fromEntries(accounts.map(({ id, openingBalance }) => [id, Number((balances.get(id) ?? zero).add(openingBalance))]));
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async access(user: AuthUser) {
    const canViewAll = canViewFinance(user);
    const canManage = canManageFinance(user);
    const limited = !canViewAll && !!user.cafeId && user.role === Role.ADMIN
      && !!await this.prisma.financeCategory.findFirst({ where: grantWhere(user), select: { id: true } });
    return { allowed: canViewAll || limited, canViewAll, canManage,
      level: canManage ? 'full' : canViewAll ? 'view' : limited ? 'limited' : 'none' };
  }

  async overview(user: AuthUser, query: FinanceQueryDto) {
    const cafeId = tenant(user);
    const canViewAll = canViewFinance(user);
    const canManage = canManageFinance(user);
    const canEditPermissions = canEditFinancePermissions(user);
    if (!(await this.access(user)).allowed) throw new ForbiddenException();
    const bounds = period(query);
    const month = query.month ?? monthOf(new Date());
    const scopedAccounts = query.accountIds?.split(',') ?? (query.accountId ? [query.accountId] : null);
    const accountFilter = scopedAccounts ? { accountId: { in: scopedAccounts } } : {};
    // Existing cafés are seeded by the migration; new cafés obtain their defaults on first use.
    if (await this.prisma.financeAccount.count({ where: { cafeId, isDefault: true } }) !== 2) {
      await this.prisma.$transaction((db) => ensureFinanceAccounts(db, cafeId));
    }

    return this.prisma.$transaction(async (db) => {
      const categories = await db.financeCategory.findMany({ where: grantWhere(user), orderBy: { name: 'asc' } });
      if (!canViewAll && !categories.length) throw new ForbiddenException();
      const accounts = await db.financeAccount.findMany({ where: { cafeId, archivedAt: null }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
      const entries = await db.financeEntry.findMany({
        where: {
          cafeId, pendingCashShift: false, occurredAt: { gte: bounds.from, lt: bounds.to }, ...accountFilter, ...visibleFinanceMovement,
          ...(canViewAll ? {} : { actorId: user.id, categoryId: { in: categories.map(({ id }) => id) }, kind: { in: ['income', 'expense'] } }),
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      const authors = await db.user.findMany({ where: { cafeId, id: { in: [...new Set(entries.flatMap(({ actorId }) => actorId ? [actorId] : []))] } },
        select: { id: true, name: true } });
      const authorNames = new Map(authors.map(({ id, name }) => [id, name]));
      const activeAccountIds = new Set(accounts.map(({ id }) => id));
      const archivedIds = [...new Set(entries.flatMap(({ counterpartyAccountId }) =>
        counterpartyAccountId && !activeAccountIds.has(counterpartyAccountId) ? [counterpartyAccountId] : []))];
      const archivedAccounts = archivedIds.length ? await db.financeAccount.findMany({
        where: { cafeId, id: { in: archivedIds }, archivedAt: { not: null } }, select: { id: true, name: true },
      }) : [];
      const archivedNames = new Map(archivedAccounts.map(({ id, name }) => [id, name]));
      const reversals = canViewAll ? entries : await db.financeEntry.findMany({
        where: { cafeId, pendingCashShift: false, sourceKey: { startsWith: reversalKey }, occurredAt: { gte: bounds.from, lt: bounds.to },
          ...accountFilter, ...visibleFinanceMovement },
        select: { sourceKey: true, createdAt: true },
      });
      const reversedAt = new Map<string, Date>();
      for (const { sourceKey, createdAt } of reversals) {
        const target = reversalTarget(sourceKey);
        if (target) reversedAt.set(target, createdAt);
      }
      const shifts = canManage ? await latestAccountShifts(db, cafeId, accounts.filter(({ type }) => type === 'cash').map(({ id }) => id))
        : new Map<string, AccountShift>();
      const entryRows = entries.map((entry) => {
        const reversed = reversedAt.get(entry.id) ?? null;
        const counterpartyName = entry.counterpartyAccountId ? archivedNames.get(entry.counterpartyAccountId) : undefined;
        return {
          ...entry, amount: Number(entry.amount), actorName: entry.actorId ? authorNames.get(entry.actorId) : undefined,
          counterpartyName, counterpartyArchived: !!counterpartyName,
          reversedAt: reversed, reversalOf: reversalTarget(entry.sourceKey),
          editable: (canManage || !canViewAll) && !reversed && !!isMetadataEntry(entry),
          detailsEditable: canManage && !reversed && !counterpartyName && canEditDetails(entry, shifts),
          reversible: canManage && !reversed && !counterpartyName && !!isManualEntry(entry)
            && canReverseEntry(entry, shifts.get(entry.accountId))
            && (!entry.counterpartyAccountId || canReverseCounterparty(entry, shifts.get(entry.counterpartyAccountId))),
        };
      });
      if (!canViewAll) return {
        canManage, canViewAll, canEditPermissions, accounts: accounts.map(({ id, name, type, isDefault, createdAt }) => ({ id, name, type, isDefault, createdAt, openingBalance: null, balance: null })),
        entries: entryRows, categories: categories.map(({ id, name, kind, parentId, showOnPos }) => ({
          id, name, kind, parentId, showOnPos, userIds: [], positionIds: [],
        })),
        payroll: [], employees: [], positions: [], flow: null,
      };
      const balances = await db.financeEntry.groupBy({ by: ['accountId'], where: { cafeId, pendingCashShift: false, ...visibleFinanceMovement },
        _sum: { amount: true }, _min: { occurredAt: true } });
      const byAccount = new Map(balances.map((row) => [row.accountId, row._sum.amount]));
      const accountFirstMovement = new Map(balances.map(({ accountId, _min }) => [accountId, _min.occurredAt]));
      const before = await db.financeEntry.groupBy({ by: ['accountId'], where: {
        cafeId, pendingCashShift: false, occurredAt: { lt: bounds.from }, ...accountFilter, ...visibleFinanceMovement,
      }, _sum: { amount: true } });
      const scopeIds = scopedAccounts ? new Set(scopedAccounts) : null;
      const flowAccounts = accounts.filter((account) => !scopeIds || scopeIds.has(account.id));
      const firstFinancialDay = flowAccounts.reduce((earliest, account) => {
        const firstMovement = accountFirstMovement.get(account.id);
        const first = firstMovement && firstMovement < account.createdAt ? firstMovement : account.createdAt;
        const day = warehouseDay(first);
        return day < earliest ? day : earliest;
      }, warehouseDay(new Date()));
      const beforeTotal = before.reduce((sum, { _sum }) => sum.add(_sum.amount ?? zero), zero);
      const runningBalance = new Map(before.map(({ accountId, _sum }) => [accountId, _sum.amount ?? zero]));
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const entryBalances = new Map<string, number>();
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (reversedAt.has(entry.id) || reversalTarget(entry.sourceKey)) continue;
        const subtotal = (runningBalance.get(entry.accountId) ?? zero).add(entry.amount);
        runningBalance.set(entry.accountId, subtotal);
        const initial = accountById.get(entry.accountId)?.openingBalance ?? zero;
        entryBalances.set(entry.id, Number(subtotal.add(initial)));
      }
      const payroll = await db.salaryAccrual.findMany({
        where: { cafeId, month, voidedAt: null }, orderBy: [{ employeeName: 'asc' }, { createdAt: 'desc' }],
        include: { payments: { select: { amount: true } } },
      });
      const employees = await db.user.findMany({ where: { cafeId, isActive: true, role: { not: Role.OWNER } },
        select: { id: true, name: true, role: true, permissions: true, position: { select: { role: true, permissions: true, isStarter: true } } }, orderBy: { name: 'asc' } });
      const positions = await db.staffPosition.findMany({ where: { cafeId },
        select: { id: true, name: true, role: true, permissions: true, isStarter: true }, orderBy: { name: 'asc' } });
      return {
        canManage, canViewAll, canEditPermissions, entries: entryRows.map((entry) => ({ ...entry, balanceAfter: entryBalances.get(entry.id) })), categories,
        employees: employees.map((employee) => ({ id: employee.id, name: employee.name, role: employee.role, adminAccess: resolveUserPermissions(employee).adminAccess })),
        positions: positions.filter((position) => resolvePositionPermissions(position).adminAccess).map(({ id, name }) => ({ id, name })),
        accounts: accounts.map((account) => ({
          ...account, openingBalance: Number(account.openingBalance),
          balance: Number(account.openingBalance.add(byAccount.get(account.id) ?? zero)),
        })),
        payroll: payroll.map(({ payments, ...line }) => ({
          ...line, amount: Number(line.amount), paidAmount: Number(payments.reduce((sum, payment) => sum.sub(payment.amount), zero)),
        })),
        flow: {
          ...buildCashFlow(flowAccounts, beforeTotal, entries.filter(({ id, sourceKey }) => !reversedAt.has(id) && !reversalTarget(sourceKey))),
          accountOpening: cashFlowAccountOpenings(flowAccounts, before),
          firstFinancialDay,
        },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async createAccount(user: AuthUser, input: FinanceAccountCreateDto) {
    const cafeId = financeTenant(user);
    const name = title(input.name);
    return this.prisma.$transaction(async (db) => {
      await ensureFinanceAccounts(db, cafeId);
      await this.accountName(db, cafeId, name);
      if (input.isDefault) await this.clearDefault(db, cafeId, input.type);
      return db.financeAccount.create({
        data: { cafeId, name, type: input.type, isDefault: input.isDefault ?? false, openingBalance: input.openingBalance ?? 0 },
      });
    });
  }

  async updateAccount(user: AuthUser, id: string, input: FinanceAccountUpdateDto) {
    const cafeId = financeTenant(user);
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const account = await findAccount(db, cafeId, id);
      const name = input.name == null ? account.name : title(input.name);
      await this.accountName(db, cafeId, name, id);
      if (input.isDefault && account.isCollection) throw new BadRequestException('Сейф для инкассаций нельзя использовать как счёт для оплат');
      if (input.isDefault === false && account.isDefault) throw new BadRequestException('Назначьте другой счёт этого типа основным');
      if (input.isDefault && !account.isDefault) await this.clearDefault(db, cafeId, account.type);
      const openingBalance = input.openingBalance == null ? account.openingBalance : money(input.openingBalance);
      const openingDelta = openingBalance.sub(account.openingBalance);
      if (!openingDelta.isZero()) {
        // The first physical drawer count is authoritative. Correct its reconciliation
        // when the historical starting balance changes, so later counted cash stays intact.
        const firstShift = await db.cashShift.findFirst({ where: { cafeId, accountId: id }, orderBy: [{ openedAt: 'asc' }, { id: 'asc' }] });
        if (firstShift) {
          const sourceKey = 'cash-open:' + firstShift.id;
          const previous = await db.financeEntry.findFirst({ where: { cafeId, sourceKey } });
          const amount = (previous?.amount ?? zero).sub(openingDelta);
          if (amount.isZero()) await db.financeEntry.deleteMany({ where: { cafeId, sourceKey } });
          else await db.financeEntry.upsert({
            where: { cafeId_sourceKey: { cafeId, sourceKey } },
            update: { amount, actorId: user.id },
            create: { cafeId, accountId: id, cashShiftId: firstShift.id, actorId: user.id, sourceKey,
              kind: 'adjustment', amount, pendingCashShift: !firstShift.closedAt, occurredAt: firstShift.openedAt,
              note: 'Сверка наличных при открытии смены' },
          });
        }
      }
      return db.financeAccount.update({ where: { cafeId, id }, data: {
        name, isDefault: input.isDefault ?? account.isDefault, openingBalance,
      } });
    });
  }

  async trashedAccounts(user: AuthUser) {
    const cafeId = financeTenant(user, false);
    return this.prisma.$transaction(async (db) => {
      const accounts = await db.financeAccount.findMany({
        where: { cafeId, archivedAt: { gt: new Date(Date.now() - accountRestoreMs) } },
        select: { id: true, name: true, type: true, archivedAt: true, openingBalance: true },
        orderBy: [{ archivedAt: 'desc' }, { name: 'asc' }],
      });
      if (!accounts.length) return [];
      const movements = await db.financeEntry.groupBy({ by: ['accountId'],
        where: { cafeId, accountId: { in: accounts.map(({ id }) => id) }, pendingCashShift: false },
        _sum: { amount: true },
      });
      const balanceByAccount = new Map(movements.map(({ accountId, _sum }) => [accountId, _sum.amount]));
      return accounts.map(({ openingBalance, ...account }) => ({
        ...account, balance: Number(openingBalance.add(balanceByAccount.get(account.id) ?? zero)),
      }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async archiveAccount(user: AuthUser, id: string) {
    const cafeId = financeTenant(user);
    const result = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const account = await db.financeAccount.findFirst({ where: { cafeId, id } });
      if (!account) throw new NotFoundException('Счёт не найден');
      if (account.archivedAt) return null;
      if (account.isDefault || account.isCollection) {
        throw new ConflictException('Счёт используется для оплат или инкассации');
      }
      const linkedShift = await db.cashShift.findFirst({ where: { cafeId, accountId: id }, select: { id: true } });
      const linkedEntry = await db.financeEntry.findFirst({
        where: {
          cafeId,
          AND: [
            { OR: [{ accountId: id }, { counterpartyAccountId: id }] },
            { OR: [{ cashShiftId: { not: null } }, { kind: { in: ['sale', 'refund', 'salary'] } },
              { sourceKey: { startsWith: cashHandoverKey } }] },
          ],
        },
        select: { id: true },
      });
      if (linkedShift || linkedEntry) throw new ConflictException('Счёт связан с кассовой сменой, продажами или выплатой зарплаты');
      return db.financeAccount.update({ where: { cafeId, id }, data: { archivedAt: new Date() } });
    });
    if (result) await this.audit.log({
      actor: user, actionType: AuditAction.FINANCE_ACCOUNT_ARCHIVED, entityType: AuditEntity.FINANCE_ACCOUNT,
      entityId: id, description: `Счёт «${result.name}» перемещён в корзину`,
    });
    return { id };
  }

  async restoreAccount(user: AuthUser, id: string) {
    const cafeId = financeTenant(user);
    const result = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const account = await db.financeAccount.findFirst({ where: { cafeId, id } });
      if (!account) throw new NotFoundException('Счёт не найден');
      if (!account.archivedAt) return null;
      if (Date.now() - account.archivedAt.getTime() >= accountRestoreMs) {
        throw new ConflictException('Срок восстановления счёта истёк');
      }
      return db.financeAccount.update({ where: { cafeId, id }, data: { archivedAt: null } });
    });
    if (result) await this.audit.log({
      actor: user, actionType: AuditAction.FINANCE_ACCOUNT_RESTORED, entityType: AuditEntity.FINANCE_ACCOUNT,
      entityId: id, description: `Счёт «${result.name}» восстановлен из корзины`,
    });
    return { id };
  }

  private async accountName(db: Db, cafeId: string, name: string, except?: string) {
    if (await db.financeAccount.findFirst({ where: { cafeId, name: { equals: name, mode: 'insensitive' }, ...(except ? { id: { not: except } } : {}) } })) {
      throw new ConflictException('Счёт с таким названием уже существует');
    }
  }

  private async clearDefault(db: Db, cafeId: string, type: FinanceAccount['type']) {
    if (type === 'cash' && await db.cashShift.findFirst({ where: { cafeId, closedAt: null } })) {
      throw new ConflictException('Сначала закройте кассовую смену');
    }
    await db.financeAccount.updateMany({ where: { cafeId, type, isDefault: true }, data: { isDefault: false } });
  }

  createCategory(user: AuthUser, input: FinanceCategoryCreateDto) {
    return this.saveCategory(financeTenant(user), input, undefined, canEditFinancePermissions(user));
  }

  updateCategory(user: AuthUser, id: string, input: FinanceCategoryUpdateDto) {
    return this.saveCategory(financeTenant(user), input, id, canEditFinancePermissions(user));
  }

  async categoryRemoval(user: AuthUser, id: string) {
    const cafeId = financeTenant(user, false);
    return this.prisma.$transaction(async (db) => {
      const { entryCount, childCount, replacements } = await this.categoryRemovalPlan(db, cafeId, id);
      return { entryCount, childCount, replacementIds: replacements.map((category) => category.id) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async deleteCategory(user: AuthUser, id: string, replacementId?: string) {
    const cafeId = financeTenant(user);
    const { category, replacement, moved, children } = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const { category, entryCount, replacements } = await this.categoryRemovalPlan(db, cafeId, id);
      if (entryCount && !replacementId) throw new ConflictException('Выберите категорию для переноса транзакций');
      const replacement = replacements.find(({ id: candidateId }) => candidateId === replacementId);
      if (replacementId && !replacement) {
        throw new BadRequestException('Категория для переноса должна подходить для всех транзакций');
      }
      const moved = replacement ? (await db.financeEntry.updateMany({
        where: { cafeId, categoryId: id },
        data: { categoryId: replacement.id },
      })).count : 0;
      const { count: children } = await db.financeCategory.updateMany({
        where: { cafeId, parentId: id }, data: { parentId: category.parentId },
      });
      await db.financeCategory.delete({ where: { cafeId, id } });
      return { category, replacement, moved, children };
    });
    await this.audit.log({
      actor: user, actionType: AuditAction.CATEGORY_DELETED, entityType: AuditEntity.CATEGORY,
      entityId: id, description: `Удалена категория транзакций «${category.name}»`,
      oldValue: { name: category.name, kind: category.kind },
      metadata: { moved, children, replacementId: replacement?.id ?? null },
    });
    return { id, moved };
  }

  private async categoryRemovalPlan(db: Db, cafeId: string, id: string) {
    const category = await db.financeCategory.findFirst({
      where: { cafeId, id }, select: { id: true, name: true, kind: true, parentId: true },
    });
    if (!category) throw new NotFoundException('Категория не найдена');
    const [usage, childCount] = await Promise.all([
      db.financeEntry.groupBy({ by: ['kind'], where: { cafeId, categoryId: id }, _count: { _all: true } }),
      db.financeCategory.count({ where: { cafeId, parentId: id } }),
    ]);
    const entryCount = usage.reduce((total, row) => total + row._count._all, 0);
    const kinds = usage.flatMap(({ kind }) => kind === 'income' || kind === 'expense' ? [kind] : []);
    const requiredKind = kinds.length > 1 ? 'both' : kinds[0] ?? category.kind;
    const replacements = entryCount ? await db.financeCategory.findMany({
      where: { cafeId, id: { not: id }, kind: requiredKind === 'both' ? requiredKind : { in: [requiredKind, 'both'] } },
      select: { id: true },
    }) : [];
    return { category, entryCount, childCount, replacements };
  }

  private async saveCategory(cafeId: string, input: FinanceCategoryUpdateDto | FinanceCategoryCreateDto, id?: string, canEditPermissions = false) {
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const previous = id ? await db.financeCategory.findFirst({ where: { cafeId, id } }) : null;
      if (id && !previous) throw new NotFoundException('Категория не найдена');
      const kind = input.kind ?? previous?.kind;
      if (!kind) throw new BadRequestException('Выберите тип категории');
      const name = title(input.name ?? previous?.name ?? '');
      const parentId = input.parentId === undefined ? previous?.parentId ?? null : input.parentId;
      if (parentId && parentId !== previous?.parentId) {
        const categoryParents = new Map((await db.financeCategory.findMany({
          where: { cafeId }, select: { id: true, parentId: true },
        })).map((category) => [category.id, category.parentId]));
        if (!categoryParents.has(parentId)) throw new BadRequestException('Родительская категория не найдена');
        const visited = new Set<string>();
        for (let ancestor: string | null = parentId; ancestor; ancestor = categoryParents.get(ancestor) ?? null) {
          if (ancestor === id || visited.has(ancestor)) throw new BadRequestException('Нельзя вложить категорию в себя или в её подкатегорию');
          visited.add(ancestor);
        }
      }
      if (await db.financeCategory.findFirst({
        where: { cafeId, kind: kind === 'both' ? undefined : { in: [kind, 'both'] },
          name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) },
      })) throw new ConflictException('Категория с таким названием уже существует');
      const userIds = [...new Set(input.userIds ?? previous?.userIds ?? [])];
      const positionIds = [...new Set(input.positionIds ?? previous?.positionIds ?? [])];
      const sameIds = (left: string[], right: string[]) => left.length === right.length && left.every((value) => right.includes(value));
      if (!canEditPermissions && (!sameIds(userIds, previous?.userIds ?? []) || !sameIds(positionIds, previous?.positionIds ?? []))) {
        throw new ForbiddenException('Нет права менять доступ сотрудников к категориям');
      }
      const addedUsers = userIds.filter((value) => !previous?.userIds.includes(value));
      const addedPositions = positionIds.filter((value) => !previous?.positionIds.includes(value));
      if (addedUsers.length) {
        const candidates = await db.user.findMany({ where: { cafeId, id: { in: addedUsers }, isActive: true, role: { not: Role.OWNER } },
          select: { id: true, role: true, permissions: true, position: { select: { role: true, permissions: true, isStarter: true } } } });
        if (candidates.filter((candidate) => resolveUserPermissions(candidate).adminAccess).length !== addedUsers.length) {
          throw new BadRequestException('Выберите сотрудников с доступом к админ-панели этого заведения');
        }
      }
      if (addedPositions.length) {
        const candidates = await db.staffPosition.findMany({ where: { cafeId, id: { in: addedPositions } }, select: { role: true, permissions: true, isStarter: true } });
        if (candidates.filter((candidate) => resolvePositionPermissions(candidate).adminAccess).length !== addedPositions.length) {
          throw new BadRequestException('Выберите должности с доступом к админ-панели этого заведения');
        }
      }
      const data = { name, kind, parentId, userIds, positionIds, showOnPos: input.showOnPos ?? previous?.showOnPos ?? false };
      return id ? db.financeCategory.update({ where: { cafeId, id }, data })
        : db.financeCategory.create({ data: { cafeId, ...data } });
    });
  }

  async updateTransaction(user: AuthUser, id: string, input: FinanceTransactionMetadataDto) {
    const cafeId = tenant(user);
    assertFinanceTransactionWrite(user);
    const { before, updated } = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const before = await findEntry(db, cafeId, id);
      if (!canManageFinance(user)) {
        if (before.actorId !== user.id || !before.categoryId || !await db.financeCategory.findFirst({
          where: { ...grantWhere(user), id: before.categoryId }, select: { id: true },
        })) throw new ForbiddenException('Транзакция недоступна');
      }
      if (!isMetadataEntry(before)) throw new BadRequestException('Можно изменить категорию и комментарий ручного дохода или расхода вне кассовой смены');
      const reversed = await db.financeEntry.findFirst({ where: { cafeId, sourceKey: reversalKey + id }, select: { id: true } });
      if (reversed) throw new ConflictException('Транзакция уже отменена');
      const categoryId = input.categoryId === undefined ? before.categoryId : input.categoryId;
      if (categoryId !== before.categoryId) {
        if (!categoryId && !canManageFinance(user)) throw new ForbiddenException('Выберите разрешённую категорию');
        if (categoryId) {
          const category = await db.financeCategory.findFirst({ where: { ...grantWhere(user), id: categoryId } });
          if (!category) throw new ForbiddenException('Категория недоступна');
          if (category.kind !== 'both' && category.kind !== before.kind) throw new BadRequestException('Категория не соответствует типу операции');
        }
      }
      const comment = input.note === undefined ? before.note : note(input.note);
      if (categoryId === before.categoryId && comment === before.note) return { before, updated: before };
      const updated = await db.financeEntry.update({ where: { id, cafeId }, data: { categoryId, note: comment } });
      return { before, updated };
    });
    if (before !== updated) {
      await this.audit.log({
        actor: user, actionType: AuditAction.FINANCE_TRANSACTION_UPDATED, entityType: AuditEntity.FINANCE_TRANSACTION,
        entityId: id, description: 'Обновлены категория или комментарий транзакции',
        oldValue: { categoryId: before.categoryId, note: before.note },
        newValue: { categoryId: updated.categoryId, note: updated.note },
      });
    }
    return updated;
  }

  async editTransaction(user: AuthUser, id: string, input: FinanceTransactionEditDto) {
    const cafeId = financeTenant(user);
    const transfer = input.kind === 'transfer';
    const destination = input.destinationAccountId || null;
    if (transfer && (!destination || destination === input.accountId || input.categoryId)) {
      throw new BadRequestException('Выберите другой счёт для перевода');
    }
    if (!transfer && destination) throw new BadRequestException('Счёт получателя нужен только для перевода');
    const { before, updated } = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const entry = await findEntry(db, cafeId, id);
      if (!isManualEntry(entry)) throw new BadRequestException('Можно изменить только ручную транзакцию');
      const { outgoing: before, incoming } = await transactionLegs(db, cafeId, entry);
      const originals = incoming ? [before, incoming] : [before];
      const reversed = await db.financeEntry.findFirst({
        where: { cafeId, sourceKey: { in: originals.map((leg) => reversalKey + leg.id) } }, select: { id: true },
      });
      if (reversed) throw new ConflictException('Транзакция уже отменена');
      const accounts = [...new Set([...originals.map((leg) => leg.accountId), input.accountId, ...(destination ? [destination] : [])])];
      const shifts = await latestAccountShifts(db, cafeId, accounts);
      if (originals.some((leg) => !canEditDetails(leg, shifts))) {
        throw new ConflictException('Операция относится к сверке кассы. Измените её в кассовой смене');
      }

      const occurredAt = input.occurredAt ? transactionDate(input.occurredAt) : before.occurredAt;
      await findAccount(db, cafeId, input.accountId);
      if (destination) await findAccount(db, cafeId, destination);
      if (!canEditAt(occurredAt, shifts.get(input.accountId)) || (destination && !canEditAt(occurredAt, shifts.get(destination)))) {
        throw new ConflictException('Выберите дату и счета вне кассовой смены');
      }
      const categoryId = input.categoryId || null;
      if (categoryId) {
        const category = await db.financeCategory.findFirst({ where: { cafeId, id: categoryId } });
        if (!category) throw new ForbiddenException('Категория недоступна');
        if (category.kind !== 'both' && category.kind !== input.kind) throw new BadRequestException('Категория не соответствует типу операции');
      }
      const amount = money(input.amount).mul(input.kind === 'income' ? 1 : -1);
      const comment = note(input.note);
      if (before.kind === input.kind && before.accountId === input.accountId && before.categoryId === categoryId
        && before.counterpartyAccountId === destination && before.amount.eq(amount) && before.note === comment
        && +before.occurredAt === +occurredAt) return { before, updated: before };
      const values = { kind: input.kind, accountId: input.accountId, categoryId, counterpartyAccountId: destination,
        amount, note: comment, occurredAt };
      const updated = await db.financeEntry.update({ where: { cafeId, id: before.id }, data: values });
      if (destination) {
        const incomingValues = { ...values, accountId: destination, amount: amount.negated(), counterpartyAccountId: input.accountId };
        if (incoming) {
          await db.financeEntry.update({ where: { cafeId, id: incoming.id }, data: incomingValues });
        } else {
          await db.financeEntry.create({ data: { ...incomingValues, cafeId, sourceKey: before.sourceKey + ':in',
            actorId: before.actorId, createdAt: before.createdAt } });
        }
      } else if (incoming) {
        await db.financeEntry.delete({ where: { cafeId, id: incoming.id } });
      }
      return { before, updated };
    });
    if (before !== updated) {
      const details = (entry: FinanceEntry) => ({
        kind: entry.kind, accountId: entry.accountId, counterpartyAccountId: entry.counterpartyAccountId,
        categoryId: entry.categoryId, amount: entry.amount.toString(), note: entry.note, occurredAt: entry.occurredAt.toISOString(),
      });
      await this.audit.log({
        actor: user, actionType: AuditAction.FINANCE_TRANSACTION_UPDATED, entityType: AuditEntity.FINANCE_TRANSACTION,
        entityId: updated.id, description: 'Изменена ручная транзакция',
        oldValue: details(before), newValue: details(updated),
      });
    }
    return updated;
  }

  async reverseTransaction(user: AuthUser, id: string, reason: string) {
    const cafeId = financeTenant(user);
    const description = note(reason);
    if (!description) throw new BadRequestException('Укажите причину отмены');
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const entry = await findEntry(db, cafeId, id);
      if (!isManualEntry(entry) || !entry.sourceKey) throw new BadRequestException('Можно отменить только ручную транзакцию');
      const { outgoing, incoming } = await transactionLegs(db, cafeId, entry);
      const originals = incoming ? [outgoing, incoming] : [outgoing];
      const previous = await db.financeEntry.findMany({
        where: { cafeId, sourceKey: { in: originals.map(({ id }) => reversalKey + id) } },
        select: { createdAt: true, note: true },
      });
      if (previous.length) {
        if (previous.length === originals.length && previous.every((row) => row.note === description)) {
          return { id, reversedAt: previous[0].createdAt };
        }
        throw new ConflictException('Транзакция уже отменена');
      }
      const shifts = await latestAccountShifts(db, cafeId, [...new Set(originals.map(({ accountId }) => accountId))]);
      if (originals.some((line) => !canReverseEntry(line, shifts.get(line.accountId)))) {
        throw new ConflictException('Операция учтена в сверке кассы. Внесите отдельную корректировку текущего остатка');
      }
      for (const line of originals) {
        if (line.amount.isPositive()) await shiftForEntry(db, cafeId, line.accountId, line.occurredAt, line.amount.negated());
      }
      const reversedAt = new Date();
      await db.financeEntry.createMany({ data: originals.map((line) => ({
        cafeId, accountId: line.accountId, actorId: user.id, categoryId: line.categoryId,
        cashShiftId: line.cashShiftId, counterpartyAccountId: line.counterpartyAccountId,
        kind: line.kind === 'transfer' ? 'transfer' as const : 'adjustment' as const,
        sourceKey: reversalKey + line.id, amount: line.amount.negated(), note: description,
        occurredAt: line.occurredAt, createdAt: reversedAt,
      })) });
      return { id, reversedAt };
    });
  }

  async post(user: AuthUser, input: FinanceTransactionDto) {
    const cafeId = tenant(user);
    assertFinanceTransactionWrite(user);
    const at = transactionDate(input.occurredAt);
    const transfer = input.kind === 'transfer';
    const amount = money(input.amount).mul(input.kind === 'income' ? 1 : -1);
    const description = note(input.note);
    if (transfer) financeTenant(user);
    if (transfer && (!input.destinationAccountId || input.destinationAccountId === input.accountId || input.categoryId)) {
      throw new BadRequestException('Выберите другой счёт для перевода');
    }
    if (!transfer && input.destinationAccountId) throw new BadRequestException('Счёт получателя нужен только для перевода');
    const sourceKey = manualKey + input.requestKey;
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      let category: FinanceCategory | null = null;
      if (!transfer && input.categoryId) {
        category = await db.financeCategory.findFirst({ where: { ...grantWhere(user), id: input.categoryId } });
        if (!category) throw new ForbiddenException('Категория недоступна');
        if (category.kind !== 'both' && category.kind !== input.kind) throw new BadRequestException('Категория не соответствует типу операции');
      }
      if (!transfer && !canManageFinance(user) && !category) throw new ForbiddenException('Выберите разрешённую категорию');
      const existing = await db.financeEntry.findFirst({ where: { cafeId, sourceKey } });
      if (existing) {
        if (existing.kind !== input.kind || existing.actorId !== user.id || existing.accountId !== input.accountId ||
          existing.categoryId !== (category?.id ?? null) || existing.counterpartyAccountId !== (input.destinationAccountId ?? null) ||
          !existing.amount.eq(amount) || existing.note !== description ||
          (input.occurredAt && existing.occurredAt.getTime() !== at.getTime())) throw new ConflictException('Этот запрос уже использован для другой операции');
        return existing;
      }
      await findAccount(db, cafeId, input.accountId);
      const shiftId = await shiftForEntry(db, cafeId, input.accountId, at, amount);
      const entry = await db.financeEntry.create({
        data: { cafeId, accountId: input.accountId, actorId: user.id, sourceKey, kind: input.kind, amount,
          cashShiftId: shiftId, categoryId: category?.id, counterpartyAccountId: input.destinationAccountId, note: description, occurredAt: at },
      });
      if (transfer && input.destinationAccountId) {
        await findAccount(db, cafeId, input.destinationAccountId);
        const destinationShiftId = await shiftForEntry(db, cafeId, input.destinationAccountId, at);
        await db.financeEntry.create({ data: {
          cafeId, accountId: input.destinationAccountId, actorId: user.id, kind: 'transfer', sourceKey: sourceKey + ':in',
          amount: amount.negated(), cashShiftId: destinationShiftId, counterpartyAccountId: input.accountId, note: description, occurredAt: at,
        } });
      }
      return entry;
    });
  }

  async payroll(user: AuthUser, { month, from, to }: PayrollReportDto) {
    const cafeId = financeTenant(user, false);
    if (month && !from && !to) {
      return this.prisma.$transaction((db) => payrollReport(db, cafeId, month), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    }
    if (month || !from || !to) throw new BadRequestException('Выберите период зарплаты');
    return this.prisma.$transaction((db) => payrollPeriodReport(db, cafeId, from, to), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15_000,
    });
  }

  async accrueCalculated(user: AuthUser, input: SalaryAccrualDto) {
    const cafeId = financeTenant(user);
    if (input.supplemental) throw new BadRequestException('Доплата оформляется отдельно от расчёта по ставкам');
    const description = note(input.note);
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const existing = await db.salaryAccrual.findFirst({ where: { cafeId, requestKey: input.requestKey } });
      if (existing) {
        if (existing.voidedAt) throw new ConflictException('Начисление отменено. Создайте новое начисление');
        if (!existing.calculation || existing.userId !== input.userId || existing.month !== input.month ||
          !existing.amount.eq(input.amount) || existing.note !== description) {
          throw new ConflictException('Этот запрос уже использован для другого начисления');
        }
        return existing;
      }
      if (input.month > currentPayrollMonth()) throw new BadRequestException('Период начисления ещё не начался');
      const { staff } = await payrollReport(db, cafeId, input.month, input.userId);
      const row = staff.find(({ userId }) => userId === input.userId);
      if (!row) throw new NotFoundException('Сотрудник не найден');
      if (row.available <= 0 || row.available !== input.amount) {
        throw new ConflictException('Сумма к начислению изменилась. Пересчитайте зарплату');
      }
      const { rates, hours, shifts, days, personalSales, shiftSales, rateMonth, estimate } = row;
      return db.salaryAccrual.create({ data: {
        cafeId, userId: row.userId, employeeName: row.name, month: input.month,
        amount: row.available, note: description, actorId: user.id, requestKey: input.requestKey,
        calculation: { rates, hours, shifts, days, personalSales, shiftSales, rateMonth, estimate },
      } });
    });
  }

  async accrue(user: AuthUser, input: SalaryAccrualDto) {
    const cafeId = financeTenant(user);
    const description = note(input.note);
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const existing = await db.salaryAccrual.findFirst({ where: { cafeId, requestKey: input.requestKey } });
      if (existing) {
        if (existing.voidedAt) throw new ConflictException('Начисление отменено. Создайте новое начисление');
        if (existing.calculation || !!existing.supplemental !== !!input.supplemental || existing.userId !== input.userId || existing.month !== input.month ||
          !existing.amount.eq(input.amount) || existing.note !== description) throw new ConflictException('Этот запрос уже использован для другого начисления');
        return existing;
      }
      const employee = await db.user.findFirst({ where: { cafeId, id: input.userId, role: { not: Role.OWNER } }, select: { name: true } });
      if (!employee) throw new NotFoundException('Сотрудник не найден');
      return db.salaryAccrual.create({ data: {
        cafeId, userId: input.userId, employeeName: employee.name, month: input.month,
        amount: input.amount, note: description, actorId: user.id, requestKey: input.requestKey, supplemental: input.supplemental ?? false,
      } });
    });
  }

  async paySalary(user: AuthUser, id: string, input: SalaryPaymentDto) {
    const cafeId = financeTenant(user);
    const sourceKey = 'salary:' + input.requestKey;
    const amount = money(input.amount).negated();
    const description = note(input.note);
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const previous = await db.financeEntry.findFirst({ where: { cafeId, sourceKey } });
      if (previous) {
        if (previous.salaryAccrualId !== id || previous.accountId !== input.accountId ||
          !previous.amount.eq(amount) || previous.note !== description) throw new ConflictException('Этот запрос уже использован для другой выплаты');
        return previous;
      }
      const accrual = await db.salaryAccrual.findFirst({ where: { cafeId, id } });
      if (!accrual) throw new NotFoundException('Начисление не найдено');
      if (accrual.voidedAt) throw new ConflictException('Нельзя выплатить отменённое начисление');
      await findAccount(db, cafeId, input.accountId);
      const paid = await db.financeEntry.aggregate({ where: { cafeId, salaryAccrualId: id }, _sum: { amount: true } });
      if (accrual.amount.add(paid._sum.amount ?? zero).lt(amount.negated())) throw new BadRequestException('Выплата больше остатка начисления');
      const at = new Date();
      const shiftId = await shiftForEntry(db, cafeId, input.accountId, at, amount);
      return db.financeEntry.create({ data: { cafeId, sourceKey, kind: 'salary', amount,
        accountId: input.accountId, salaryAccrualId: id, actorId: user.id, cashShiftId: shiftId, note: description, occurredAt: at } });
    });
  }

  async salaryDetails(user: AuthUser, id: string) {
    const cafeId = financeTenant(user, false);
    return this.prisma.$transaction((db) => salaryAccrualDetails(db, cafeId, id), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  async editSalary(user: AuthUser, id: string, input: SalaryAccrualEditDto | SalaryCorrectionDto, cancel = false) {
    const cafeId = financeTenant(user);
    const result = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      return editSalaryAccrual(db, cafeId, user, id, input, cancel);
    });
    if (result.change) await this.audit.log({
      actor: user, entityType: AuditEntity.SALARY_ACCRUAL, entityId: id,
      actionType: cancel ? AuditAction.SALARY_ACCRUAL_CANCELLED : AuditAction.SALARY_ACCRUAL_UPDATED,
      description: cancel ? 'Отменено начисление зарплаты' : 'Исправлено начисление зарплаты',
      oldValue: result.change.before, newValue: cancel ? null : result.change.after,
      metadata: { reason: result.change.reason, revision: result.revision },
    });
    return { id: result.id, revision: result.revision, voidedAt: result.voidedAt };
  }

  async reverseSalary(user: AuthUser, id: string, paymentId: string, reason: string) {
    const cafeId = financeTenant(user);
    const result = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      return reverseSalaryPayment(db, cafeId, user, id, paymentId, reason);
    });
    if (result.created) await this.audit.log({
      actor: user, entityType: AuditEntity.SALARY_ACCRUAL, entityId: id,
      actionType: AuditAction.SALARY_PAYMENT_REVERSED, description: 'Отменена ошибочная выплата зарплаты',
      metadata: { paymentId, reason: reason.trim(), reversalId: result.id },
    });
    return { id: result.id, reversedAt: result.reversedAt };
  }
}
