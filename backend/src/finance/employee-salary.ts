import { Prisma } from '@prisma/client';
import { currentPayrollMonth, salaryRates } from './payroll';

/** Salary changes take effect for the current calendar month; earlier snapshots stay intact. */
export async function syncEmployeeSalary(
  db: Prisma.TransactionClient, cafeId: string, userIds: string[], month = currentPayrollMonth(),
) {
  if (!userIds.length) return;
  const employees = await db.user.findMany({
    where: { cafeId, id: { in: userIds } },
    select: { id: true, position: { select: {
      id: true, name: true,
      salaryRates: { where: { effectiveMonth: { lte: month } }, orderBy: { effectiveMonth: 'desc' }, take: 1 },
    } } },
  });
  for (const employee of employees) {
    const values = {
      positionId: employee.position?.id ?? null, positionName: employee.position?.name ?? '',
      ...salaryRates(employee.position?.salaryRates[0]),
    };
    await db.employeeSalaryRate.upsert({
      where: { cafeId_userId_effectiveMonth: { cafeId, userId: employee.id, effectiveMonth: month } },
      create: { cafeId, userId: employee.id, effectiveMonth: month, ...values },
      update: values,
    });
  }
}
