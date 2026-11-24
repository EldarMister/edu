import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { CashShift, Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import { IsBoolean, IsISO8601, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { hasPermission, resolvePermissions } from '../common/permissions';
import { projectWorkspaceUser, type Workspace } from '../common/workspace-access';
import { canManageFinance, canViewFinance } from '../finance/finance-access';
import { assertDrawerBalance, ensureCollectionAccount, ensureFinanceAccounts, lockFinance } from '../finance/finance-ledger';
import { PrismaService } from '../prisma/prisma.service';
import { SERVER_EVENTS } from '../realtime/events';
import { EventsGateway } from '../realtime/events.gateway';
import { CLOSED_ORDER_STATUSES } from '../waiter-shifts/waiter-shifts.service';
import { recordWorkShiftChange } from '../waiter-shifts/work-shift-history';
import { warehouseDateRange } from '../warehouse/report-range';

class OpenCashShiftDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  amount!: number;
}

class CloseCashShiftDto extends OpenCashShiftDto {
  @IsUUID()
  shiftId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  expectedAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  closingComment?: string;

  @IsOptional()
  @IsBoolean()
  closeEmployeeShifts?: boolean;
}

class CashShiftsSettingDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  requireClosedOrders?: boolean;
}

class CashShiftHistoryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

class CashOperationDto {
  @IsIn(['income', 'expense', 'collection'])
  kind!: 'income' | 'expense' | 'collection';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  amount!: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;
}

class CreateCashOperationDto extends CashOperationDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,65}$/)
  requestKey!: string;
}

class CashCountDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  openingAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  actualAmount?: number;
}

const posKey = 'cash-pos:';
const openKey = 'cash-open:';
const closeKey = 'cash-close:';

export function cashShiftEnabled(tx: Prisma.TransactionClient, cafeId: string) {
  return tx.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true, cashShiftRequireClosedOrders: true } });
}

