import { Prisma, DiscountType, PaymentStatus } from '@prisma/client';

/** Полный набор связей заказа для ответа API и real-time payload. */
export const orderInclude = {
  table: { select: { id: true, number: true, seats: true, hallId: true, status: true, hall: { select: { name: true } } } },
  waiter: { select: { id: true, name: true } },
  payments: {
    where: { status: PaymentStatus.paid },
    select: { method: true, amount: true, source: true },
    orderBy: { paidAt: 'asc' as const },
  },
  items: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      dishId: true,
      dishVariantId: true,
      dishNameSnapshot: true,
      dishVariantNameSnapshot: true,
      dishVoiceSnapshot: true,
      priceSnapshot: true,
      quantity: true,
      discountAmount: true,
      finalPrice: true,
      status: true,
      prepStation: true,
      comment: true,
      takeaway: true,
      rejectReason: true,
      setComponents: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          id: true,
          action: true,
          status: true,
          rejectReason: true,
          originalDishId: true,
          originalNameSnapshot: true,
          originalVariantNameSnapshot: true,
          finalDishId: true,
          finalNameSnapshot: true,
          quantity: true,
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

/** Считает цену единицы блюда с учётом скидки. */
export function unitPricing(
  price: Prisma.Decimal,
  discountType: DiscountType,
  discountValue: Prisma.Decimal,
): { unit: number; unitDiscount: number; unitFinal: number } {
  const unit = Number(price);
  const value = Number(discountValue);
  let unitDiscount = 0;

  if (discountType === DiscountType.percent) {
    unitDiscount = (unit * value) / 100;
  } else if (discountType === DiscountType.fixed) {
    unitDiscount = value;
  }
  unitDiscount = Math.max(0, Math.min(unitDiscount, unit));
  const unitFinal = unit - unitDiscount;
  return { unit, unitDiscount, unitFinal: Math.max(0, unitFinal) };
}

/** Округление до 2 знаков. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
