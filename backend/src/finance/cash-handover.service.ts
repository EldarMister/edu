import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { warehouseDateRange, warehouseDay } from '../warehouse/report-range';
import { canManageFinance, financeTenant } from './finance-access';
import type { CashHandoverQueryDto, CashHandoverSaveDto } from './finance.dto';
import { assertDrawerBalance, ensureFinanceAccounts, lockFinance } from './finance-ledger';
import { cashCustodyDate, cashHandoverKey } from './cash-custody';

const zero = new Prisma.Decimal(0);

@Injectable()
export class CashHandoverService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async report(user: AuthUser, query: CashHandoverQueryDto) {
    const cafeId = financeTenant(user, false);
    const to = query.to ?? warehouseDay(new Date());
    const from = query.from ?? to.slice(0, 7) + '-01';
    const range = warehouseDateRange(from, to)!;
    const dates = { gte: cashCustodyDate(from), lte: cashCustodyDate(to) };

    return this.prisma.$transaction(async (db) => {
      const [settings, custody, receipts, postings] = await Promise.all([
        db.settings.findFirst({ where: { cafeId }, select: { cashHandoverEnabled: true } }),
        db.financeEntry.groupBy({
          by: ['cashCustodianId', 'cashCustodyDay'], _sum: { amount: true },
          where: { cafeId, cashCustodianId: { not: null }, cashCustodyDay: dates },
        }),
        db.shiftCashReport.findMany({
          where: { cafeId, date: dates, cashReceivedAt: { not: null } },
          select: { waiterId: true, date: true, cashHanded: true, cashReceivedAt: true },
        }),
        db.financeEntry.findMany({
          where: { cafeId, cashCustodianId: null, sourceKey: { startsWith: cashHandoverKey }, occurredAt: range },
          select: { occurredAt: true, amount: true },
        }),
      ]);
      const receiptByEmployeeDay = new Map(receipts.map((row) => [row.waiterId + ':' + row.date.toISOString(), row]));
      const employees = await db.user.findMany({
        where: { cafeId, id: { in: [...new Set(custody.map((row) => row.cashCustodianId!))] } },
        select: { id: true, name: true },
      });
      const names = new Map(employees.map(({ id, name }) => [id, name]));
      const rows = custody.map(({ cashCustodianId, cashCustodyDay, _sum }) => {
        const employeeId = cashCustodianId!;
        const date = cashCustodyDay!.toISOString();
        const id = employeeId + ':' + date;
        const received = receiptByEmployeeDay.get(id);
        const due = _sum.amount ?? zero;
        return {
          id, employeeId, employee: names.get(employeeId) ?? 'Сотрудник', date: date.slice(0, 10),
          due: due.toNumber(), received: received?.cashHanded.toNumber() ?? null,
          difference: (received?.cashHanded ?? zero).sub(due).toNumber(),
          receivedAt: received?.cashReceivedAt ?? null,
        };
      }).sort((a, b) => b.date.localeCompare(a.date) || a.employee.localeCompare(b.employee, 'ru'));

      const daily = new Map<string, Prisma.Decimal>();
      for (const { occurredAt, amount } of postings) {
        const date = warehouseDay(occurredAt);
        daily.set(date, (daily.get(date) ?? zero).add(amount));
      }

      return {
        enabled: settings?.cashHandoverEnabled ?? false,
        canReceive: canManageFinance(user),
        canConfigure: user.role === Role.OWNER,
        rows,
        daily: [...daily].sort(([a], [b]) => b.localeCompare(a)).map(([date, amount]) => ({ date, amount: amount.toNumber() })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async setEnabled(user: AuthUser, enabled: boolean) {
    const cafeId = financeTenant(user);
    if (user.role !== Role.OWNER) throw new ForbiddenException('Режим сдачи наличных меняет владелец');
    await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      await db.settings.upsert({
        where: { cafeId }, create: { cafeId, cashHandoverEnabled: enabled }, update: { cashHandoverEnabled: enabled },
      });
    });
    return { enabled };
  }

  async receive(user: AuthUser, input: CashHandoverSaveDto) {
    const cafeId = financeTenant(user);
    warehouseDateRange(input.date, input.date);
    if (input.date > warehouseDay(new Date())) throw new BadRequestException('Укажите текущую или прошедшую дату');
    const date = cashCustodyDate(input.date);
    const amount = new Prisma.Decimal(input.amount);
    const key = { waiterId: input.employeeId, date };

    const result = await this.prisma.$transaction(async (db) => {
      await lockFinance(db, cafeId);
      const [employee, sale, previous] = await Promise.all([
        db.user.findFirst({ where: { cafeId, id: input.employeeId }, select: { name: true } }),
        db.financeEntry.findFirst({
          where: { cafeId, cashCustodianId: input.employeeId, cashCustodyDay: date, kind: 'sale' }, select: { id: true },
        }),
        db.shiftCashReport.findUnique({ where: { waiterId_date: key, cafeId } }),
      ]);
      if (!employee || !sale) throw new NotFoundException('За этот день у сотрудника нет наличных к сдаче');
      const previousReceived = previous?.cashReceivedAt ? previous.cashHanded : null;
      if (previousReceived?.eq(amount)) return { changed: false, amount: amount.toNumber() };
      if ((previous?.cashReceivedAt?.getTime() ?? null) !== (input.expectedReceivedAt ? Date.parse(input.expectedReceivedAt) : null)) {
        throw new ConflictException('Сумма сдачи изменилась. Обновите отчёт и повторите');
      }

      const currentTime = new Date();
      const receivedAt = new Date(Math.max(+currentTime, (previous?.cashReceivedAt?.getTime() ?? 0) + 1));
      const delta = amount.sub(previousReceived ?? zero);
      if (!delta.isZero()) {
        const [settings, shift] = await Promise.all([
          db.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true } }),
          db.cashShift.findFirst({ where: { cafeId, closedAt: null } }),
        ]);
        if (settings?.cashShiftsEnabled && !shift) throw new ConflictException('Откройте кассовую смену перед приёмом наличных');
        if (shift) await assertDrawerBalance(db, shift, delta);
        const accountId = shift?.accountId ?? (await ensureFinanceAccounts(db, cafeId)).cash.id;
        await db.financeEntry.create({ data: {
          cafeId, accountId, actorId: user.id, cashShiftId: shift?.id,
          amount: delta, kind: previousReceived === null ? 'income' : 'adjustment',
          occurredAt: shift && currentTime < shift.openedAt ? shift.openedAt : currentTime,
          sourceKey: cashHandoverKey + randomUUID(),
          note: `${previousReceived === null ? 'Сдача наличных' : 'Уточнение сдачи наличных'} · ${employee.name} · ${input.date}`,
        } });
      }
      const values = { cashHanded: amount, cashReceivedAt: receivedAt, updatedById: user.id };
      await db.shiftCashReport.upsert({
        where: { waiterId_date: key, cafeId }, create: { cafeId, ...key, ...values }, update: values,
      });
      return { changed: true, amount: amount.toNumber(), employeeName: employee.name, previous: previousReceived?.toNumber() ?? null };
    });
    if (result.changed) {
      await this.audit.log({
        actor: user, actionType: AuditAction.STAFF_UPDATED, entityType: AuditEntity.STAFF, entityId: input.employeeId,
        description: `Сдача наличных · ${result.employeeName} · ${input.date}`,
        metadata: { date: input.date, cashHanded: result.amount, previous: result.previous },
      });
    }
    return { amount: result.amount };
  }
}
