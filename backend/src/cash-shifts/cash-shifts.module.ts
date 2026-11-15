import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, Patch, Post } from '@nestjs/common';
import { CashShift, Prisma, Role } from '@prisma/client';
import { IsBoolean, IsNumber, IsUUID, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { hasPermission } from '../common/permissions';
import { ensureFinanceAccounts, lockFinance } from '../finance/finance-ledger';
import { PrismaService } from '../prisma/prisma.service';

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
}

class CashShiftsSettingDto {
  @IsBoolean()
  enabled!: boolean;
}

export function cashShiftEnabled(tx: Prisma.TransactionClient, cafeId: string) {
  return tx.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true } });
}

async function drawerDelta(tx: Prisma.TransactionClient, shift: CashShift) {
  const result = await tx.financeEntry.aggregate({
    where: { cafeId: shift.cafeId, accountId: shift.accountId, cashShiftId: shift.id }, _sum: { amount: true },
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

@Injectable()
export class CashShiftsService {
  constructor(private readonly db: PrismaService) {}

  async list(cafeId: string, includeHistory: boolean) {
    return this.db.$transaction(async (tx) => {
      const settings = await cashShiftEnabled(tx, cafeId);
      const shifts = await tx.cashShift.findMany({
        where: { cafeId, ...(includeHistory ? {} : { closedAt: null }) }, orderBy: { openedAt: 'desc' }, take: 100,
      });
      const current = shifts.find(({ closedAt }) => !closedAt);
      const staff = await tx.user.findMany({ where: { cafeId, id: { in: [...new Set(shifts.flatMap((shift) =>
        [shift.openedById, ...(shift.closedById ? [shift.closedById] : [])]))] } }, select: { id: true, name: true } });
      const names = new Map(staff.map(({ id, name }) => [id, name]));
      const named = (shift: ReturnType<typeof serialize>) => ({
        ...shift, openedByName: names.get(shift.openedById) ?? null,
        closedByName: shift.closedById ? names.get(shift.closedById) ?? null : null,
      });
      return {
        enabled: settings?.cashShiftsEnabled ?? false,
        current: current ? named(serialize(current, current.openingAmount.add(await drawerDelta(tx, current)))) : null,
        history: shifts.filter(({ closedAt }) => closedAt).map((shift) => named(serialize(shift))),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async setting(cafeId: string, enabled: boolean) {
    return this.db.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      if (!enabled && await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } })) {
        throw new ConflictException('Сначала закройте кассовую смену');
      }
      await tx.settings.upsert({
        where: { cafeId }, create: { cafeId, cashShiftsEnabled: enabled }, update: { cashShiftsEnabled: enabled },
      });
      return { enabled };
    });
  }

  async open(cafeId: string, actorId: string, amount: number) {
    return this.db.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      if (!(await cashShiftEnabled(tx, cafeId))?.cashShiftsEnabled) throw new BadRequestException('Кассовые смены выключены');
      if (await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } })) {
        throw new ConflictException('Кассовая смена уже открыта');
      }
      const { cash } = await ensureFinanceAccounts(tx, cafeId);
      const movement = await tx.financeEntry.aggregate({ where: { cafeId, accountId: cash.id }, _sum: { amount: true } });
      const bookBalance = cash.openingBalance.add(movement._sum.amount ?? 0);
      const openingAmount = new Prisma.Decimal(amount);
      const shift = await tx.cashShift.create({ data: { cafeId, accountId: cash.id, openedById: actorId, openingAmount } });
      const difference = openingAmount.sub(bookBalance);
      if (!difference.isZero()) {
        await tx.financeEntry.create({ data: {
          cafeId, accountId: cash.id, actorId, amount: difference, kind: 'adjustment',
          sourceKey: 'cash-open:' + shift.id, note: 'Сверка наличных при открытии смены', occurredAt: shift.openedAt,
        } });
      }
      return serialize(shift);
    });
  }

  async close(cafeId: string, actorId: string, input: CloseCashShiftDto) {
    return this.db.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      const shift = await tx.cashShift.findFirst({ where: { cafeId, id: input.shiftId } });
      if (!shift) throw new ConflictException('Смена изменилась. Обновите список смен');
      const actualAmount = new Prisma.Decimal(input.amount);
      if (shift.closedAt) {
        if (shift.closedById === actorId && shift.actualAmount?.eq(actualAmount) && shift.expectedAmount?.eq(input.expectedAmount)) return serialize(shift);
        throw new ConflictException('Кассовая смена уже закрыта');
      }
      const expectedAmount = shift.openingAmount.add(await drawerDelta(tx, shift));
      if (!expectedAmount.eq(input.expectedAmount)) {
        throw new ConflictException('Остаток изменился. Обновите данные и пересчитайте деньги в кассе');
      }
      const difference = actualAmount.sub(expectedAmount);
      const closedAt = new Date();
      if (!difference.isZero()) {
        // Snapshot the expected amount before adding the reconciliation entry.
        await tx.financeEntry.create({ data: {
          cafeId, accountId: shift.accountId, cashShiftId: shift.id, actorId, amount: difference, kind: 'adjustment',
          sourceKey: 'cash-close:' + shift.id, note: 'Сверка наличных при закрытии смены', occurredAt: closedAt,
        } });
      }
      return serialize(await tx.cashShift.update({ where: { id: shift.id },
        data: { closedAt, closedById: actorId, expectedAmount, actualAmount, difference } }));
    });
  }
}

@Controller(['cash-shifts', 'admin/cash-shifts'])
@Roles(Role.OWNER, Role.ADMIN, Role.WAITER)
class CashShiftsController {
  constructor(private readonly shifts: CashShiftsService) {}

  private access(user: AuthUser) {
    if (!user.cafeId || (user.role !== Role.OWNER && !hasPermission(user.permissions, 'actions.financeCashShifts'))) {
      throw new ForbiddenException('Нет доступа к кассовым сменам');
    }
    return user.cafeId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.shifts.list(this.access(user), user.role !== Role.WAITER);
  }

  @Patch('setting')
  @Roles(Role.OWNER)
  setting(@CurrentUser() user: AuthUser, @Body() body: CashShiftsSettingDto) {
    return this.shifts.setting(this.access(user), body.enabled);
  }

  @Post('open')
  open(@CurrentUser() user: AuthUser, @Body() body: OpenCashShiftDto) {
    return this.shifts.open(this.access(user), user.id, body.amount);
  }

  @Post('close')
  close(@CurrentUser() user: AuthUser, @Body() body: CloseCashShiftDto) {
    return this.shifts.close(this.access(user), user.id, body);
  }
}

@Module({ controllers: [CashShiftsController], providers: [CashShiftsService] })
export class CashShiftsModule {}
