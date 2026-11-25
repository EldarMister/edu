import { BadRequestException } from '@nestjs/common';
import { OrderStatus, Prisma, Role, WaiterShiftStatus, type EmployeeSalaryOverride } from '@prisma/client';
import { warehouseDateRange, warehouseDay } from '../warehouse/report-range';
import { categoryCommissions, payrollOrderSelect, payrollSale, salesBetween, salesCommission, type CommissionKind, type PayrollSale } from './payroll-sales';

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const zero = new Prisma.Decimal(0);
const staffLabels: Partial<Record<Role, string>> = {
  ADMIN: 'Администратор', WAITER: 'Официант', KITCHEN: 'Кухня', BAR: 'Бар',
};

export type SalaryRates = { hourly: number; perShift: number; monthly: number; personalPercent: number; shiftPercent: number };

export function salaryRates(rate?: Record<keyof SalaryRates, Prisma.Decimal> | null): SalaryRates {
  return {
    hourly: Number(rate?.hourly ?? 0), perShift: Number(rate?.perShift ?? 0), monthly: Number(rate?.monthly ?? 0),
    personalPercent: Number(rate?.personalPercent ?? 0), shiftPercent: Number(rate?.shiftPercent ?? 0),
  };
}

type ClosedShift = { id?: string; startedAt: Date; endedAt: Date | null };
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
  return Object.values(roundPayrollAmounts(payrollAmounts(rates, work, monthDays, personalSales, shiftSales)))
    .reduce((sum, amount) => sum.add(amount), zero);
}

function payrollAmounts(
  rates: SalaryRates, work: ReturnType<typeof payrollWorkTime>, monthDays: number,
  personalSales: Prisma.Decimal, shiftSales: Prisma.Decimal,
) {
  return {
    hourlyPay: new Prisma.Decimal(rates.hourly).mul(work.milliseconds).div(HOUR),
    shiftPay: new Prisma.Decimal(rates.perShift).mul(work.shifts),
    monthlyPay: new Prisma.Decimal(rates.monthly).mul(work.days).div(monthDays),
    personalCommission: personalSales.mul(rates.personalPercent).div(100),
    shiftCommission: shiftSales.mul(rates.shiftPercent).div(100),
  };
}

type SalarySnapshot = Pick<Prisma.EmployeeSalaryRateGetPayload<object>,
  'effectiveDay' | 'positionId' | 'positionName' | 'hourly' | 'perShift' | 'monthly' | 'personalPercent' | 'shiftPercent' | 'categoryRates'>
  & { personal?: boolean };
type PayrollAmounts = ReturnType<typeof payrollAmounts>;

function effectiveSalaryRates(positionRates: SalarySnapshot[], personalRates: EmployeeSalaryOverride[]): SalarySnapshot[] {
  if (!personalRates.length) return positionRates;
  const positions = new Map(positionRates.map((rate) => [rate.effectiveDay, rate]));
  const overrides = new Map(personalRates.map((rate) => [rate.effectiveDay, rate]));
  const days = [...new Set([...positions.keys(), ...overrides.keys()])].sort();
  let position: SalarySnapshot | undefined;
  let override: EmployeeSalaryOverride | undefined;
  return days.map((effectiveDay) => {
    position = positions.get(effectiveDay) ?? position;
    override = overrides.get(effectiveDay) ?? override;
    const personal = !!override && !override.usePosition;
    const rates = personal ? override : position;
    return {
      hourly: rates?.hourly ?? zero, perShift: rates?.perShift ?? zero, monthly: rates?.monthly ?? zero,
      personalPercent: rates?.personalPercent ?? zero, shiftPercent: rates?.shiftPercent ?? zero,
      effectiveDay, personal, positionId: position?.positionId ?? null, positionName: position?.positionName ?? '',
      categoryRates: personal ? [] : position?.categoryRates ?? [],
    };
  });
}

function roundPayrollAmounts(raw: PayrollAmounts) {
  let total = zero;
  const rounded = { ...raw };
  for (const key of Object.keys(raw) as (keyof PayrollAmounts)[]) {
    const previous = total.toDecimalPlaces(2);
    total = total.add(raw[key]);
    rounded[key] = total.toDecimalPlaces(2).sub(previous);
  }
  return rounded;
}

