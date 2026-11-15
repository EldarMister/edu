import { BadRequestException } from '@nestjs/common';
import { OrderStatus, Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import { warehouseDay } from '../warehouse/report-range';

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const zero = new Prisma.Decimal(0);
const staffLabels: Partial<Record<Role, string>> = {
  ADMIN: 'Администратор', WAITER: 'Официант', KITCHEN: 'Кухня', BAR: 'Бар',
};

export type SalaryRates = { hourly: number; perShift: number; monthly: number; personalPercent: number; shiftPercent: number };

export function salaryRates(rate?: Record<keyof SalaryRates, Prisma.Decimal>): SalaryRates {
  return {
    hourly: Number(rate?.hourly ?? 0), perShift: Number(rate?.perShift ?? 0), monthly: Number(rate?.monthly ?? 0),
    personalPercent: Number(rate?.personalPercent ?? 0), shiftPercent: Number(rate?.shiftPercent ?? 0),
  };
}

type ClosedShift = { startedAt: Date; endedAt: Date | null };
type TimeSpan = { start: number; end: number };

export function payrollMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Укажите месяц начисления');
  const start = Date.parse(month + '-01T00:00:00.000+06:00');
  const next = new Date(month + '-01T00:00:00.000Z');
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.getTime() - 6 * HOUR;
  return { start, end, days: (end - start) / DAY };
}

export function payrollWorkTime(shifts: ClosedShift[], month: ReturnType<typeof payrollMonth>) {
  const periods: TimeSpan[] = [];
  let count = 0;
  for (const { startedAt, endedAt } of shifts) {
    if (!endedAt) continue;
    const opened = startedAt.getTime();
    const start = Math.max(opened, month.start);
    const end = Math.min(endedAt.getTime(), month.end);
    if (start >= end) continue;
    if (opened >= month.start) count += 1;
    periods.push({ start, end });
  }

  // Hours and team turnover must not be counted twice if sessions overlap.
  const merged: TimeSpan[] = [];
  for (const period of periods.sort((a, b) => a.start - b.start)) {
    const latest = merged.at(-1);
    if (latest && period.start <= latest.end) latest.end = Math.max(latest.end, period.end);
    else merged.push(period);
  }
  let milliseconds = 0;
  const days = new Set<number>();
  for (const { start, end } of merged) {
    milliseconds += end - start;
    const startDay = Math.floor((start - month.start) / DAY);
    const endDay = Math.floor((end - 1 - month.start) / DAY);
    for (let day = startDay; day <= endDay; day += 1) days.add(day);
  }
  return { milliseconds, shifts: count, days: days.size, periods: merged };
}

export function calculatePayroll(
  rates: SalaryRates, work: ReturnType<typeof payrollWorkTime>, monthDays: number,
  personalSales: Prisma.Decimal, shiftSales: Prisma.Decimal,
) {
  return new Prisma.Decimal(rates.hourly).mul(work.milliseconds).div(HOUR)
    .add(new Prisma.Decimal(rates.perShift).mul(work.shifts))
    .add(new Prisma.Decimal(rates.monthly).mul(work.days).div(monthDays))
    .add(personalSales.mul(rates.personalPercent).div(100))
    .add(shiftSales.mul(rates.shiftPercent).div(100))
    .toDecimalPlaces(2);
}

