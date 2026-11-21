import { Prisma, type FinanceEntry } from '@prisma/client';

export const cashHandoverKey = 'cash-handover:';

export function cashCustodyDate(day: string) {
  return new Date(day + 'T00:00:00.000Z');
}

type SaleCustody = Pick<FinanceEntry, 'cafeId' | 'cashCustodianId' | 'cashCustodyDay'>;

export async function refundCashCustody(
  tx: Prisma.TransactionClient, sale: SaleCustody | undefined, amount: Prisma.Decimal,
  remainingByDay: Map<string, Prisma.Decimal>,
) {
  if (!sale?.cashCustodianId || !sale.cashCustodyDay) return new Prisma.Decimal(0);
  const { cafeId, cashCustodianId, cashCustodyDay } = sale;
  const key = cashCustodianId + ':' + cashCustodyDay.toISOString();
  let remaining = remainingByDay.get(key);
  if (remaining === undefined) {
    const [custody, receipt] = await Promise.all([
      tx.financeEntry.aggregate({ where: { cafeId, cashCustodianId, cashCustodyDay }, _sum: { amount: true } }),
      tx.shiftCashReport.findUnique({
        where: { waiterId_date: { waiterId: cashCustodianId, date: cashCustodyDay }, cafeId },
        select: { cashHanded: true, cashReceivedAt: true },
      }),
    ]);
    remaining = Prisma.Decimal.max(0, (custody._sum.amount ?? new Prisma.Decimal(0))
      .sub(receipt?.cashReceivedAt ? receipt.cashHanded : 0));
  }
  const fromCustody = Prisma.Decimal.min(remaining, amount);
  remainingByDay.set(key, remaining.sub(fromCustody));
  return fromCustody;
}
