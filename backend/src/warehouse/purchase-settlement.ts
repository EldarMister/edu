import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditAction } from '../audit/audit.constants';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { canReverseEntry } from '../finance/entry-reversal';
import { financeTenant } from '../finance/finance-access';
import { ensureFinanceAccounts, findAccount, lockFinance, shiftForEntry } from '../finance/finance-ledger';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { assertWarehousePermission } from './warehouse-permissions';
import type { PurchasePaymentsDto, ReconcilePurchaseDto } from './purchase-settlement.dto';

type Db = Prisma.TransactionClient;
type SettlementPurchase = { id: string; status: PurchaseStatus; totalAmount: Prisma.Decimal; settlementKnownAt: Date | null; settlementOpeningPaid: Prisma.Decimal | null };
export type PurchasePaymentStatus = 'untracked' | 'unpaid' | 'partly_paid' | 'paid' | 'overpaid';
const zero = new Prisma.Decimal(0);
const paymentKey = 'purchase-pay:';
const reversalKey = 'void:';
const reconcileAction = AuditAction.PURCHASE_SETTLEMENT_RECONCILED;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function purchaseSettlement(purchase: SettlementPurchase, entries = zero) {
  if (purchase.status !== 'completed') return { paymentStatus: null, paidAmount: null, debtAmount: null, creditAmount: null };
  if (!purchase.settlementKnownAt) return { paymentStatus: 'untracked' as const, paidAmount: null, debtAmount: null, creditAmount: null };
  const paid = (purchase.settlementOpeningPaid ?? zero).sub(entries);
  const balance = purchase.totalAmount.sub(paid);
  const paymentStatus: PurchasePaymentStatus = balance.lt(0) ? 'overpaid' : balance.isZero() ? 'paid' : paid.isZero() ? 'unpaid' : 'partly_paid';
  return { paymentStatus, paidAmount: Number(paid), debtAmount: Number(Prisma.Decimal.max(balance, 0)),
    creditAmount: Number(Prisma.Decimal.max(balance.negated(), 0)) };
}

export async function purchaseSettlementTotals(db: Db, purchases: readonly SettlementPurchase[]) {
  const ids = purchases.filter((purchase) => purchase.status === 'completed' && purchase.settlementKnownAt).map(({ id }) => id);
  if (!ids.length) return new Map<string, Prisma.Decimal>();
  const groups = await db.financeEntry.groupBy({ by: ['purchaseId'], where: { purchaseId: { in: ids } }, _sum: { amount: true } });
  return new Map(groups.flatMap(({ purchaseId, _sum }) => purchaseId && _sum.amount ? [[purchaseId, _sum.amount] as const] : []));
}