async function drawerDelta(tx: Prisma.TransactionClient, shift: CashShift) {
  const result = await tx.financeEntry.aggregate({
    where: { cafeId: shift.cafeId, accountId: shift.accountId, cashShiftId: shift.id,
      OR: [{ sourceKey: null }, { sourceKey: { notIn: [openKey + shift.id, closeKey + shift.id] } }] }, _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}

function serialize(shift: CashShift, expected = shift.expectedAmount ?? shift.openingAmount) {
  return {
    ...shift,
    openingAmount: shift.openingAmount.toNumber(),
    expectedAmount: expected.toNumber(),
    actualAmount: shift.actualAmount?.toNumber() ?? null,
    difference: shift.difference?.toNumber() ?? null,
  };
}

type Db = Prisma.TransactionClient;
type CashOperation = CashOperationDto;

async function closeStaffShifts(db: Db, cafeId: string, actorId: string, endedAt: Date) {
  const active = await db.waiterShift.findMany({
    where: { cafeId, status: WaiterShiftStatus.active, startedAt: { lte: endedAt }, waiter: { cafeId } },
  });
  if (!active.length) return [];
  const ids = active.map(({ id }) => id);
  const updated = await db.waiterShift.updateMany({
    where: {
      cafeId, id: { in: ids }, status: WaiterShiftStatus.active,
      waiter: { cafeId, orders: { none: { cafeId, status: { notIn: CLOSED_ORDER_STATUSES } } } },
    },
    data: { endedAt, status: WaiterShiftStatus.closed },
  });
  if (updated.count !== ids.length) {
    throw new ConflictException('Сначала закройте открытые заказы сотрудников или снимите галочку «Закрыть смены сотрудников».');
  }
  const [closed, actor] = await Promise.all([
    db.waiterShift.findMany({ where: { cafeId, id: { in: ids } } }),
    db.user.findFirstOrThrow({ where: { cafeId, id: actorId }, select: { id: true, name: true, role: true } }),
  ]);
  const previous = new Map(active.map((shift) => [shift.id, shift]));
  for (const shift of closed) await recordWorkShiftChange(db, previous.get(shift.id)!, shift, 'cash-close', actor);
  return closed;
}

async function findShift(db: Db, cafeId: string, id: string) {
  const shift = await db.cashShift.findFirst({ where: { cafeId, id } });
  if (!shift) throw new NotFoundException('Кассовая смена не найдена');
  return shift;
}

async function cashCategory(db: Db, cafeId: string, operation: CashOperation, atRegister: boolean) {
  if (!operation.categoryId) return null;
  if (operation.kind === 'collection') throw new BadRequestException('Категория нужна только для внесения или расхода');
  const category = await db.financeCategory.findFirst({ where: {
    cafeId, id: operation.categoryId, ...(atRegister ? { showOnPos: true } : {}), kind: { in: [operation.kind, 'both'] },
  }, select: { id: true } });
  if (!category) throw new BadRequestException('Выберите категорию, доступную для этой операции');
  return category.id;
}

async function saveAdjustment(db: Db, shift: CashShift, actorId: string, phase: 'open' | 'close', amount: Prisma.Decimal) {
  const { cafeId, accountId } = shift;
  const sourceKey = (phase === 'open' ? openKey : closeKey) + shift.id;
  if (amount.isZero()) {
    await db.financeEntry.deleteMany({ where: { cafeId, sourceKey } });
    return;
  }
  await db.financeEntry.upsert({
    where: { cafeId_sourceKey: { cafeId, sourceKey } }, update: { amount, actorId },
    create: { cafeId, accountId, actorId, amount, kind: 'adjustment', sourceKey,
      // Opening reconciliation sits outside the drawer formula because the counted cash is the baseline.
      cashShiftId: shift.id, pendingCashShift: !shift.closedAt, occurredAt: phase === 'open' ? shift.openedAt : shift.closedAt!,
      note: phase === 'open' ? 'Сверка наличных при открытии смены' : 'Сверка наличных при закрытии смены' },
  });
}

async function recalculateClosedShift(db: Db, shift: CashShift, actorId: string) {
  if (!shift.closedAt || shift.actualAmount == null) return;
  const expectedAmount = shift.openingAmount.add(await drawerDelta(db, shift));
  const difference = shift.actualAmount.sub(expectedAmount);
  await db.cashShift.update({ where: { id: shift.id }, data: { expectedAmount, difference } });
  await saveAdjustment(db, shift, actorId, 'close', difference);
}

function cashOperationDate(shift: CashShift, input: CashOperation, previous?: Date) {
  const at = input.occurredAt ? new Date(input.occurredAt) : previous ?? shift.closedAt ?? new Date();
  if (!Number.isFinite(at.getTime()) || at < shift.openedAt || at > (shift.closedAt ?? new Date())) {
    throw new BadRequestException('Укажите дату и время в пределах кассовой смены');
  }
  return at;
}

async function storeOperation(db: Db, shift: CashShift, actorId: string, input: CashOperation,
  categoryId: string | null, sourceKey: string, occurredAt: Date, previous?: { id: string; counterpartyAccountId: string | null }) {
  const { cafeId, id: cashShiftId, accountId } = shift;
  const transfer = input.kind === 'collection';
  const destination = transfer
    ? previous?.counterpartyAccountId ?? (await ensureCollectionAccount(db, cafeId)).id : null;
  const amount = new Prisma.Decimal(input.amount).mul(input.kind === 'income' ? 1 : -1);
  const data = { kind: transfer ? 'transfer' as const : input.kind as 'income' | 'expense',
    amount, categoryId, counterpartyAccountId: destination, occurredAt, note: input.note?.trim() || null };
  const pendingCashShift = !shift.closedAt;
  if (pendingCashShift) {
    const before = previous ? await db.financeEntry.findUnique({ where: { id: previous.id }, select: { amount: true } }) : null;
    await assertDrawerBalance(db, shift, amount.sub(before?.amount ?? 0));
  }
  const entry = previous
    ? await db.financeEntry.update({ where: { id: previous.id }, data })
    : await db.financeEntry.create({ data: { ...data, cafeId, cashShiftId, accountId, actorId, sourceKey, pendingCashShift } });
  if (destination) {
    const incoming = { ...data, accountId: destination, amount: amount.negated(), counterpartyAccountId: accountId };
    await db.financeEntry.upsert({
      where: { cafeId_sourceKey: { cafeId, sourceKey: sourceKey + ':in' } }, update: incoming,
      create: { ...incoming, cafeId, cashShiftId, actorId, sourceKey: sourceKey + ':in', pendingCashShift },
    });
  } else if (previous?.counterpartyAccountId) {
    await db.financeEntry.deleteMany({ where: { cafeId, sourceKey: sourceKey + ':in' } });
  }
  await recalculateClosedShift(db, shift, actorId);
  return entry;
}

@Injectable()
export class CashShiftsService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly events: EventsGateway) {}

  async list(cafeId: string, includeHistory: boolean, period: CashShiftHistoryDto = {}) {
    const openedAt = includeHistory ? warehouseDateRange(period.from, period.to) : undefined;
    return this.db.$transaction(async (tx) => {
      const settings = await cashShiftEnabled(tx, cafeId);
      const [current, history] = await Promise.all([
        tx.cashShift.findFirst({ where: { cafeId, closedAt: null } }),
        includeHistory ? tx.cashShift.findMany({
          where: { cafeId, closedAt: { not: null }, openedAt }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], take: 366,
        }) : [],
      ]);
      const shifts = [...(current ? [current] : []), ...history];
      const staff = await tx.user.findMany({ where: { cafeId, id: { in: [...new Set(shifts.flatMap((shift) =>
        [shift.openedById, ...(shift.closedById ? [shift.closedById] : [])]))] } }, select: { id: true, name: true } });
      const names = new Map(staff.map(({ id, name }) => [id, name]));
      const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));
      const reconciliations = await tx.financeEntry.findMany({
        where: { cafeId, OR: [{ cashShiftId: { in: [...shiftsById.keys()] }, kind: 'transfer' },
          { sourceKey: { in: shifts.map(({ id }) => openKey + id) } }] },
        select: { id: true, accountId: true, kind: true, cashShiftId: true, sourceKey: true, amount: true,
          counterparty: { select: { isCollection: true } } },
      });
      const reversed = new Set(reconciliations.flatMap(({ sourceKey }) => sourceKey?.startsWith('void:') ? [sourceKey.slice(5)] : []));
      const collected = new Map<string, Prisma.Decimal>();
      const openings = new Map<string, number>();
      for (const { id, accountId, cashShiftId, sourceKey, kind, amount, counterparty } of reconciliations) {
        if (sourceKey?.startsWith(openKey)) openings.set(sourceKey.slice(openKey.length), amount.toNumber());
        if (kind === 'transfer' && counterparty?.isCollection && cashShiftId && shiftsById.get(cashShiftId)?.accountId === accountId
          && amount.lt(0) && !sourceKey?.startsWith('void:') && !reversed.has(id)) {
          collected.set(cashShiftId, (collected.get(cashShiftId) ?? new Prisma.Decimal(0)).sub(amount));
        }
      }
      const [total, earlier] = includeHistory ? await Promise.all([
        tx.cashShift.count({ where: { cafeId } }),
        history.length ? tx.cashShift.count({ where: { cafeId, openedAt: { lt: history[history.length - 1].openedAt } } }) : 0,
      ]) : [0, 0];
      const named = (shift: ReturnType<typeof serialize>, number: number) => ({
        ...shift, openedByName: names.get(shift.openedById) ?? null,
        closedByName: shift.closedById ? names.get(shift.closedById) ?? null : null,
        collectionAmount: collected.get(shift.id)?.toNumber() ?? 0,
        openingDifference: openings.get(shift.id) ?? 0,
        number,
      });
      return {
        enabled: settings?.cashShiftsEnabled ?? false,
        requireClosedOrders: settings?.cashShiftRequireClosedOrders ?? false,
        current: current ? named(serialize(current, current.openingAmount.add(await drawerDelta(tx, current))), total) : null,
        history: history.map((shift, index) => named(serialize(shift), earlier + history.length - index)),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async movements(cafeId: string, id: string) {
    return (await this.details(cafeId, id)).movements;
  }

  async details(cafeId: string, id: string) {
    return this.db.$transaction(async (db) => {
      const shift = await findShift(db, cafeId, id);
      const [rows, deleted] = await Promise.all([
        db.financeEntry.findMany({
          where: { cafeId, OR: [
            { cashShiftId: id }, { sourceKey: openKey + id },
            { cashShiftId: null, account: { type: 'noncash' }, kind: { in: ['sale', 'refund'] },
              occurredAt: { gte: shift.openedAt, lte: shift.closedAt ?? new Date() } },
          ] },
          select: { id: true, accountId: true, actorId: true, occurredAt: true, kind: true, sourceKey: true,
            note: true, amount: true, category: { select: { id: true, name: true } },
            counterparty: { select: { isCollection: true } } },
        }),
        db.cashShiftDeletedOperation.findMany({
          where: { cafeId, cashShiftId: id },
          select: { id: true, kind: true, amount: true, category: true, note: true, actorName: true, occurredAt: true,
            deletedAt: true, deletedByName: true },
        }),
      ]);
      const reversed = new Set(rows.flatMap(({ sourceKey }) => sourceKey?.startsWith('void:') ? [sourceKey.slice(5)] : []));
      const names = new Map((await db.user.findMany({ where: { cafeId,
        id: { in: [...new Set(rows.flatMap(({ actorId }) => actorId ? [actorId] : []))] },
      }, select: { id: true, name: true } })).map(({ id, name }) => [id, name]));
      const active = rows.filter(({ id: entryId, accountId, kind, sourceKey }) =>
        !sourceKey?.startsWith('void:') && !reversed.has(entryId)
        && (accountId === shift.accountId || kind === 'sale' || kind === 'refund'))
        .map(({ category, counterparty, accountId, actorId, sourceKey, ...row }) => ({
          ...row, category: category?.name ?? null, categoryId: category?.id ?? null,
          actorName: actorId ? names.get(actorId) ?? null : null,
          cash: accountId === shift.accountId, editable: !!sourceKey?.startsWith(posKey),
          collection: row.kind === 'transfer' && row.amount.lt(0) && counterparty?.isCollection === true,
          reconciliation: sourceKey?.startsWith(openKey) ? 'open' : sourceKey?.startsWith(closeKey) ? 'close' : null,
        }));
      const journal = active.filter(({ reconciliation }) => !reconciliation);
      const sum = (include: (row: (typeof journal)[number]) => boolean, outflow = false) => journal.reduce(
        (total, row) => include(row) ? (outflow ? total.sub(row.amount) : total.add(row.amount)) : total,
        new Prisma.Decimal(0)).toNumber();
      const expected = shift.closedAt ? shift.expectedAmount ?? shift.openingAmount
        : shift.openingAmount.add(await drawerDelta(db, shift));
      const summary = {
        openingAmount: shift.openingAmount.toNumber(),
        cashSales: sum((row) => row.cash && row.kind === 'sale'),
        cashRefunds: sum((row) => row.cash && row.kind === 'refund', true),
        noncashSales: sum((row) => !row.cash && row.kind === 'sale'),
        noncashRefunds: sum((row) => !row.cash && row.kind === 'refund', true),
        deposits: sum((row) => row.cash && row.kind === 'income'),
        expenses: sum((row) => row.cash && (row.kind === 'expense' || row.kind === 'salary'), true),
        collections: sum((row) => row.collection, true),
        otherTransfers: sum((row) => row.cash && row.kind === 'transfer' && !row.collection),
        adjustments: sum((row) => row.cash && row.kind === 'adjustment'),
        expectedAmount: expected.toNumber(),
        actualAmount: shift.actualAmount?.toNumber() ?? null,
        difference: shift.difference?.toNumber() ?? null,
      };
      const movements = [...active.map((row) => ({ ...row, amount: row.amount.toNumber() })), ...deleted.map((row) => ({
        ...row, amount: row.amount.toNumber(), categoryId: null, cash: true, editable: false,
        collection: row.kind === 'transfer', reconciliation: null,
      }))].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
      return { summary, movements };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async operationCategories(cafeId: string, atRegister: boolean) {
    const categories = await this.db.financeCategory.findMany({
      where: { cafeId, ...(atRegister ? { showOnPos: true } : {}) }, orderBy: { name: 'asc' },
      select: { id: true, parentId: true, name: true, kind: true },
    });
    return categories;
  }

  async createOperation(cafeId: string, actor: AuthUser, id: string, input: CreateCashOperationDto) {
    return this.db.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const shift = await findShift(db, cafeId, id);
      const sourceKey = posKey + input.requestKey;
      const atRegister = actor.role === Role.WAITER;
      const existing = await db.financeEntry.findUnique({ where: { cafeId_sourceKey: { cafeId, sourceKey } } });
      if (existing) {
        const amount = new Prisma.Decimal(input.amount).mul(input.kind === 'income' ? 1 : -1);
        const kind = input.kind === 'collection' ? 'transfer' : input.kind;
        if (existing.cashShiftId !== id || existing.actorId !== actor.id || existing.kind !== kind
          || !existing.amount.eq(amount) || existing.categoryId !== (input.categoryId ?? null)
          || existing.note !== (input.note?.trim() || null)
          || (input.occurredAt && new Date(input.occurredAt).getTime() !== existing.occurredAt.getTime())) {
          throw new ConflictException('Этот запрос уже использован для другой операции');
        }
        return existing;
      }
      if (await db.cashShiftDeletedOperation.findUnique({ where: { cafeId_sourceKey: { cafeId, sourceKey } }, select: { id: true } })) {
        throw new ConflictException('Операция с таким запросом уже была удалена');
      }
      if (atRegister && (shift.closedAt || input.occurredAt)) throw new ConflictException('Операцию можно провести только в открытой смене');
      const categoryId = await cashCategory(db, cafeId, input, actor.role !== Role.OWNER && !canManageFinance(actor));
      return storeOperation(db, shift, actor.id, input, categoryId, sourceKey, cashOperationDate(shift, input));
    });
  }

  async updateOperation(cafeId: string, actor: AuthUser, id: string, entryId: string, input?: CashOperationDto) {
    const result = await this.db.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const shift = await findShift(db, cafeId, id);
      const original = await db.financeEntry.findFirst({ where: { cafeId, id: entryId, cashShiftId: id,
        accountId: shift.accountId, sourceKey: { startsWith: posKey } },
        include: { category: { select: { name: true } } } });
      if (!original?.sourceKey) {
        const deleted = await db.cashShiftDeletedOperation.findFirst({ where: { id: entryId, cafeId, cashShiftId: id },
          select: { id: true } });
        if (!deleted) throw new NotFoundException('Ручная операция смены не найдена');
        if (input) throw new ConflictException('Эту операцию уже удалили');
        return null;
      }
      if (input) {
        const categoryId = input.categoryId === original.categoryId && input.kind === original.kind
          ? original.categoryId : await cashCategory(db, cafeId, input, actor.role !== Role.OWNER && !canManageFinance(actor));
        const updated = await storeOperation(db, shift, actor.id, input, categoryId, original.sourceKey,
          cashOperationDate(shift, input, original.occurredAt), original);
        return { original, updated };
      }
      if (!shift.closedAt) await assertDrawerBalance(db, shift, original.amount.negated());
      const author = original.actorId ? await db.user.findFirst({ where: { id: original.actorId, cafeId }, select: { name: true } }) : null;
      await db.cashShiftDeletedOperation.create({ data: {
        id: original.id, cafeId, cashShiftId: shift.id, sourceKey: original.sourceKey, kind: original.kind, amount: original.amount,
        category: original.category?.name ?? 'Кассовые смены', note: original.note, actorName: author?.name ?? null,
        occurredAt: original.occurredAt, deletedById: actor.id, deletedByName: actor.name,
      } });
      await db.financeEntry.deleteMany({ where: { cafeId, sourceKey: { in: [original.sourceKey, original.sourceKey + ':in'] } } });
      await recalculateClosedShift(db, shift, actor.id);
      return { original, updated: null };
    });
    if (!result) return { id: entryId };
    const snapshot = ({ kind, amount, categoryId, occurredAt, note }: Pick<typeof result.original, 'kind' | 'amount' | 'categoryId' | 'occurredAt' | 'note'>) =>
      ({ kind, amount: amount.toNumber(), categoryId, occurredAt: occurredAt.toISOString(), note });
    await this.audit.log({ actor, actionType: AuditAction.FINANCE_TRANSACTION_UPDATED, entityType: AuditEntity.FINANCE_TRANSACTION,
      entityId: entryId, description: result.updated ? 'Изменена операция кассовой смены' : 'Удалена операция кассовой смены',
      oldValue: snapshot(result.original), newValue: result.updated ? snapshot(result.updated) : null });
    return { id: entryId };
  }

  async correctCashCount(cafeId: string, actor: AuthUser, id: string, input: CashCountDto) {
    const { before, updated } = await this.db.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const before = await findShift(db, cafeId, id);
      if (input.actualAmount != null && !before.closedAt) throw new ConflictException('Пересчитайте кассу при закрытии смены');
      const openingAmount = input.openingAmount == null ? before.openingAmount : new Prisma.Decimal(input.openingAmount);
      const actualAmount = input.actualAmount == null ? before.actualAmount : new Prisma.Decimal(input.actualAmount);
      const changedOpening = openingAmount.sub(before.openingAmount);
      if (!before.closedAt) await assertDrawerBalance(db, before, changedOpening);
      if (!changedOpening.isZero()) {
        const adjustment = await db.financeEntry.findUnique({ where: { cafeId_sourceKey: { cafeId, sourceKey: openKey + id } } });
        await saveAdjustment(db, before, actor.id, 'open', (adjustment?.amount ?? new Prisma.Decimal(0)).add(changedOpening));
      }
      const actualDelta = actualAmount?.sub(before.actualAmount ?? 0);
      if (actualDelta && !actualDelta.isZero()) {
        const next = await db.cashShift.findFirst({ where: { cafeId, accountId: before.accountId, openedAt: { gt: before.openedAt } },
          orderBy: { openedAt: 'asc' } });
        if (next) {
          const nextOpening = await db.financeEntry.findUnique({ where: { cafeId_sourceKey: { cafeId, sourceKey: openKey + next.id } } });
          await saveAdjustment(db, next, actor.id, 'open', (nextOpening?.amount ?? new Prisma.Decimal(0)).sub(actualDelta));
        }
      }
      const updated = await db.cashShift.update({ where: { id }, data: { openingAmount, actualAmount } });
      await recalculateClosedShift(db, updated, actor.id);
      return { before, updated };
    });
    await this.audit.log({ actor, actionType: AuditAction.FINANCE_TRANSACTION_UPDATED, entityType: AuditEntity.FINANCE_TRANSACTION,
      entityId: id, description: 'Уточнён остаток кассовой смены',
      oldValue: { opening: before.openingAmount.toNumber(), actual: before.actualAmount?.toNumber() ?? null },
      newValue: { opening: updated.openingAmount.toNumber(), actual: updated.actualAmount?.toNumber() ?? null } });
    return { id };
  }

  async setting(cafeId: string, enabled?: boolean, requireClosedOrders?: boolean) {
    if (enabled == null && requireClosedOrders == null) throw new BadRequestException('Укажите настройку кассовых смен');
    return this.db.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      if (enabled === false && await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } })) {
        throw new ConflictException('Сначала закройте кассовую смену');
      }
      const values = { cashShiftsEnabled: enabled ?? undefined, cashShiftRequireClosedOrders: requireClosedOrders ?? undefined };
      const setting = await tx.settings.upsert({
        where: { cafeId }, create: { cafeId, ...values }, update: values,
        select: { cashShiftsEnabled: true, cashShiftRequireClosedOrders: true },
      });
      return { enabled: setting.cashShiftsEnabled, requireClosedOrders: setting.cashShiftRequireClosedOrders };
    });
  }

  async open(cafeId: string, actorId: string, amount: number, workspace?: Workspace) {
    return this.db.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      const actor = await tx.user.findFirst({ where: { cafeId, id: actorId },
        select: { role: true, isActive: true, permissions: true, position: { select: { role: true, permissions: true, isStarter: true } } } });
      if (!actor?.isActive) {
        throw new ForbiddenException('Нет доступа к кассовым сменам');
      }
      const permissions = resolvePermissions(actor.role,
        actor.position?.role === actor.role ? actor.position.permissions : actor.permissions);
      const projected = projectWorkspaceUser({ id: actorId, cafeId, role: actor.role, permissions, name: '', phone: '' }, workspace);
      if (!canWriteCashShifts(projected)) {
        throw new ForbiddenException('Нет доступа к кассовым сменам');
      }
      if (!(await cashShiftEnabled(tx, cafeId))?.cashShiftsEnabled) throw new BadRequestException('Кассовые смены выключены');
      if (await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } })) {
        throw new ConflictException('Кассовая смена уже открыта');
      }
      const { cash } = await ensureFinanceAccounts(tx, cafeId);
      await ensureCollectionAccount(tx, cafeId);
      const movement = await tx.financeEntry.aggregate({ where: { cafeId, accountId: cash.id, pendingCashShift: false, cashCustodianId: null }, _sum: { amount: true } });
      const bookBalance = cash.openingBalance.add(movement._sum.amount ?? 0);
      const openingAmount = new Prisma.Decimal(amount);
      const shift = await tx.cashShift.create({ data: { cafeId, accountId: cash.id, openedById: actorId, openingAmount, openedAt: new Date() } });
      const difference = openingAmount.sub(bookBalance);
      await saveAdjustment(tx, shift, actorId, 'open', difference);
      return serialize(shift);
    });
  }

  async close(cafeId: string, actorId: string, input: CloseCashShiftDto) {
    const closingComment = input.closingComment?.trim() || null;
    const closeEmployeeShifts = input.closeEmployeeShifts ?? false;
    const { shift: result, closedShifts } = await this.db.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      const shift = await tx.cashShift.findFirst({ where: { cafeId, id: input.shiftId } });
      if (!shift) throw new ConflictException('Смена изменилась. Обновите список смен');
      const actualAmount = new Prisma.Decimal(input.amount);
      if (shift.closedAt) {
        if (shift.closedById === actorId && shift.actualAmount?.eq(actualAmount) && shift.expectedAmount?.eq(input.expectedAmount)
          && shift.closingComment === closingComment && shift.closeEmployeeShifts === closeEmployeeShifts) {
          return { shift: serialize(shift), closedShifts: [] };
        }
        throw new ConflictException('Кассовая смена уже закрыта');
      }
      const expectedAmount = shift.openingAmount.add(await drawerDelta(tx, shift));
      if (!expectedAmount.eq(input.expectedAmount)) {
        throw new ConflictException('Остаток изменился. Обновите данные и пересчитайте деньги в кассе');
      }
      const policy = await cashShiftEnabled(tx, cafeId);
      if (policy?.cashShiftRequireClosedOrders && await tx.order.findFirst({
        where: { cafeId, status: { notIn: CLOSED_ORDER_STATUSES } }, select: { id: true },
      })) {
        throw new ConflictException('Закройте открытые заказы перед закрытием кассовой смены');
      }
      const difference = actualAmount.sub(expectedAmount);
      const closedAt = new Date();
      const closedShifts = closeEmployeeShifts ? await closeStaffShifts(tx, cafeId, actorId, closedAt) : [];
      const updated = await tx.cashShift.update({ where: { id: shift.id },
        data: { closedAt, closedById: actorId, expectedAmount, actualAmount, difference, closingComment, closeEmployeeShifts } });
      await saveAdjustment(tx, updated, actorId, 'close', difference);
      await tx.financeEntry.updateMany({ where: { cafeId, cashShiftId: shift.id, pendingCashShift: true }, data: { pendingCashShift: false } });
      return { shift: serialize(updated), closedShifts };
    });
    for (const staffShift of closedShifts) {
      this.events.emitToWaiter(staffShift.waiterId, SERVER_EVENTS.WAITER_SHIFT_ENDED, staffShift);
      this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, staffShift);
    }
    return result;
  }
}

