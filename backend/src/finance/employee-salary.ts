import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { warehouseDateRange, warehouseDay } from '../warehouse/report-range';
import { salaryRates } from './payroll';

export function nextSalaryDay() {
  return warehouseDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
}

export function futureSalaryDay(day = nextSalaryDay()) {
  warehouseDateRange(day, day);
  if (day < nextSalaryDay()) throw new BadRequestException('Дата начала новой ставки должна быть не раньше завтра');
  return day;
}

/** Copy the effective position schedule while retaining rates that have already taken effect. */
export async function syncEmployeeSalary(
  db: Prisma.TransactionClient, cafeId: string, userIds: string[], effectiveDay = nextSalaryDay(),
) {
  if (!userIds.length) return;
  const employees = await db.user.findMany({
    where: { cafeId, id: { in: userIds } },
    select: { id: true, position: { select: {
      id: true, name: true,
      salaryRates: { orderBy: { effectiveDay: 'asc' } },
    } } },
  });
  await db.employeeSalaryRate.deleteMany({ where: { cafeId, userId: { in: userIds }, effectiveDay: { gte: effectiveDay } } });
  const snapshots: Prisma.EmployeeSalaryRateCreateManyInput[] = [];
  for (const employee of employees) {
    const position = employee.position;
    const rates = position?.salaryRates ?? [];
    const activeRate = rates.filter((rate) => rate.effectiveDay <= effectiveDay).at(-1);
    const futureRates = rates.filter((rate) => rate.effectiveDay > effectiveDay);
    for (const rate of [activeRate, ...futureRates]) {
      snapshots.push({
        cafeId, userId: employee.id, effectiveDay: !rate || rate.effectiveDay < effectiveDay ? effectiveDay : rate.effectiveDay,
        positionId: position?.id ?? null, positionName: position?.name ?? '',
        ...salaryRates(rate), categoryRates: (rate?.categoryRates ?? []) as Prisma.InputJsonValue,
      });
    }
  }
  await db.employeeSalaryRate.createMany({ data: snapshots });
}
