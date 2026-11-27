import { PaymentMethod, Prisma, type CashShift } from '@prisma/client';

export const processingFeeSourcePrefix = 'cash-processing-fee:';
export const processingFeeCategory = 'Банковское обслуживание и комиссии';
export const processingFeeCategoryKey = 'payment-processing-fees';

/** Caller owns the finance lock and the transaction that closes the shift. */
export async function postPaymentProcessingFees(
  tx: Prisma.TransactionClient,
  shift: Pick<CashShift, 'id' | 'cafeId' | 'cardProcessingFeeRate' | 'qrProcessingFeeRate'>,
  actorId: string,
  occurredAt: Date,
) {
  const rates = {
    [PaymentMethod.card]: shift.cardProcessingFeeRate,
    [PaymentMethod.qr]: shift.qrProcessingFeeRate,
  };
  const methods = ([PaymentMethod.card, PaymentMethod.qr] as const).filter((method) => rates[method].gt(0));
  if (!methods.length) return;

  const turnover = await tx.financeEntry.groupBy({
    by: ['accountId', 'paymentMethod'],
    where: {
      cafeId: shift.cafeId,
      cashShiftId: shift.id,
      account: { type: 'noncash' },
      kind: { in: ['sale', 'refund'] },
      paymentMethod: { in: methods },
    },
    _sum: { amount: true },
  });
  const fees = turnover.flatMap(({ paymentMethod, accountId, _sum }) => {
    if (paymentMethod !== PaymentMethod.card && paymentMethod !== PaymentMethod.qr) return [];
    const base = _sum.amount;
    if (!base?.gt(0)) return [];
    const rate = rates[paymentMethod];
    const amount = base.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (amount.isZero()) return [];
    return [{ accountId, paymentMethod, base, rate, amount }];
  });
  if (!fees.length) return;

  const { cafeId } = shift;
  let category = await tx.financeCategory.findUnique({
    where: { cafeId_systemKey: { cafeId, systemKey: processingFeeCategoryKey } },
    select: { id: true },
  });
  if (!category) {
    const existing = await tx.financeCategory.findMany({ where: { cafeId }, select: { name: true } });
    const names = new Set(existing.map(({ name }) => name.toLocaleLowerCase('ru')));
    let name = processingFeeCategory;
    for (let suffix = 2; names.has(name.toLocaleLowerCase('ru')); suffix++) name = `${processingFeeCategory} (${suffix})`;
    category = await tx.financeCategory.create({
      data: { cafeId, kind: 'expense', name, systemKey: processingFeeCategoryKey },
      select: { id: true },
    });
  }
  await tx.financeEntry.createMany({
    data: fees.map(({ accountId, amount, base, paymentMethod, rate }) => ({
      cafeId,
      accountId,
      actorId,
      cashShiftId: shift.id,
      categoryId: category.id,
      kind: 'expense',
      amount: amount.negated(),
      paymentMethod,
      occurredAt,
      sourceKey: `${processingFeeSourcePrefix}${shift.id}:${paymentMethod}:${accountId}`,
      note: `${paymentMethod === PaymentMethod.card ? 'Карта' : 'QR'} · ${rate.toString().replace('.', ',')}% от ${base.toFixed(2).replace('.', ',')} с`,
    })),
    skipDuplicates: true,
  });
}
