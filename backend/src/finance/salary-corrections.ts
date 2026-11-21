import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { SalaryAccrualEditDto, SalaryCorrectionDto } from './finance.dto';
import { canReverseEntry } from './entry-reversal';

type Db = Prisma.TransactionClient;
type Change = {
  requestKey: string; revision: number; type: 'edit' | 'cancel'; at: string;
  actorId: string; actorName: string; reason: string;
  before: { amount: number; note: string | null };
  after: { amount: number; note: string | null };
};
const zero = new Prisma.Decimal(0);
const clean = (value?: string | null) => value?.trim() || null;
const changes = (value: Prisma.JsonValue): Change[] => Array.isArray(value) ? value as unknown as Change[] : [];

export async function salaryAccrualDetails(db: Db, cafeId: string, id: string) {
  const accrual = await db.salaryAccrual.findFirst({ where: { cafeId, id }, include: {
    payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { account: { select: { name: true, archivedAt: true } } } },
  } });
  if (!accrual) throw new NotFoundException('Начисление не найдено');
  const { payments, ...record } = accrual;
  const accounts = [...new Set(payments.map(({ accountId }) => accountId))];
  const [shifts, actors] = await Promise.all([
    accounts.length ? db.cashShift.findMany({
      where: { cafeId, accountId: { in: accounts } }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      distinct: ['accountId'], select: { id: true, accountId: true, openedAt: true, closedAt: true },
    }) : [],
    db.user.findMany({ where: { cafeId, id: { in: [...new Set([record.actorId, ...payments.flatMap(({ actorId }) => actorId ? [actorId] : [])])] } },
      select: { id: true, name: true } }),
  ]);
  const byAccount = new Map(shifts.map((shift) => [shift.accountId, shift]));
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  const reversed = new Map(payments.filter(({ sourceKey }) => sourceKey?.startsWith('void:'))
    .map((payment) => [payment.sourceKey!.slice(5), payment]));
  const paid = payments.reduce((sum, payment) => sum.sub(payment.amount), zero);
  return {
    ...record, amount: Number(record.amount), paidAmount: Number(paid), history: changes(record.history),
    createdByName: actorNames.get(record.actorId) ?? '—',
    payments: payments.map((payment) => {
      const reversedBy = reversed.get(payment.id);
      const original = payment.kind === 'salary' && payment.amount.isNegative();
      const reversible = original && !reversedBy && !payment.account.archivedAt && canReverseEntry(payment, byAccount.get(payment.accountId));
      return {
        id: payment.id, amount: Number(payment.amount), occurredAt: payment.occurredAt, createdAt: payment.createdAt,
        accountName: payment.account.name, actorName: payment.actorId ? actorNames.get(payment.actorId) ?? '—' : '—',
        note: payment.note, reversedAt: reversedBy?.createdAt ?? null,
        reversalOf: payment.sourceKey?.startsWith('void:') ? payment.sourceKey.slice(5) : null,
        reversible,
        reverseBlockedReason: original && !reversedBy && !reversible ? 'Выплата учтена в закрытой кассовой смене или счёт недоступен' : null,
      };
    }),
  };
}

export async function editSalaryAccrual(
  db: Db, cafeId: string, actor: AuthUser, id: string, input: SalaryAccrualEditDto | SalaryCorrectionDto, cancel: boolean,
) {
  const reason = clean(input.reason);
  if (!reason) throw new BadRequestException('Укажите причину исправления');
  const before = await db.salaryAccrual.findFirst({ where: { cafeId, id } });
  if (!before) throw new NotFoundException('Начисление не найдено');
  const history = changes(before.history);
  const type = cancel ? 'cancel' : 'edit';
  const amount = cancel ? before.amount : new Prisma.Decimal((input as SalaryAccrualEditDto).amount);
  const note = cancel ? before.note : clean((input as SalaryAccrualEditDto).note);
  const replay = history.find((entry) => entry.requestKey === input.requestKey);
  if (replay) {
    if (replay.type !== type || replay.reason !== reason || (!cancel &&
      (replay.after.amount !== amount.toNumber() || replay.after.note !== note))) {
      throw new ConflictException('Этот запрос уже использован для другого исправления');
    }
    return { id, revision: before.revision, voidedAt: before.voidedAt };
  }
  if (before.voidedAt) throw new ConflictException('Начисление уже отменено');
  if (before.revision !== input.revision) throw new ConflictException('Начисление изменилось. Обновите карточку и повторите исправление');
  const payments = await db.financeEntry.aggregate({ where: { cafeId, salaryAccrualId: id }, _sum: { amount: true } });
  const paid = (payments._sum.amount ?? zero).negated();
  if (cancel && !paid.isZero()) throw new ConflictException('Сначала отмените ошибочные выплаты. Начисление с фактической выплатой отменить нельзя');
  if (!cancel && (amount.lte(0) || amount.lt(paid))) throw new BadRequestException('Начисление должно быть положительным и не меньше уже выплаченной суммы');
  const at = new Date();
  const revision = before.revision + 1;
  const change: Change = {
    requestKey: input.requestKey, revision, type, at: at.toISOString(), actorId: actor.id,
    actorName: actor.name ?? 'Владелец', reason,
    before: { amount: before.amount.toNumber(), note: before.note }, after: { amount: amount.toNumber(), note },
  };
  await db.salaryAccrual.update({ where: { cafeId, id }, data: {
    amount, note, revision, history: [...history, change] as unknown as Prisma.InputJsonValue,
    ...(cancel ? { voidedAt: at, voidReason: reason } : {}),
  } });
  return { id, revision, voidedAt: cancel ? at : null, change };
}

export async function reverseSalaryPayment(db: Db, cafeId: string, actor: AuthUser, accrualId: string, paymentId: string, inputReason: string) {
  const reason = clean(inputReason);
  if (!reason) throw new BadRequestException('Укажите причину отмены выплаты');
  const payment = await db.financeEntry.findFirst({ where: { cafeId, id: paymentId, salaryAccrualId: accrualId },
    include: { account: { select: { archivedAt: true } } } });
  if (!payment || payment.kind !== 'salary' || !payment.amount.isNegative()) throw new NotFoundException('Выплата не найдена');
  const sourceKey = 'void:' + payment.id;
  const previous = await db.financeEntry.findFirst({ where: { cafeId, sourceKey } });
  if (previous) {
    if (previous.note !== reason) throw new ConflictException('Выплата уже отменена');
    return { id: previous.id, reversedAt: previous.createdAt };
  }
  const latest = await db.cashShift.findFirst({ where: { cafeId, accountId: payment.accountId },
    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }] });
  if (payment.account.archivedAt || !canReverseEntry(payment, latest ?? undefined)) {
    throw new ConflictException('Выплата уже учтена в сверке кассы. Историческую выплату отменить нельзя');
  }
  const reversal = await db.financeEntry.create({ data: {
    cafeId, accountId: payment.accountId, salaryAccrualId: accrualId, actorId: actor.id,
    kind: 'adjustment', sourceKey, amount: payment.amount.negated(), note: reason,
    cashShiftId: payment.cashShiftId, pendingCashShift: payment.pendingCashShift, occurredAt: payment.occurredAt,
  } });
  return { id: reversal.id, reversedAt: reversal.createdAt, created: true };
}
