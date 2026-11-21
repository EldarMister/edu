import { ConflictException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma, Role } from '@prisma/client';
import { warehouseDay } from '../warehouse/report-range';
import { cashCustodyDate, refundCashCustody } from './cash-custody';
import { ensureFinanceAccounts, lockFinance } from './finance-ledger';

export async function recordOrderReceipts(
  tx: Prisma.TransactionClient, cafeId: string, orderId: string, actorId: string, now: Date,
) {
  await lockFinance(tx, cafeId);
  const payments = await tx.payment.findMany({
    where: { cafeId, orderId, status: PaymentStatus.paid },
    select: { id: true, method: true, amount: true, cashierId: true, cashier: { select: { role: true } } },
  });
  const received = payments.filter(({ amount }) => amount.gt(0));
  if (!received.length) return;
  const accounts = await ensureFinanceAccounts(tx, cafeId);
  const shift = await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } });
  const settings = await tx.settings.findFirst({
    where: { cafeId }, select: { cashShiftsEnabled: true, cashHandoverEnabled: true },
  });
  if (!shift && settings?.cashShiftsEnabled) throw new ConflictException('Откройте кассовую смену перед оплатой');
  const data = received.map(({ id, amount, method, cashierId, cashier }) => {
    const cash = method === PaymentMethod.cash;
    if (cash && settings?.cashHandoverEnabled && cashier.role === Role.WAITER) {
      return {
        cafeId, actorId, amount, kind: 'sale' as const, sourceKey: 'sale:' + id,
        accountId: accounts.cash.id, cashCustodianId: cashierId, cashCustodyDay: cashCustodyDate(warehouseDay(now)),
        occurredAt: now, note: 'Наличные у сотрудника',
      };
    }
    return {
      cafeId, actorId, amount, kind: 'sale' as const, sourceKey: 'sale:' + id,
      accountId: cash ? shift?.accountId ?? accounts.cash.id : accounts.noncash.id,
      cashShiftId: shift?.id, pendingCashShift: !!shift, occurredAt: shift && now < shift.openedAt ? shift.openedAt : now, note: 'Оплата заказа',
    };
  });
  await tx.financeEntry.createMany({ data, skipDuplicates: true });
}

export async function reverseOrderReceipts(
  tx: Prisma.TransactionClient, cafeId: string, orderId: string, actorId: string,
) {
  await lockFinance(tx, cafeId);
  const payments = await tx.payment.findMany({
    where: { cafeId, orderId, status: PaymentStatus.paid }, select: { id: true },
  });
  if (!payments.length) return;
  const sales = await tx.financeEntry.findMany({
    where: { cafeId, sourceKey: { in: payments.map(({ id }) => 'sale:' + id) } },
    include: { account: { select: { type: true } } },
  });
  if (!sales.length) return;
  const settings = await tx.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true } });
  const shift = await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } });
  const drawerSales = sales.filter(({ cashCustodianId }) => !cashCustodianId);
  if (drawerSales.some((sale) => sale.account.type === 'cash' && settings?.cashShiftsEnabled && shift?.accountId !== sale.accountId)) {
    throw new ConflictException('Для возврата наличных откройте смену на исходном кассовом счёте');
  }
  const occurredAt = new Date();
  const data: Prisma.FinanceEntryCreateManyInput[] = [];
  const remainingByDay = new Map<string, Prisma.Decimal>();
  for (const sale of sales) {
    const sourceKey = 'refund:' + sale.sourceKey;
    if (await tx.financeEntry.findUnique({ where: { cafeId_sourceKey: { cafeId, sourceKey } }, select: { id: true } })) continue;
    const refund = { cafeId, actorId, kind: 'refund' as const, occurredAt, note: 'Отмена оплаты заказа' };
    const custody = await refundCashCustody(tx, sale, sale.amount, remainingByDay);
    const drawerAmount = sale.amount.sub(custody);
    if (drawerAmount.gt(0)) {
      if (sale.cashCustodianId && settings?.cashShiftsEnabled && !shift) {
        throw new ConflictException('Для возврата наличных откройте кассовую смену');
      }
      data.push({
        ...refund, sourceKey, accountId: sale.cashCustodianId ? shift?.accountId ?? sale.accountId : sale.accountId,
        amount: drawerAmount.negated(), cashShiftId: shift?.id, pendingCashShift: !!shift,
      });
    }
    if (custody.gt(0)) data.push({
      ...refund, sourceKey: drawerAmount.isZero() ? sourceKey : sourceKey + ':custody',
      accountId: sale.accountId, cashCustodianId: sale.cashCustodianId, cashCustodyDay: sale.cashCustodyDay,
      amount: custody.negated(),
    });
  }
  if (data.length) await tx.financeEntry.createMany({ data, skipDuplicates: true });
}
