import { Prisma } from '@prisma/client';

type Money = Prisma.Decimal | number | string;

export function netOrderAmount(order: { finalAmount: Money; refundedAmount?: Money | null }) {
  return new Prisma.Decimal(order.finalAmount).sub(order.refundedAmount ?? 0);
}

export function netPaymentAmount(payment: { amount: Money; refundedAmount?: Money | null }) {
  return new Prisma.Decimal(payment.amount).sub(payment.refundedAmount ?? 0);
}

export function netItemQuantity(item: { quantity: number; refundedQuantity?: number | null }) {
  return item.quantity - (item.refundedQuantity ?? 0);
}

export function netItemAmount(item: { quantity: number; refundedQuantity?: number | null }, original: Money) {
  const amount = new Prisma.Decimal(original);
  if (!item.quantity || !item.refundedQuantity) return amount;
  const returned = amount.mul(item.refundedQuantity).div(item.quantity).toDecimalPlaces(2);
  return amount.sub(returned);
}
