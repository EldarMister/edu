import { ConflictException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { ensureFinanceAccounts, lockFinance } from './finance-ledger';

export async function recordOrderReceipts(
  tx: Prisma.TransactionClient, cafeId: string, orderId: string, actorId: string, now: Date,
) {
  await lockFinance(tx, cafeId);
  const payments = await tx.payment.findMany({
    where: { cafeId, orderId, status: PaymentStatus.paid },
    select: { id: true, method: true, amount: true },
  });
  const accounts = await ensureFinanceAccounts(tx, cafeId);
  const hasCash = payments.some(({ method, amount }) => method === PaymentMethod.cash && amount.gt(0));
  const shift = hasCash ? await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } }) : null;
  if (hasCash && !shift) {
    const settings = await tx.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true } });
    if (settings?.cashShiftsEnabled) throw new ConflictException('Откройте кассовую смену перед оплатой наличными');
  }
  const data = payments.filter(({ amount }) => amount.gt(0)).map(({ id, amount, method }) => {
    const cash = method === PaymentMethod.cash;
    return {
      cafeId, actorId, amount, kind: 'sale' as const, sourceKey: 'sale:' + id,
      accountId: cash ? shift?.accountId ?? accounts.cash.id : accounts.noncash.id,
      cashShiftId: cash ? shift?.id : null, occurredAt: now, note: 'Оплата заказа',
    };
  });
  if (data.length) await tx.financeEntry.createMany({ data, skipDuplicates: true });
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
  if (sales.some((sale) => sale.account.type === 'cash' && settings?.cashShiftsEnabled && shift?.accountId !== sale.accountId)) {
    throw new ConflictException('Для возврата наличных откройте смену на исходном кассовом счёте');
  }
  await tx.financeEntry.createMany({
    data: sales.map((sale) => ({
      cafeId, actorId, accountId: sale.accountId, kind: 'refund', amount: sale.amount.negated(),
      sourceKey: 'refund:' + sale.sourceKey, cashShiftId: shift?.accountId === sale.accountId ? shift.id : null,
      note: 'Отмена оплаты заказа',
    })),
    skipDuplicates: true,
  });
}