export async function payrollReport(db: Db, cafeId: string, month: string, onlyUserId?: string) {
  const window = payrollMonth(month);
  const [employees, accruals, shifts] = await Promise.all([
    db.user.findMany({
      where: { cafeId, role: { not: Role.OWNER }, ...(onlyUserId ? { id: onlyUserId } : {}), OR: [
        { isActive: true }, { waiterShifts: { some: {
          cafeId, status: WaiterShiftStatus.closed, startedAt: { lt: new Date(window.end) }, endedAt: { gt: new Date(window.start) },
        } } },
      ] },
      select: { id: true, name: true, role: true, isActive: true, position: { select: {
        id: true, name: true, salaryRates: { where: { cafeId, effectiveMonth: { lte: month } }, orderBy: { effectiveMonth: 'desc' }, take: 1 },
      } } },
      orderBy: { name: 'asc' },
    }),
    db.salaryAccrual.findMany({
      where: { cafeId, month, ...(onlyUserId ? { userId: onlyUserId } : {}) },
      orderBy: [{ employeeName: 'asc' }, { createdAt: 'asc' }],
      include: { payments: { select: { amount: true } } },
    }),
    db.waiterShift.findMany({
      where: { cafeId, status: WaiterShiftStatus.closed,
        startedAt: { lt: new Date(window.end) }, endedAt: { gt: new Date(window.start) }, ...(onlyUserId ? { waiterId: onlyUserId } : {}) },
      select: { waiterId: true, startedAt: true, endedAt: true },
    }),
  ]);
  const ratesByEmployee = new Map(employees.map(({ id, position }) => [id, salaryRates(position?.salaryRates[0])]));
  const personalIds = employees.filter(({ id }) => (ratesByEmployee.get(id)?.personalPercent ?? 0) > 0).map(({ id }) => id);
  const teamSalesEnabled = [...ratesByEmployee.values()].some(({ shiftPercent }) => shiftPercent > 0);
  const paidByEmployee = new Map<string, Prisma.Decimal>();
  const paidOrders: { at: number; cumul: Prisma.Decimal }[] = [];
  if (personalIds.length || teamSalesEnabled) {
    const orders = await db.order.findMany({
      where: { cafeId, status: OrderStatus.paid, closedAt: { gte: new Date(window.start), lt: new Date(window.end) },
        ...(teamSalesEnabled ? {} : { waiterId: { in: personalIds } }) },
      select: { closedAt: true, waiterId: true, finalAmount: true },
      orderBy: { closedAt: 'asc' },
    });
    let cumul = zero;
    for (const order of orders) {
      if (order.waiterId) paidByEmployee.set(order.waiterId, (paidByEmployee.get(order.waiterId) ?? zero).add(order.finalAmount));
      if (teamSalesEnabled && order.closedAt) {
        cumul = cumul.add(order.finalAmount);
        paidOrders.push({ at: order.closedAt.getTime(), cumul });
      }
    }
  }

  function priorSales(time: number) {
    let left = 0;
    let right = paidOrders.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (paidOrders[mid].at < time) left = mid + 1;
      else right = mid;
    }
    return paidOrders[left - 1]?.cumul ?? zero;
  }

  const byEmployee = new Map<string, ClosedShift[]>();
  for (const shift of shifts) {
    const list = byEmployee.get(shift.waiterId) ?? [];
    list.push(shift);
    byEmployee.set(shift.waiterId, list);
  }

  const totals = new Map<string, { accrued: Prisma.Decimal; paid: Prisma.Decimal }>();
  const records = accruals.map(({ payments, ...record }) => {
    const existing = totals.get(record.userId) ?? { accrued: zero, paid: zero };
    const paid = payments.reduce((sum, entry) => sum.sub(entry.amount), zero);
    totals.set(record.userId, { accrued: existing.accrued.add(record.amount), paid: existing.paid.add(paid) });
    return { ...record, amount: Number(record.amount), paidAmount: Number(paid) };
  });
  const staff = employees.map((employee) => {
    const rates = ratesByEmployee.get(employee.id)!;
    const work = payrollWorkTime(byEmployee.get(employee.id) ?? [], window);
    const personalSales = paidByEmployee.get(employee.id) ?? zero;
    const shiftSales = rates.shiftPercent > 0
      ? work.periods.reduce((total, { start, end }) => total.add(priorSales(end).sub(priorSales(start))), zero) : zero;
    const estimate = calculatePayroll(rates, work, window.days, personalSales, shiftSales);
    const booked = totals.get(employee.id) ?? { accrued: zero, paid: zero };
    const tracked = employee.role === Role.WAITER || work.periods.length > 0;
    return {
      userId: employee.id, name: employee.name, positionId: employee.position?.id ?? null,
      position: employee.position?.name ?? staffLabels[employee.role] ?? '',
      hours: tracked ? Math.round(work.milliseconds / HOUR * 100) / 100 : null,
      shifts: tracked ? work.shifts : null, days: tracked ? work.days : null,
      rateMonth: employee.position?.salaryRates[0]?.effectiveMonth ?? null, rates,
      personalSales: Number(personalSales), shiftSales: Number(shiftSales), estimate: Number(estimate),
      available: employee.isActive ? Number(Prisma.Decimal.max(zero, estimate.sub(booked.accrued))) : 0,
      accrued: Number(booked.accrued), paid: Number(booked.paid), due: Number(booked.accrued.sub(booked.paid)),
    };
  });
  const included = new Set(staff.map(({ userId }) => userId));
  for (const record of records) {
    if (included.has(record.userId)) continue;
    included.add(record.userId);
    const booked = totals.get(record.userId)!;
    staff.push({
      userId: record.userId, name: record.employeeName, positionId: null, position: '',
      hours: null, shifts: null, days: null, rateMonth: null, rates: salaryRates(), personalSales: 0, shiftSales: 0,
      estimate: 0, available: 0, accrued: Number(booked.accrued), paid: Number(booked.paid), due: Number(booked.accrued.sub(booked.paid)),
    });
  }
  return { staff: staff.sort((a, b) => a.name.localeCompare(b.name, 'ru')), records };
}

export const currentPayrollMonth = () => warehouseDay(new Date()).slice(0, 7);
