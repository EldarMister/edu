import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, type FinanceAccount, type FinanceCategory, type FinanceEntry } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { warehouseDay } from '../warehouse/report-range';
import {
  FinanceAccountCreateDto, FinanceAccountUpdateDto, FinanceCategoryCreateDto, FinanceCategoryUpdateDto,
  FinanceQueryDto, FinanceTransactionDto, SalaryAccrualDto, SalaryPaymentDto,
} from './finance.dto';
import { ensureFinanceAccounts, lockFinance } from './finance-ledger';

type Db = Prisma.TransactionClient;
const dayMs = 86_400_000;
const zero = new Prisma.Decimal(0);
const note = (value?: string) => value?.trim() || null;
const money = (value: number) => new Prisma.Decimal(value);
const monthOf = (date: Date) => warehouseDay(date).slice(0, 7);

function businessMidnight(day: string) {
  const date = new Date(day + 'T00:00:00+06:00');
  if (!Number.isFinite(date.getTime()) || warehouseDay(date) !== day) {
    throw new BadRequestException('Укажите корректную дату');
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

function ownerOnly(user: AuthUser) {
  if (user.role !== Role.OWNER || !user.cafeId) throw new ForbiddenException();
  return user.cafeId;
}

function tenant(user: AuthUser) {
  if (!user.cafeId) throw new ForbiddenException();
  return user.cafeId;
}

function grantWhere(user: AuthUser): Prisma.FinanceCategoryWhereInput {
  return {
    cafeId: tenant(user),
    ...(user.role === Role.OWNER ? {} : {
      OR: [{ userIds: { has: user.id } }, ...(user.positionId ? [{ positionIds: { has: user.positionId } }] : [])],
    }),
  };
}

async function findAccount(db: Db, cafeId: string, id: string) {
  const account = await db.financeAccount.findFirst({ where: { cafeId, id } });
  if (!account) throw new NotFoundException('Счёт не найден');
  return account;
}

async function shiftForEntry(db: Db, cafeId: string, accountId: string, at: Date) {
  const shift = await db.cashShift.findFirst({ where: { cafeId, accountId, closedAt: null } });
  if (shift && at < shift.openedAt) throw new BadRequestException('Дата операции раньше открытия кассовой смены');
  return shift?.id;
}

export function buildCashFlow(
  accounts: Pick<FinanceAccount, 'createdAt' | 'openingBalance'>[],
  before: Prisma.Decimal,
  entries: Pick<FinanceEntry, 'occurredAt' | 'amount' | 'kind'>[],
  from: Date,
  to: Date,
  oneAccount: boolean,
) {
  let opening = before;
  const days = new Map<string, { income: Prisma.Decimal; expense: Prisma.Decimal }>();
  const add = (at: Date, amount: Prisma.Decimal) => {
    const key = warehouseDay(at);
    const totals = days.get(key) ?? { income: zero, expense: zero };
    if (amount.isPositive()) totals.income = totals.income.add(amount);
    if (amount.isNegative()) totals.expense = totals.expense.sub(amount);
    days.set(key, totals);
  };
  for (const account of accounts) {
    if (account.createdAt < from) opening = opening.add(account.openingBalance);
    else if (account.createdAt < to && !account.openingBalance.isZero()) add(account.createdAt, account.openingBalance);
  }
  for (const entry of entries) if (entry.kind !== 'transfer' || oneAccount) add(entry.occurredAt, entry.amount);

  let income = zero;
  let expense = zero;
  const rows = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amounts]) => {
    income = income.add(amounts.income);
    expense = expense.add(amounts.expense);
    return {
      date, income: Number(amounts.income), expense: Number(amounts.expense),
      net: Number(amounts.income.sub(amounts.expense)), balance: Number(opening.add(income).sub(expense)),
    };
  });
  return { opening: Number(opening), income: Number(income), expense: Number(expense), closing: Number(opening.add(income).sub(expense)), days: rows };
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async access(user: AuthUser) {
    if (!user.cafeId || (user.role !== Role.OWNER && user.role !== Role.ADMIN)) return { allowed: false };
    return { allowed: user.role === Role.OWNER || !!(await this.prisma.financeCategory.findFirst({
      where: grantWhere(user), select: { id: true },
    })) };
  }

  async overview(user: AuthUser, query: FinanceQueryDto) {
    const cafeId = tenant(user);
    const canManage = user.role === Role.OWNER;
    if (!(await this.access(user)).allowed) throw new ForbiddenException();
    const bounds = period(query);
    const month = query.month ?? monthOf(new Date());
    // Existing cafés are seeded by the migration; new cafés obtain their defaults on first use.
    if (await this.prisma.financeAccount.count({ where: { cafeId, isDefault: true } }) !== 2) {
      await this.prisma.$transaction((db) => ensureFinanceAccounts(db, cafeId));
    }

    return this.prisma.$transaction(async (db) => {
      const categories = await db.financeCategory.findMany({ where: grantWhere(user), orderBy: { name: 'asc' } });
      if (!canManage && !categories.length) throw new ForbiddenException();
      const accounts = await db.financeAccount.findMany({ where: { cafeId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
      const entries = await db.financeEntry.findMany({
        where: {
          cafeId, occurredAt: { gte: bounds.from, lt: bounds.to }, ...(query.accountId ? { accountId: query.accountId } : {}),
          ...(canManage ? {} : { actorId: user.id, categoryId: { in: categories.map(({ id }) => id) }, kind: { in: ['income', 'expense'] } }),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      });
      const authors = await db.user.findMany({ where: { cafeId, id: { in: [...new Set(entries.flatMap(({ actorId }) => actorId ? [actorId] : []))] } },
        select: { id: true, name: true } });
      const authorNames = new Map(authors.map(({ id, name }) => [id, name]));
      const entryRows = entries.map((entry) => ({ ...entry, amount: Number(entry.amount), actorName: entry.actorId ? authorNames.get(entry.actorId) : undefined }));
      if (!canManage) return {
        canManage, accounts: accounts.map(({ id, name, type, isDefault, createdAt }) => ({ id, name, type, isDefault, createdAt, openingBalance: null, balance: null })),
        entries: entryRows, categories: categories.map(({ id, name, kind }) => ({ id, name, kind, userIds: [], positionIds: [] })),
        payroll: [], employees: [], positions: [], flow: null,
      };
      const balances = await db.financeEntry.groupBy({ by: ['accountId'], where: { cafeId }, _sum: { amount: true } });
      const byAccount = new Map(balances.map((row) => [row.accountId, row._sum.amount]));
      const before = await db.financeEntry.aggregate({ where: {
        cafeId, occurredAt: { lt: bounds.from }, ...(query.accountId ? { accountId: query.accountId } : {}),
      }, _sum: { amount: true } });
      const payroll = await db.salaryAccrual.findMany({
        where: { cafeId, month }, orderBy: [{ employeeName: 'asc' }, { createdAt: 'desc' }],
        include: { payments: { select: { amount: true } } },
      });
      const employees = await db.user.findMany({ where: { cafeId, isActive: true, role: { not: Role.OWNER } },
        select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
      const positions = await db.staffPosition.findMany({ where: { cafeId, role: Role.ADMIN },
        select: { id: true, name: true }, orderBy: { name: 'asc' } });
      return {
        canManage, entries: entryRows, categories, employees, positions,
        accounts: accounts.map((account) => ({
          ...account, openingBalance: Number(account.openingBalance),
          balance: Number(account.openingBalance.add(byAccount.get(account.id) ?? zero)),
        })),
        payroll: payroll.map(({ payments, ...line }) => ({
          ...line, amount: Number(line.amount), paidAmount: Number(payments.reduce((sum, payment) => sum.sub(payment.amount), zero)),
        })),
        flow: buildCashFlow(accounts.filter((account) => !query.accountId || account.id === query.accountId),
          before._sum.amount ?? zero, entries, bounds.from, bounds.to, !!query.accountId),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async createAccount(user: AuthUser, input: FinanceAccountCreateDto) {
    const cafeId = ownerOnly(user);
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
    const cafeId = ownerOnly(user);
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const account = await findAccount(db, cafeId, id);
      const name = input.name == null ? account.name : title(input.name);
      await this.accountName(db, cafeId, name, id);
      if (input.isDefault === false && account.isDefault) throw new BadRequestException('Назначьте другой счёт этого типа основным');
      if (input.isDefault && !account.isDefault) await this.clearDefault(db, cafeId, account.type);
      return db.financeAccount.update({ where: { cafeId, id }, data: { name, isDefault: input.isDefault ?? account.isDefault } });
    });
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
    return this.saveCategory(ownerOnly(user), input);
  }

  updateCategory(user: AuthUser, id: string, input: FinanceCategoryUpdateDto) {
    return this.saveCategory(ownerOnly(user), input, id);
  }

  private async saveCategory(cafeId: string, input: FinanceCategoryUpdateDto | FinanceCategoryCreateDto, id?: string) {
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const previous = id ? await db.financeCategory.findFirst({ where: { cafeId, id } }) : null;
      if (id && !previous) throw new NotFoundException('Категория не найдена');
      const kind = previous?.kind ?? ('kind' in input ? input.kind : null);
      if (!kind) throw new BadRequestException('Выберите тип категории');
      const name = title(input.name ?? previous?.name ?? '');
      if (await db.financeCategory.findFirst({
        where: { cafeId, kind, name: { equals: name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) },
      })) throw new ConflictException('Категория с таким названием уже существует');
      const userIds = [...new Set(input.userIds ?? previous?.userIds ?? [])];
      const positionIds = [...new Set(input.positionIds ?? previous?.positionIds ?? [])];
      const addedUsers = userIds.filter((value) => !previous?.userIds.includes(value));
      const addedPositions = positionIds.filter((value) => !previous?.positionIds.includes(value));
      if (addedUsers.length && await db.user.count({
        where: { cafeId, id: { in: addedUsers }, role: Role.ADMIN, isActive: true },
      }) !== addedUsers.length) throw new BadRequestException('Доступ можно выдать действующим сотрудникам с ролью администратора в этом заведении');
      if (addedPositions.length && await db.staffPosition.count({
        where: { cafeId, id: { in: addedPositions }, role: Role.ADMIN },
      }) !== addedPositions.length) throw new BadRequestException('Выберите должности администраторов этого заведения');
      const data = { name, userIds, positionIds };
      return id ? db.financeCategory.update({ where: { cafeId, id }, data })
        : db.financeCategory.create({ data: { cafeId, kind, ...data } });
    });
  }

  async post(user: AuthUser, input: FinanceTransactionDto) {
    const cafeId = tenant(user);
    if (user.role !== Role.OWNER && user.role !== Role.ADMIN) throw new ForbiddenException();
    const at = !input.occurredAt ? new Date()
      : /^\d{4}-\d{2}-\d{2}$/.test(input.occurredAt) ? businessMidnight(input.occurredAt) : new Date(input.occurredAt);
    if (!Number.isFinite(at.getTime()) || at.getTime() > Date.now()) throw new BadRequestException('Укажите дату, которая не позже текущего времени');
    const transfer = input.kind === 'transfer';
    const amount = money(input.amount).mul(input.kind === 'income' ? 1 : -1);
    const description = note(input.note);
    if (transfer) ownerOnly(user);
    if (transfer && (!input.destinationAccountId || input.destinationAccountId === input.accountId || input.categoryId)) {
      throw new BadRequestException('Выберите другой счёт для перевода');
    }
    if (!transfer && input.destinationAccountId) throw new BadRequestException('Счёт получателя нужен только для перевода');
    const sourceKey = 'manual:' + input.requestKey;
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      let category: FinanceCategory | null = null;
      if (!transfer && input.categoryId) {
        category = await db.financeCategory.findFirst({ where: { ...grantWhere(user), id: input.categoryId } });
        if (!category) throw new ForbiddenException('Категория недоступна');
        if (category.kind !== input.kind) throw new BadRequestException('Категория не соответствует типу операции');
      }
      if (!transfer && user.role !== Role.OWNER && !category) throw new ForbiddenException('Выберите разрешённую категорию');
      const existing = await db.financeEntry.findFirst({ where: { cafeId, sourceKey } });
      if (existing) {
        if (existing.kind !== input.kind || existing.actorId !== user.id || existing.accountId !== input.accountId ||
          existing.categoryId !== (category?.id ?? null) || existing.counterpartyAccountId !== (input.destinationAccountId ?? null) ||
          !existing.amount.eq(amount) || existing.note !== description ||
          (input.occurredAt && existing.occurredAt.getTime() !== at.getTime())) throw new ConflictException('Этот запрос уже использован для другой операции');
        return existing;
      }
      await findAccount(db, cafeId, input.accountId);
      const shiftId = await shiftForEntry(db, cafeId, input.accountId, at);
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

  async accrue(user: AuthUser, input: SalaryAccrualDto) {
    const cafeId = ownerOnly(user);
    const description = note(input.note);
    return this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const existing = await db.salaryAccrual.findFirst({ where: { cafeId, requestKey: input.requestKey } });
      if (existing) {
        if (existing.userId !== input.userId || existing.month !== input.month ||
          !existing.amount.eq(input.amount) || existing.note !== description) throw new ConflictException('Этот запрос уже использован для другого начисления');
        return existing;
      }
      const employee = await db.user.findFirst({ where: { cafeId, id: input.userId, role: { not: Role.OWNER } }, select: { name: true } });
      if (!employee) throw new NotFoundException('Сотрудник не найден');
      return db.salaryAccrual.create({ data: {
        cafeId, userId: input.userId, employeeName: employee.name, month: input.month,
        amount: input.amount, note: description, actorId: user.id, requestKey: input.requestKey,
      } });
    });
  }

  async paySalary(user: AuthUser, id: string, input: SalaryPaymentDto) {
    const cafeId = ownerOnly(user);
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
      await findAccount(db, cafeId, input.accountId);
      const paid = await db.financeEntry.aggregate({ where: { cafeId, salaryAccrualId: id }, _sum: { amount: true } });
      if (accrual.amount.add(paid._sum.amount ?? zero).lt(amount.negated())) throw new BadRequestException('Выплата больше остатка начисления');
      const at = new Date();
      const shiftId = await shiftForEntry(db, cafeId, input.accountId, at);
      return db.financeEntry.create({ data: { cafeId, sourceKey, kind: 'salary', amount,
        accountId: input.accountId, salaryAccrualId: id, actorId: user.id, cashShiftId: shiftId, note: description, occurredAt: at } });
    });
  }
}