function canWriteCashShifts(user: AuthUser) {
  // The finance section governs the admin workspace. A terminal keeps its separate cashier permission.
  return canViewFinance(user) ? canManageFinance(user) : hasPermission(user.permissions, 'actions.financeCashShifts');
}

@Controller(['cash-shifts', 'admin/cash-shifts'])
@Roles(Role.OWNER, Role.ADMIN, Role.WAITER)
class CashShiftsController {
  constructor(private readonly shifts: CashShiftsService) {}

  private access(user: AuthUser, write = false) {
    const allowed = write ? canWriteCashShifts(user) : canViewFinance(user) || hasPermission(user.permissions, 'actions.financeCashShifts');
    if (!user.cafeId || !allowed) {
      throw new ForbiddenException('Нет доступа к кассовым сменам');
    }
    return user.cafeId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: CashShiftHistoryDto) {
    return this.shifts.list(this.access(user), user.role !== Role.WAITER, query);
  }

  @Get(':id/movements')
  @Roles(Role.OWNER, Role.ADMIN)
  movements(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shifts.movements(this.access(user), id);
  }

  @Get(':id/details')
  @Roles(Role.OWNER, Role.ADMIN)
  details(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shifts.details(this.access(user), id);
  }

  @Get('operation-categories')
  operationCategories(@CurrentUser() user: AuthUser) {
    return this.shifts.operationCategories(this.access(user), !canViewFinance(user));
  }

