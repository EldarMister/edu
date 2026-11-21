import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RefundPart } from '../orders/order-refund-plan';
import { assertDrawerBalance, ensureFinanceAccounts, lockFinance } from './finance-ledger';

export async function recordRefundReceipts(
  tx: Prisma.TransactionClient, cafeId: string, actorId: string, refundId: string,
  orderNumber: string, parts: RefundPart[], now: Date,
) {
  if (!parts.length) return;
  await lockFinance(tx, cafeId);
  const sales = await tx.financeEntry.findMany({
    where: { cafeId, kind: 'sale', sourceKey: { in: parts.flatMap((part) => part.paymentId ? ['sale:' + part.paymentId] : []) } },
    select: { sourceKey: true, accountId: true },
  });
  const saleAccounts = new Map(sales.map((sale) => [sale.sourceKey, sale.accountId]));
  const settings = await tx.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true } });
  const shift = await tx.cashShift.findFirst({ where: { cafeId, closedAt: null } });
  const hasCash = parts.some((part) => part.method === 'cash');
  if (hasCash && settings?.cashShiftsEnabled && !shift) {
    throw new ConflictException('Для возврата наличных откройте кассовую смену');
  }

  const defaultAccounts = parts.some((part) => !saleAccounts.has('sale:' + part.paymentId) && !(part.method === 'cash' && shift))
    ? await ensureFinanceAccounts(tx, cafeId) : null;
  const data = parts.map((part, index) => {
    const cash = part.method === 'cash';
    const accountId = saleAccounts.get('sale:' + part.paymentId)
      ?? (cash ? shift?.accountId ?? defaultAccounts!.cash.id : defaultAccounts!.noncash.id);
    if (cash && settings?.cashShiftsEnabled && shift?.accountId !== accountId) {
      throw new ConflictException('Для возврата наличных откройте смену на исходном кассовом счёте');
    }
    return {
      cafeId, actorId, accountId, kind: 'refund' as const, amount: new Prisma.Decimal(part.amount).negated(),
      sourceKey: 'refund:' + refundId + ':' + index, cashShiftId: shift?.id, pendingCashShift: !!shift,
      occurredAt: shift && now < shift.openedAt ? shift.openedAt : now, note: 'Возврат по заказу ' + orderNumber,
    };
  });
  if (hasCash && shift) {
    const cashChange = data.filter(({ accountId }) => accountId === shift.accountId)
      .reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
    await assertDrawerBalance(tx, shift, cashChange);
  }
  await tx.financeEntry.createMany({ data });
}
