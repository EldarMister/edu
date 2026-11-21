import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MenuTaxType, OrderItemStatus, OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import type { OrderRefundSelectionDto } from './dto/order-refund.dto';
import { allocateCents, allocateOrderItemCents } from './order-net';

export const refundOrderInclude = {
  table: { select: { number: true } },
  items: {
    where: { status: { notIn: [OrderItemStatus.cancelled, OrderItemStatus.rejected] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, dishNameSnapshot: true, dishVariantNameSnapshot: true, finalPrice: true, quantity: true,
      refundedQuantity: true, stockSourceLineId: true, updatedAt: true,
    },
  },
  payments: {
    where: { status: PaymentStatus.paid },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    select: { id: true, method: true, amount: true, refundedAmount: true },
  },
  taxes: {
    where: { reversedAt: null },
    orderBy: { taxId: 'asc' },
    select: { id: true, taxId: true, name: true, rate: true, type: true, salesAmount: true, amount: true, itemAmounts: true },
  },
} satisfies Prisma.OrderInclude;

export type RefundOrder = Prisma.OrderGetPayload<{ include: typeof refundOrderInclude }>;
type RefundOrderItem = RefundOrder['items'][number];
type RefundTax = RefundOrder['taxes'][number];

export type RefundPart = {
  paymentId: string | null;
  method: Exclude<PaymentMethod, 'mixed'>;
  amount: string;
};

export type RefundLine = {
  itemId: string;
  name: string;
  quantity: number;
  amount: string;
};

export type RefundTaxReversal = {
  taxId: string;
  name: string;
  type: MenuTaxType;
  rate: string;
  salesAmount: string;
  amount: string;
};

export function requiresFiscalRefund(order: Pick<RefundOrder, 'fiscalizedAt' | 'fiscalReceiptNumber'>) {
  return Boolean(order.fiscalizedAt || (order.fiscalReceiptNumber && !order.fiscalReceiptNumber.startsWith('MOCK-')));
}

const cents = (amount: Prisma.Decimal) => amount.mul(100).round().toNumber();
const money = (amount: number) => new Prisma.Decimal(amount).div(100).toFixed(2);
const proportionalCents = (amount: number, quantity: number, total: number) =>
  new Prisma.Decimal(amount).mul(quantity).div(total).round().toNumber();

function calculatePaymentParts(order: RefundOrder, credit: number, remaining: number): RefundPart[] {
  if (!credit) return [];
  if (!order.payments.length && order.paymentMethod && order.paymentMethod !== 'mixed') {
    return [{ paymentId: null, method: order.paymentMethod, amount: money(credit) }];
  }
  const payments = order.payments.flatMap((payment) => {
    if (payment.method === PaymentMethod.mixed) return [];
    const available = cents(payment.amount.sub(payment.refundedAmount));
    return available > 0 ? [{ paymentId: payment.id, method: payment.method, available }] : [];
  });
  if (payments.reduce((sum, payment) => sum + payment.available, 0) !== remaining) {
    throw new ConflictException('В чеке не сходятся суммы исходных оплат. Проверьте платежи заказа.');
  }
  const amounts = allocateCents(credit, payments.map((payment) => payment.available));
  return payments.flatMap(({ paymentId, method }, index) =>
    amounts[index] > 0 ? [{ paymentId, method, amount: money(amounts[index]) }] : []);
}

function historicalTaxBases(order: RefundOrder, tax: RefundTax, wholeOrder: boolean) {
  if (tax.itemAmounts && typeof tax.itemAmounts === 'object' && !Array.isArray(tax.itemAmounts)) {
    return new Map(Object.entries(tax.itemAmounts).map(([id, amount]) => [id, new Prisma.Decimal(String(amount))]));
  }

  // Older checks only have totals by rate. A single rate covering the entire check is unambiguous.
  const total = order.items.reduce((sum, item) => sum.add(item.finalPrice), new Prisma.Decimal(0));
  const factor = order.roundingAmount.gt(0)
    ? order.finalAmount.div(order.finalAmount.add(order.roundingAmount)) : new Prisma.Decimal(1);
  if (order.taxes.length === 1 && total.mul(factor).toDecimalPlaces(2).eq(tax.salesAmount)) {
    return new Map(order.items.map((item) => [item.id, item.finalPrice]));
  }
  if (wholeOrder && order.items.every((item) => item.refundedQuantity === 0)) return null;
  throw new ConflictException('В этом старом чеке налоги сохранены только по заказу. Для него доступен возврат всего заказа.');
}

function calculateTaxReversals(order: RefundOrder, lines: RefundLine[], wholeOrder: boolean): RefundTaxReversal[] {
  const quantities = new Map(lines.map((line) => [line.itemId, line.quantity]));
  return order.taxes.flatMap((tax) => {
    const bases = historicalTaxBases(order, tax, wholeOrder);
    let salesAmount = tax.salesAmount;
    let amount = tax.amount;
    if (bases) {
      const total = [...bases.values()].reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
      let before = new Prisma.Decimal(0);
      let after = new Prisma.Decimal(0);
      if (total.isZero()) return [];
      for (const item of order.items) {
        const base = bases.get(item.id);
        if (!base || !item.quantity) continue;
        before = before.add(base.mul(item.refundedQuantity).div(item.quantity));
        after = after.add(base.mul(item.refundedQuantity + (quantities.get(item.id) ?? 0)).div(item.quantity));
      }
      const delta = (original: Prisma.Decimal) => original.mul(after).div(total).toDecimalPlaces(2)
        .sub(original.mul(before).div(total).toDecimalPlaces(2));
      salesAmount = delta(salesAmount);
      amount = delta(amount);
    }
    return salesAmount.isZero() && amount.isZero() ? [] : [{
      taxId: tax.taxId, name: tax.name, type: tax.type, rate: tax.rate.toString(),
      salesAmount: salesAmount.toFixed(2), amount: amount.toFixed(2),
    }];
  });
}

function getRefundSelection(order: RefundOrder, selected: OrderRefundSelectionDto): { item: RefundOrderItem; quantity: number }[] {
  if (!selected.itemId) {
    if (selected.quantity != null) throw new BadRequestException('Количество можно указать только для отдельной позиции');
    return order.items.filter((item) => item.quantity > item.refundedQuantity)
      .map((item) => ({ item, quantity: item.quantity - item.refundedQuantity }));
  }
  const item = order.items.find(({ id }) => id === selected.itemId);
  if (!item) throw new BadRequestException('Позиция отсутствует в оплаченных строках этого заказа');
  const available = item.quantity - item.refundedQuantity;
  const quantity = selected.quantity ?? available;
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > available) {
    throw new BadRequestException('Укажите количество в пределах остатка оплаченной позиции');
  }
  return [{ item, quantity }];
}

