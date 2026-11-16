import { BadRequestException } from '@nestjs/common';
import { OrderStatus, Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import { warehouseDateRange, warehouseDay } from '../warehouse/report-range';

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
type PayrollWindow = ReturnType<typeof payrollMonth>;

export function payrollMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Укажите месяц начисления');
  const start = Date.parse(month + '-01T00:00:00.000+06:00');
  const next = new Date(month + '-01T00:00:00.000Z');
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.getTime() - 6 * HOUR;
  return { start, end, days: (end - start) / DAY };
}

export function payrollWorkTime(shifts: ClosedShift[], month: PayrollWindow) {
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
  return Object.values(payrollAmounts(rates, work, monthDays, personalSales, shiftSales))
    .reduce((sum, amount) => sum.add(amount), zero);
}

function payrollAmounts(
  rates: SalaryRates, work: ReturnType<typeof payrollWorkTime>, monthDays: number,
  personalSales: Prisma.Decimal, shiftSales: Prisma.Decimal,
) {
  let total = zero;
  function roundedComponent(amount: Prisma.Decimal) {
    const before = total.toDecimalPlaces(2);
    total = total.add(amount);
    return total.toDecimalPlaces(2).sub(before);
  }
  return {
    hourlyPay: roundedComponent(new Prisma.Decimal(rates.hourly).mul(work.milliseconds).div(HOUR)),
    shiftPay: roundedComponent(new Prisma.Decimal(rates.perShift).mul(work.shifts)),
    monthlyPay: roundedComponent(new Prisma.Decimal(rates.monthly).mul(work.days).div(monthDays)),
    personalCommission: roundedComponent(personalSales.mul(rates.personalPercent).div(100)),
    shiftCommission: roundedComponent(shiftSales.mul(rates.shiftPercent).div(100)),
  };
}

export async function payrollReport(db: Db, cafeId: string, month: string, onlyUserId?: string, window = payrollMonth(month)) {
  const [employees, accruals, shifts] = await Promise.all([
    db.user.findMany({
      where: { cafeId, role: { not: Role.OWNER }, ...(onlyUserId ? { id: onlyUserId } : {}), OR: [
        { isActive: true }, { waiterShifts: { some: {
          cafeId, status: WaiterShiftStatus.closed, startedAt: { lt: new Date(window.end) }, endedAt: { gt: new Date(window.start) },
        } } }, { orders: { some: {
          cafeId, status: OrderStatus.paid, closedAt: { gte: new Date(window.start), lt: new Date(window.end) },
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
  const employeeIds = employees.map(({ id }) => id);
  const hasClosedShifts = shifts.length > 0;
  const paidByEmployee = new Map<string, Prisma.Decimal>();
  const paidOrders: { at: number; cumul: Prisma.Decimal }[] = [];
  if (employeeIds.length) {
    const orders = await db.order.findMany({
      where: { cafeId, status: OrderStatus.paid, closedAt: { gte: new Date(window.start), lt: new Date(window.end) },
        ...(hasClosedShifts ? {} : { waiterId: { in: employeeIds } }) },
      select: { closedAt: true, waiterId: true, finalAmount: true },
      orderBy: { closedAt: 'asc' },
    });
    let cumul = zero;
    for (const order of orders) {
      if (order.waiterId) paidByEmployee.set(order.waiterId, (paidByEmployee.get(order.waiterId) ?? zero).add(order.finalAmount));
      if (hasClosedShifts && order.closedAt) {
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
    const shiftSales = work.periods.reduce((total, { start, end }) => total.add(priorSales(end).sub(priorSales(start))), zero);
    const amounts = payrollAmounts(rates, work, window.days, personalSales, shiftSales);
    const estimate = Object.values(amounts).reduce((total, amount) => total.add(amount), zero);
    const booked = totals.get(employee.id) ?? { accrued: zero, paid: zero };
    const tracked = employee.role === Role.WAITER || work.periods.length > 0;
    return {
      userId: employee.id, name: employee.name, positionId: employee.position?.id ?? null,
      position: employee.position?.name ?? staffLabels[employee.role] ?? '',
      hours: tracked ? Math.round(work.milliseconds / HOUR * 100) / 100 : null,
      shifts: tracked ? work.shifts : null, days: tracked ? work.days : null,
      rateMonth: employee.position?.salaryRates[0]?.effectiveMonth ?? null, rates,
      hourlyPay: Number(amounts.hourlyPay), shiftPay: Number(amounts.shiftPay), monthlyPay: Number(amounts.monthlyPay),
      personalCommission: Number(amounts.personalCommission), shiftCommission: Number(amounts.shiftCommission),
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
      hourlyPay: 0, shiftPay: 0, monthlyPay: 0, personalCommission: 0, shiftCommission: 0,
      estimate: 0, available: 0, accrued: Number(booked.accrued), paid: Number(booked.paid), due: Number(booked.accrued.sub(booked.paid)),
    });
  }
  return { staff: staff.sort((a, b) => a.name.localeCompare(b.name, 'ru')), records };
}

export function payrollPeriods(from: string, to: string) {
  const range = warehouseDateRange(from, to)!;
  const start = range.gte!.getTime();
  const end = range.lte!.getTime() + 1;
  const lastMonth = to.slice(0, 7);
  const periods: { month: string; window: PayrollWindow }[] = [];
  for (let month = from.slice(0, 7); month <= lastMonth;) {
    if (periods.length >= 12) throw new BadRequestException('Выберите период не длиннее 12 календарных месяцев');
    const window = payrollMonth(month);
    periods.push({ month, window: { ...window, start: Math.max(start, window.start), end: Math.min(end, window.end) } });
    if (month === lastMonth) break;
    month = warehouseDay(new Date(window.end)).slice(0, 7);
  }
  return periods;
}

const totalsKeys = ['hourlyPay', 'shiftPay', 'monthlyPay', 'personalCommission', 'shiftCommission',
  'personalSales', 'shiftSales', 'estimate', 'available', 'accrued', 'paid', 'due'] as const;
const activityKeys = ['hours', 'shifts', 'days'] as const;

export async function payrollPeriodReport(db: Db, cafeId: string, from: string, to: string) {
  const periods = payrollPeriods(from, to);
  const staff = new Map<string, Awaited<ReturnType<typeof payrollReport>>['staff'][number]>();
  const ratesByEmployee = new Map<string, { month: string; rates: SalaryRates }[]>();
  const records: Awaited<ReturnType<typeof payrollReport>>['records'] = [];
  for (const { month, window } of periods) {
    const report = await payrollReport(db, cafeId, month, undefined, window);
    records.push(...report.records);
    for (const row of report.staff) {
      const ratesByMonth = ratesByEmployee.get(row.userId) ?? [];
      ratesByMonth.push({ month, rates: row.rates });
      ratesByEmployee.set(row.userId, ratesByMonth);
      const previous = staff.get(row.userId);
      if (previous) {
        for (const key of totalsKeys) row[key] = new Prisma.Decimal(previous[key]).add(row[key]).toNumber();
        for (const key of activityKeys) {
          if (previous[key] !== null || row[key] !== null) row[key] = Number(((previous[key] ?? 0) + (row[key] ?? 0)).toFixed(2));
        }
      }
      staff.set(row.userId, row);
    }
  }
  return {
    staff: [...staff.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map((row) => ({ ...row, ratesByMonth: ratesByEmployee.get(row.userId) ?? [] })),
    records,
  };
}

export const currentPayrollMonth = () => warehouseDay(new Date()).slice(0, 7);