  @Post(':id/operations')
  createOperation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: CreateCashOperationDto) {
    return this.shifts.createOperation(this.access(user, true), user, id, input);
  }

  @Patch(':id/operations/:entryId')
  @Roles(Role.OWNER, Role.ADMIN)
  updateOperation(@CurrentUser() user: AuthUser, @Param('id') id: string,
    @Param('entryId') entryId: string, @Body() input: CashOperationDto) {
    return this.shifts.updateOperation(this.access(user, true), user, id, entryId, input);
  }

  @Delete(':id/operations/:entryId')
  @Roles(Role.OWNER, Role.ADMIN)
  deleteOperation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('entryId') entryId: string) {
    return this.shifts.updateOperation(this.access(user, true), user, id, entryId);
  }

  @Patch(':id/counts')
  @Roles(Role.OWNER, Role.ADMIN)
  correctCashCount(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: CashCountDto) {
    return this.shifts.correctCashCount(this.access(user, true), user, id, input);
  }

  @Patch('setting')
  @Roles(Role.OWNER)
  setting(@CurrentUser() user: AuthUser, @Body() body: CashShiftsSettingDto) {
    return this.shifts.setting(this.access(user, true), body.enabled, body.requireClosedOrders);
  }

  @Post('open')
  open(@CurrentUser() user: AuthUser, @Body() body: OpenCashShiftDto) {
    return this.shifts.open(this.access(user, true), user.id, body.amount, user.workspace);
  }

  @Post('close')
  close(@CurrentUser() user: AuthUser, @Body() body: CloseCashShiftDto) {
    const cafeId = this.access(user, true);
    if (body.closeEmployeeShifts && user.role !== Role.OWNER && !hasPermission(user.permissions, 'actions.closeShift')) {
      throw new ForbiddenException('Нет доступа к закрытию смен сотрудников');
    }
    return this.shifts.close(cafeId, user.id, body);
  }
}

@Module({ imports: [AuditModule], controllers: [CashShiftsController], providers: [CashShiftsService] })
export class CashShiftsModule {}