export function buildRefundPlan(order: RefundOrder, selected: OrderRefundSelectionDto) {
  if (order.status !== OrderStatus.paid || order.paymentStatus === PaymentStatus.cancelled) {
    throw new ConflictException('Возврат доступен для оплаченного заказа');
  }
  if (order.paymentStatus === PaymentStatus.refunded) throw new ConflictException('Заказ уже возвращён полностью');

  const wholeOrder = !selected.itemId;
  const remaining = cents(order.finalAmount.sub(order.refundedAmount));
  const selectedLines = getRefundSelection(order, selected);
  if (remaining < 0 || (!selectedLines.length && remaining === 0)) {
    throw new ConflictException('В заказе не осталось позиций для возврата');
  }
  const allocations = allocateOrderItemCents(order.finalAmount, order.items);
  const allocationById = new Map(order.items.map((item, index) => [item.id, allocations[index]]));
  const items: RefundLine[] = selectedLines.map(({ item, quantity }) => {
    const allocation = allocationById.get(item.id) ?? 0;
    const credit = proportionalCents(allocation, item.refundedQuantity + quantity, item.quantity)
      - proportionalCents(allocation, item.refundedQuantity, item.quantity);
    return {
      itemId: item.id,
      name: item.dishVariantNameSnapshot ? item.dishNameSnapshot + ' · ' + item.dishVariantNameSnapshot : item.dishNameSnapshot,
      quantity,
      amount: money(credit),
    };
  });
  const credit = wholeOrder ? remaining : items.reduce((sum, item) => sum + cents(new Prisma.Decimal(item.amount)), 0);
  if (credit > remaining) throw new ConflictException('Сумма возврата превышает остаток оплаты');
  const paymentParts = calculatePaymentParts(order, credit, remaining);
  const taxReversals = calculateTaxReversals(order, items, wholeOrder);
  const requireFiscalReference = requiresFiscalRefund(order);
  const amount = money(credit);
  const version = createHash('sha256').update(JSON.stringify([
    order.id, order.closedAt, order.refundedAmount.toString(), order.fiscalReceiptNumber, requireFiscalReference,
    selected.itemId ?? null, items, amount, paymentParts, taxReversals,
  ])).digest('hex');
  const fullyRefunded = credit === remaining && selectedLines.length === order.items.filter((item) => item.quantity > item.refundedQuantity).length
    && selectedLines.every(({ item, quantity }) => item.refundedQuantity + quantity === item.quantity);
  return { items, amount, paymentParts, taxReversals, version, requireFiscalReference, fullyRefunded };
}

export type RefundPlan = ReturnType<typeof buildRefundPlan>;
