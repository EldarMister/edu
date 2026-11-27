import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RefundPart } from '../orders/order-refund-plan';
import { refundCashCustody } from './cash-custody';
import { assertDrawerBalance, ensureFinanceAccounts, lockFinance } from './finance-ledger';

export async function recordRefundReceipts(
  tx: Prisma.TransactionClient, cafeId: string, actorId: string, refundId: string,
  orderNumber: string, parts: RefundPart[], now: Date,
) {
  if (!parts.length) return;
  await lockFinance(tx, cafeId);
  const saleKeys = parts.flatMap((part) => part.paymentId ? ['sale:' + part.paymentId] : []);
  const [sales, settings, shift] = await Promise.all([
    tx.financeEntry.findMany({
      where: { cafeId, kind: 'sale', sourceKey: { in: saleKeys } },
      select: { cafeId: true, sourceKey: true, accountId: true, cashCustodianId: true, cashCustodyDay: true },
    }),
    tx.settings.findFirst({ where: { cafeId }, select: { cashShiftsEnabled: true } }),
    tx.cashShift.findFirst({ where: { cafeId, closedAt: null } }),
  ]);
  const saleByKey = new Map(sales.map((sale) => [sale.sourceKey, sale]));
  const remainingByDay = new Map<string, Prisma.Decimal>();
  const data: Prisma.FinanceEntryCreateManyInput[] = [];
  let drawerChange = new Prisma.Decimal(0);
  for (const [index, part] of parts.entries()) {
    const sale = saleByKey.get('sale:' + part.paymentId);
    const cash = part.method === 'cash';
    const amount = new Prisma.Decimal(part.amount);
    const custody = cash ? await refundCashCustody(tx, sale, amount, remainingByDay) : new Prisma.Decimal(0);
    const ledgerAmount = amount.sub(custody);
    const base = {
      cafeId, actorId, kind: 'refund' as const, sourceKey: 'refund:' + refundId + ':' + index, paymentMethod: part.method,
      occurredAt: shift && now < shift.openedAt ? shift.openedAt : now, note: 'Возврат по заказу ' + orderNumber,
    };
    if (!ledgerAmount.isZero()) {
      if (cash && settings?.cashShiftsEnabled && !shift) {
        throw new ConflictException('Для возврата наличных откройте кассовую смену');
      }
      const originalAccountId = sale?.cashCustodianId ? undefined : sale?.accountId;
      let accountId = originalAccountId ?? (cash ? shift?.accountId : undefined);
      if (!accountId) {
        const accounts = await ensureFinanceAccounts(tx, cafeId);
        accountId = cash ? accounts.cash.id : accounts.noncash.id;
      }
      if (cash && settings?.cashShiftsEnabled && shift?.accountId !== accountId) {
        throw new ConflictException('Для возврата наличных откройте смену на исходном кассовом счёте');
      }
      if (cash && shift?.accountId === accountId) drawerChange = drawerChange.sub(ledgerAmount);
      data.push({ ...base, accountId, amount: ledgerAmount.negated(), cashShiftId: shift?.id, pendingCashShift: !!shift });
    }
    if (sale && custody.gt(0)) data.push({
      ...base, sourceKey: ledgerAmount.isZero() ? base.sourceKey : base.sourceKey + ':custody',
      accountId: sale.accountId, cashCustodianId: sale.cashCustodianId, cashCustodyDay: sale.cashCustodyDay,
      amount: custody.negated(), occurredAt: now,
    });
  }
  if (shift) await assertDrawerBalance(tx, shift, drawerChange);
  await tx.financeEntry.createMany({ data });
}