export async function purchaseFundingAccounts(db: Db, purchases: readonly SettlementPurchase[]) {
  const ids = purchases.filter((purchase) => purchase.status === 'completed' && purchase.settlementKnownAt).map(({ id }) => id);
  const accounts = new Map<string, Set<string>>();
  if (!ids.length) return accounts;
  const entries = await db.financeEntry.findMany({ where: { purchaseId: { in: ids } },
    select: { id: true, purchaseId: true, sourceKey: true, account: { select: { name: true } } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
  const reversed = new Set(entries.flatMap(({ sourceKey }) => sourceKey?.startsWith(reversalKey) ? [sourceKey.slice(reversalKey.length)] : []));
  for (const entry of entries) {
    if (!entry.purchaseId || !entry.sourceKey?.startsWith(paymentKey) || reversed.has(entry.id)) continue;
    const names = accounts.get(entry.purchaseId) ?? new Set<string>();
    names.add(entry.account.name);
    accounts.set(entry.purchaseId, names);
  }
  return accounts;
}

export async function lockPurchaseRow(db: Db, id: string, cafeId = getCafeId()) {
  const tenant = cafeId ? Prisma.sql` AND cafe_id = ${cafeId}` : Prisma.empty;
  await db.$queryRaw`SELECT id FROM purchases WHERE id = ${id}${tenant} FOR UPDATE`;
}

async function recordAudit(db: Db, cafeId: string, actor: AuthUser, purchaseId: string, actionType: string,
  description: string, metadata: Prisma.InputJsonValue) {
  await db.auditLog.create({ data: { cafeId, actionType, entityType: 'PURCHASE', entityId: purchaseId,
    userId: actor.id, userName: actor.name, userRole: actor.role, description, metadata } });
}

function amountOf(value: number, allowZero = false) {
  const amount = new Prisma.Decimal(value);
  if (!amount.isFinite() || amount.lt(allowZero ? 0 : 0.01) || amount.gt(9999999999.99) || amount.decimalPlaces() > 2) {
    throw new BadRequestException(allowZero ? 'Укажите корректную сумму сверки' : 'Укажите сумму платежа больше нуля');
  }
  return amount;
}

async function completedPurchase(db: Db, cafeId: string, id: string) {
  await lockPurchaseRow(db, id, cafeId);
  const purchase = await db.purchase.findUnique({ where: { cafeId_id: { cafeId, id } } });
  if (!purchase) throw new NotFoundException('Поставка не найдена');
  if (purchase.status !== 'completed') throw new ConflictException('Расчёты доступны только для проведённой поставки');
  return purchase;
}

export async function purchaseSettlementHistory(db: Db, purchase: SettlementPurchase) {
  if (purchase.status !== 'completed') return undefined;
  const [entries, reconciliation] = await Promise.all([
    db.financeEntry.findMany({ where: { purchaseId: purchase.id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      include: { account: { select: { name: true, archivedAt: true } } } }),
    purchase.settlementOpeningPaid == null ? null : db.auditLog.findFirst({
      where: { actionType: reconcileAction, entityType: 'PURCHASE', entityId: purchase.id },
      select: { userName: true, description: true, createdAt: true },
    }),
  ]);
  const reversals = new Map(entries.flatMap((entry) => entry.sourceKey?.startsWith(reversalKey)
    ? [[entry.sourceKey.slice(reversalKey.length), entry] as const] : []));
  const accountIds = [...new Set(entries.filter(({ sourceKey }) => sourceKey?.startsWith(paymentKey)).map(({ accountId }) => accountId))];
  const actorIds = [...new Set(entries.flatMap(({ actorId }) => actorId ? [actorId] : []))];
  const [latest, actors] = await Promise.all([
    db.cashShift.findMany({ where: { accountId: { in: accountIds } }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      distinct: ['accountId'], select: { id: true, accountId: true, openedAt: true, closedAt: true } }),
    db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }),
  ]);
  const shifts = new Map(latest.map((shift) => [shift.accountId, shift]));
  const actorNames = new Map(actors.map(({ id, name }) => [id, name]));
  return {
    payments: entries.filter(({ sourceKey }) => sourceKey?.startsWith(paymentKey)).map((entry) => {
      const reverse = reversals.get(entry.id);
      return { id: entry.id, occurredAt: entry.occurredAt, accountName: entry.account.name, amount: Number(entry.amount.negated()),
        actorName: entry.actorId ? actorNames.get(entry.actorId) ?? null : null, note: entry.note,
        reversedAt: reverse?.createdAt ?? null, reversalReason: reverse?.note ?? null,
        reversible: !reverse && !entry.account.archivedAt && canReverseEntry(entry, shifts.get(entry.accountId)) };
    }),
    reconciliation: reconciliation ? { ...reconciliation, paidAmount: Number(purchase.settlementOpeningPaid) } : null,
  };
}

@Injectable()
export class PurchaseSettlementService {
  constructor(private readonly db: PrismaService) {}

  private writeTenant(actor: AuthUser) {
    const cafeId = financeTenant(actor);
    assertWarehousePermission(actor, 'warehouseReceive');
    assertWarehousePermission(actor, 'warehouseCosts');
    if (actor.permissions?.readOnlySections?.includes('warehouse') && actor.role !== 'OWNER') throw new ForbiddenException();
    return cafeId;
  }

  async accounts(actor: AuthUser) {
    const cafeId = this.writeTenant(actor);
    return this.db.$transaction(async (db) => {
      await ensureFinanceAccounts(db, cafeId);
      return db.financeAccount.findMany({ where: { cafeId, archivedAt: null },
        select: { id: true, name: true, type: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    });
  }

  async pay(actor: AuthUser, id: string, input: PurchasePaymentsDto) {
    const cafeId = this.writeTenant(actor);
    if (!input.payments.length) throw new BadRequestException('Добавьте хотя бы один платёж');
    const now = new Date();
    const prefix = `${paymentKey}${hash(input.requestKey)}:`;
    const lines = input.payments.map((row, index) => {
      const occurredAt = row.occurredAt ? new Date(row.occurredAt) : undefined;
      if (occurredAt && (!Number.isFinite(occurredAt.getTime()) || occurredAt > now)) throw new BadRequestException('Укажите дату оплаты не позже текущего времени');
      const amount = amountOf(row.amount).negated();
      const note = row.note?.trim() || null;
      const fingerprint = hash(JSON.stringify([row.accountId, amount.toString(), note, occurredAt?.toISOString() ?? null]));
      return { sourceKey: `${prefix}${index}:${fingerprint}`, accountId: row.accountId, amount, note, occurredAt };
    });
    return this.db.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const purchase = await completedPurchase(db, cafeId, id);
      const previous = await db.financeEntry.findMany({ where: { cafeId, sourceKey: { startsWith: prefix } } });
      if (previous.length) {
        const byKey = new Map(previous.map((entry) => [entry.sourceKey, entry]));
        if (previous.length !== lines.length || !lines.every((line) => {
          const saved = byKey.get(line.sourceKey);
          return saved?.purchaseId === id && saved.actorId === actor.id;
        })) throw new ConflictException('Этот запрос уже использован для другого платежа');
        return { paymentIds: lines.map(({ sourceKey }) => byKey.get(sourceKey)!.id) };
      }
      if (!purchase.settlementKnownAt) throw new ConflictException('Сначала сверите оплату исторической поставки');
      const ledger = await db.financeEntry.aggregate({ where: { cafeId, purchaseId: id }, _sum: { amount: true } });
      const payable = purchase.totalAmount.sub(purchase.settlementOpeningPaid ?? zero).add(ledger._sum.amount ?? zero);
      const amount = lines.reduce((sum, line) => sum.sub(line.amount), zero);
      if (amount.gt(payable)) throw new BadRequestException('Оплата превышает задолженность по поставке');
      const category = await db.financeCategory.upsert({ where: { cafeId_kind_name: { cafeId, kind: 'expense', name: 'Поставки' } },
        create: { cafeId, kind: 'expense', name: 'Поставки' }, update: {} });
      const settings = await db.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true } });
      const paymentIds: string[] = [];
      for (const line of lines) {
        const account = await findAccount(db, cafeId, line.accountId);
        const occurredAt = line.occurredAt ?? new Date();
        const cashShiftId = await shiftForEntry(db, cafeId, account.id, occurredAt, line.amount);
        if (account.type === 'cash' && account.isDefault && settings?.cashShiftsEnabled && !cashShiftId) {
          throw new ConflictException('Откройте кассовую смену перед оплатой из кассы');
        }
        const entry = await db.financeEntry.create({ data: { ...line, occurredAt, cafeId, purchaseId: id, actorId: actor.id,
          categoryId: category.id, kind: 'expense', cashShiftId, pendingCashShift: !!cashShiftId } });
        paymentIds.push(entry.id);
      }
      await recordAudit(db, cafeId, actor, id, 'PURCHASE_PAYMENT_POSTED', 'Оплата поставки', { paymentIds, amount: amount.toString() });
      return { paymentIds };
    });
  }

  async reconcile(actor: AuthUser, id: string, input: ReconcilePurchaseDto) {
    const cafeId = this.writeTenant(actor);
    const amount = amountOf(input.paidAmount, true);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Укажите основание сверки');
    return this.db.$transaction(async (db) => {
      const purchase = await completedPurchase(db, cafeId, id);
      if (purchase.settlementKnownAt) {
        const evidence = await db.auditLog.findFirst({ where: { cafeId, actionType: reconcileAction, entityType: 'PURCHASE', entityId: id },
          select: { description: true, userId: true } });
        if (evidence?.description === reason && evidence.userId === actor.id && purchase.settlementOpeningPaid?.eq(amount)) {
          return { reconciledAt: purchase.settlementKnownAt };
        }
        throw new ConflictException('Оплата поставки уже сверена');
      }
      if (amount.gt(purchase.totalAmount)) throw new BadRequestException('Подтверждённая оплата превышает сумму поставки');
      const reconciledAt = new Date();
      await db.purchase.update({ where: { cafeId_id: { cafeId, id } }, data: { settlementKnownAt: reconciledAt, settlementOpeningPaid: amount } });
      await recordAudit(db, cafeId, actor, id, reconcileAction, reason, { paidAmount: amount.toString() });
      return { reconciledAt };
    });
  }

  async reverse(actor: AuthUser, id: string, paymentId: string, inputReason: string) {
    const cafeId = this.writeTenant(actor);
    const reason = inputReason.trim();
    if (!reason) throw new BadRequestException('Укажите причину отмены платежа');
    return this.db.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      await completedPurchase(db, cafeId, id);
      const payment = await db.financeEntry.findFirst({ where: { cafeId, id: paymentId, purchaseId: id, sourceKey: { startsWith: paymentKey } },
        include: { account: { select: { archivedAt: true } } } });
      if (!payment) throw new NotFoundException('Платёж поставки не найден');
      const sourceKey = reversalKey + payment.id;
      const previous = await db.financeEntry.findUnique({ where: { cafeId_sourceKey: { cafeId, sourceKey } } });
      if (previous) {
        if (previous.note !== reason || previous.actorId !== actor.id) throw new ConflictException('Платёж уже отменён');
        return { id: previous.id, reversedAt: previous.createdAt };
      }
      const shift = await db.cashShift.findFirst({ where: { cafeId, accountId: payment.accountId }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }] });
      if (payment.account.archivedAt || !canReverseEntry(payment, shift ?? undefined)) {
        throw new ConflictException('Платёж учтён в закрытой кассовой смене или счёт архивирован');
      }
      const reversal = await db.financeEntry.create({ data: { cafeId, purchaseId: id, accountId: payment.accountId,
        actorId: actor.id, categoryId: payment.categoryId, cashShiftId: payment.cashShiftId, pendingCashShift: payment.pendingCashShift,
        sourceKey, kind: 'adjustment', amount: payment.amount.negated(), occurredAt: payment.occurredAt, note: reason } });
      await recordAudit(db, cafeId, actor, id, 'PURCHASE_PAYMENT_REVERSED', reason, { paymentId, reversalId: reversal.id });
      return { id: reversal.id, reversedAt: reversal.createdAt };
    });
  }
}
