import { Prisma } from '@prisma/client';

type Money = Prisma.Decimal | number | string;

/** Split cents by weight, assigning any remainder in a stable order. */
export function allocateCents(amount: number, weights: number[]) {
  const denominator = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  if (!amount || !denominator) return weights.map(() => 0);
  const rows = weights.map((weight, index) => {
    const numerator = BigInt(weight) * BigInt(amount);
    return { index, amount: Number(numerator / denominator), remainder: numerator % denominator };
  });
  const extra = amount - rows.reduce((sum, row) => sum + row.amount, 0);
  const ranked = rows.slice().sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < extra; index++) ranked[index].amount++;
  return rows.map((row) => row.amount);
}

export function allocateOrderItemCents(payable: Money, items: readonly { finalPrice: Money; quantity: number }[]) {
  const weights = items.map((item) => Math.max(0, new Prisma.Decimal(item.finalPrice).mul(100).round().toNumber()));
  return allocateCents(new Prisma.Decimal(payable).mul(100).round().toNumber(),
    weights.some((weight) => weight > 0) ? weights : items.map((item) => item.quantity));
}

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