function calculatePayrollIntervals(
  window: PayrollWindow, employeeRates: SalarySnapshot[], shifts: ClosedShift[], personal: PayrollSale[],
  allSales: PayrollSale[], details: boolean,
) {
  const startDay = warehouseDay(new Date(window.start));
  const atStart = employeeRates.filter((rate) => rate.effectiveDay <= startDay).at(-1);
  const laterRates = employeeRates.filter((rate) => rate.effectiveDay > startDay);
  const spans = [
    { start: window.start, rate: atStart },
    ...laterRates.map((rate) => ({ start: warehouseDateRange(rate.effectiveDay)?.gte?.getTime() ?? window.end, rate })),
  ].filter(({ start }) => start < window.end);
  const raw = { hourlyPay: zero, shiftPay: zero, monthlyPay: zero, personalCommission: zero, shiftCommission: zero };
  let personalSales = zero;
  let shiftSales = zero;
  const rateIntervals = spans.map(({ start, rate }, index) => {
    const end = spans[index + 1]?.start ?? window.end;
    const rates = salaryRates(rate);
    const work = payrollWorkTime(shifts, { ...window, start, end });
    const categories = categoryCommissions(rate?.categoryRates);
    const byCategory = new Map(categories.map((row) => [row.categoryId, row]));
    const sales: {
      orderId: string; number: string; closedAt: string; kind: CommissionKind; openerRecorded: boolean;
      categoryId: string | null; categoryName?: string; base: number; percent: number; amount: number;
    }[] = [];
    const components = payrollAmounts(rates, work, window.days, zero, zero);
    const apply = (entries: PayrollSale[], kind: CommissionKind) => {
      for (const sale of entries) {
        if (kind === 'personalPercent') personalSales = personalSales.add(sale.amount);
        else shiftSales = shiftSales.add(sale.amount);
        const key = kind === 'personalPercent' ? 'personalCommission' : 'shiftCommission';
        for (const part of salesCommission(sale, kind, rates[kind], byCategory)) {
          components[key] = components[key].add(part.amount);
          if (details) sales.push({
            orderId: sale.id, number: sale.number, closedAt: new Date(sale.at).toISOString(), kind, openerRecorded: sale.openerRecorded,
            categoryId: part.categoryId, base: part.base.toNumber(), percent: part.percent, amount: part.amount.toNumber(),
          });
        }
      }
    };
    apply(salesBetween(personal, start, end), 'personalPercent');
    for (const span of work.periods) apply(salesBetween(allSales, span.start, span.end), 'shiftPercent');
    for (const key of Object.keys(raw) as (keyof PayrollAmounts)[]) raw[key] = raw[key].add(components[key]);
    return {
      from: warehouseDay(new Date(start)), to: warehouseDay(new Date(end - 1)), effectiveDay: rate?.effectiveDay ?? null,
      position: rate?.positionName ?? null, personal: rate?.personal ?? false, rates, categoryRates: categories,
      hours: Math.round(work.milliseconds / HOUR * 100) / 100, shifts: work.shifts, days: work.days,
      sales,
    };
  });
  return { amounts: roundPayrollAmounts(raw), personalSales, shiftSales, rateIntervals };
}

export async function payrollReport(
  db: Db, cafeId: string, month: string, onlyUserId?: string, window = payrollMonth(month), details = false,
) {
  const paidInPeriod = { cafeId, status: OrderStatus.paid, closedAt: { gte: new Date(window.start), lt: new Date(window.end) } };
  const throughDay = warehouseDay(new Date(window.end - 1));
  const rateScope = { cafeId, effectiveDay: { lte: throughDay }, ...(onlyUserId ? { userId: onlyUserId } : {}) };
  const [employees, accruals, shifts, employeeRates, overrides] = await Promise.all([
    db.user.findMany({
      where: { cafeId, role: { not: Role.OWNER }, ...(onlyUserId ? { id: onlyUserId } : {}), OR: [
        { isActive: true }, { waiterShifts: { some: {
          cafeId, status: WaiterShiftStatus.closed, startedAt: { lt: new Date(window.end) }, endedAt: { gt: new Date(window.start) },
        } } }, { orders: { some: paidInPeriod } }, { openedPayrollOrders: { some: paidInPeriod } },
      ] },
      select: { id: true, name: true, role: true, isActive: true, position: { select: { id: true, name: true } } },
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
      select: { id: true, waiterId: true, startedAt: true, endedAt: true },
    }),
    db.employeeSalaryRate.findMany({
      where: rateScope,
      orderBy: { effectiveDay: 'asc' },
    }),
    db.employeeSalaryOverride.findMany({ where: rateScope, orderBy: { effectiveDay: 'asc' } }),
  ]);
  const ratesByEmployee = new Map<string, SalarySnapshot[]>();
  for (const rate of employeeRates) {
    const list = ratesByEmployee.get(rate.userId) ?? [];
    list.push(rate);
    ratesByEmployee.set(rate.userId, list);
  }
  const overridesByEmployee = new Map<string, EmployeeSalaryOverride[]>();
  for (const override of overrides) {
    const list = overridesByEmployee.get(override.userId) ?? [];
    list.push(override);
    overridesByEmployee.set(override.userId, list);
  }
  const employeeIds = employees.map(({ id }) => id);
  const hasClosedShifts = shifts.length > 0;
  const paidByEmployee = new Map<string, PayrollSale[]>();
  const paidOrders: PayrollSale[] = [];
  if (employeeIds.length) {
    const orders = await db.order.findMany({
      where: { ...paidInPeriod, ...(hasClosedShifts ? {} : { OR: [
        { payrollOpenedById: { in: employeeIds } }, { payrollOpenedById: null, waiterId: { in: employeeIds } },
      ] }) },
      select: payrollOrderSelect,
      orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
    });
    for (const order of orders) {
      if (!order.closedAt) continue;
      const sale = payrollSale(order);
      if (sale.openerId) {
        const personal = paidByEmployee.get(sale.openerId) ?? [];
        personal.push(sale);
        paidByEmployee.set(sale.openerId, personal);
      }
      if (hasClosedShifts) paidOrders.push(sale);
    }
  }

  const byEmployee = new Map<string, ClosedShift[]>();
  for (const shift of shifts) {
    const list = byEmployee.get(shift.waiterId) ?? [];
    list.push(shift);
    byEmployee.set(shift.waiterId, list);
  }

  const emptyTotals = () => ({ accrued: zero, paid: zero, baseAccrued: zero, supplementalAccrued: zero });
  const totals = new Map<string, ReturnType<typeof emptyTotals>>();
  const records = accruals.map(({ payments, ...record }) => {
    const existing = totals.get(record.userId) ?? emptyTotals();
    const paid = payments.reduce((sum, entry) => sum.sub(entry.amount), zero);
    const accruedAmount = record.voidedAt ? zero : record.amount;
    totals.set(record.userId, {
      accrued: existing.accrued.add(accruedAmount), paid: existing.paid.add(paid),
      baseAccrued: existing.baseAccrued.add(record.supplemental ? zero : accruedAmount),
      supplementalAccrued: existing.supplementalAccrued.add(record.supplemental ? accruedAmount : zero),
    });
    return { ...record, amount: Number(record.amount), paidAmount: Number(paid) };
  });
  const staff = employees.map((employee) => {
    const employeeRates = effectiveSalaryRates(ratesByEmployee.get(employee.id) ?? [], overridesByEmployee.get(employee.id) ?? []);
    const rate = employeeRates.at(-1);
    const rates = salaryRates(rate);
    const shifts = byEmployee.get(employee.id) ?? [];
    const work = payrollWorkTime(shifts, window);
    const { amounts, personalSales, shiftSales, rateIntervals } = calculatePayrollIntervals(
      window, employeeRates, shifts, paidByEmployee.get(employee.id) ?? [], paidOrders, details,
    );
    const estimate = Object.values(amounts).reduce((total, amount) => total.add(amount), zero);
    const booked = totals.get(employee.id) ?? emptyTotals();
    const tracked = true;
    return {
      userId: employee.id, name: employee.name, positionId: rate?.positionId ?? employee.position?.id ?? null,
      position: rate?.positionName ?? employee.position?.name ?? staffLabels[employee.role] ?? '',
      timeTrackingAvailable: tracked,
      hours: tracked ? Math.round(work.milliseconds / HOUR * 100) / 100 : null,
      shifts: tracked ? work.shifts : null, days: tracked ? work.days : null,
      rateMonth: rate?.effectiveDay.slice(0, 7) ?? null, rates, rateIntervals,
      workShifts: details ? shifts.map(({ id, startedAt, endedAt }) => ({ id, startedAt, endedAt })) : [],
      hourlyPay: Number(amounts.hourlyPay), shiftPay: Number(amounts.shiftPay), monthlyPay: Number(amounts.monthlyPay),
      personalCommission: Number(amounts.personalCommission), shiftCommission: Number(amounts.shiftCommission),
      personalSales: Number(personalSales), shiftSales: Number(shiftSales), estimate: Number(estimate),
      available: Number(Prisma.Decimal.max(zero, estimate.sub(booked.baseAccrued))),
      baseAccrued: Number(booked.baseAccrued), supplementalAccrued: Number(booked.supplementalAccrued),
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
      timeTrackingAvailable: false,
      hours: null, shifts: null, days: null, rateMonth: null, rates: salaryRates(), rateIntervals: [], workShifts: [],
      personalSales: 0, shiftSales: 0,
      hourlyPay: 0, shiftPay: 0, monthlyPay: 0, personalCommission: 0, shiftCommission: 0,
      estimate: 0, available: 0, baseAccrued: Number(booked.baseAccrued), supplementalAccrued: Number(booked.supplementalAccrued),
      accrued: Number(booked.accrued), paid: Number(booked.paid), due: Number(booked.accrued.sub(booked.paid)),
    });
  }
  if (details) {
    const sales = staff.flatMap((row) => row.rateIntervals.flatMap((interval) => interval.sales));
    const ids = [...new Set(sales.flatMap(({ categoryId }) => categoryId ? [categoryId] : []))];
    if (ids.length) {
      const categories = await db.category.findMany({ where: { cafeId, id: { in: ids } }, select: { id: true, name: true } });
      const names = new Map(categories.map(({ id, name }) => [id, name]));
      for (const sale of sales) if (sale.categoryId) sale.categoryName = names.get(sale.categoryId) ?? 'Архивная категория';
    }
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
  'personalSales', 'shiftSales', 'estimate', 'available', 'baseAccrued', 'supplementalAccrued', 'accrued', 'paid', 'due'] as const;
const activityKeys = ['hours', 'shifts', 'days'] as const;

export async function payrollPeriodReport(db: Db, cafeId: string, from: string, to: string, userId?: string, details = false) {
  const periods = payrollPeriods(from, to);
  const staff = new Map<string, Awaited<ReturnType<typeof payrollReport>>['staff'][number]>();
  const ratesByEmployee = new Map<string, { month: string; rates: SalaryRates }[]>();
  const records: Awaited<ReturnType<typeof payrollReport>>['records'] = [];
  for (const { month, window } of periods) {
    const report = await payrollReport(db, cafeId, month, userId, window, details);
    records.push(...report.records);
    for (const row of report.staff) {
      const ratesByMonth = ratesByEmployee.get(row.userId) ?? [];
      ratesByMonth.push({ month, rates: row.rates });
      ratesByEmployee.set(row.userId, ratesByMonth);
      const previous = staff.get(row.userId);
      if (previous) {
        row.timeTrackingAvailable = previous.timeTrackingAvailable || row.timeTrackingAvailable;
        for (const key of totalsKeys) row[key] = new Prisma.Decimal(previous[key]).add(row[key]).toNumber();
        for (const key of activityKeys) {
          if (previous[key] !== null || row[key] !== null) row[key] = Number(((previous[key] ?? 0) + (row[key] ?? 0)).toFixed(2));
        }
        row.rateIntervals = [...previous.rateIntervals, ...row.rateIntervals];
        row.workShifts = [...new Map([...previous.workShifts, ...row.workShifts].map((shift) => [shift.id, shift])).values()];
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
