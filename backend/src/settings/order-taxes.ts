import { BadRequestException } from '@nestjs/common';
import { MenuTaxType, OrderItemStatus, Prisma } from '@prisma/client';
import { allocateCents } from '../orders/order-net';
import { getCafeId } from '../tenant/tenant-context';

const rateSelect = { id: true, cafeId: true, name: true, type: true, rate: true } as const;
type Rate = Prisma.MenuTaxGetPayload<{ select: typeof rateSelect }>;
type SaleItem = { id: string; dishId: string | null; status: OrderItemStatus; finalPrice: Prisma.Decimal };
type TaxableLine = { rate: Rate; salesAmount: Prisma.Decimal };

export const receiptTaxes = {
  where: { reversedAt: null },
  select: { id: true, name: true, type: true, rate: true, salesAmount: true, amount: true },
  orderBy: [{ name: 'asc' }, { id: 'asc' }],
} satisfies Prisma.Order$taxesArgs;

export async function assertMenuTax(tx: Prisma.TransactionClient, taxId?: string | null) {
  if (taxId == null) return;
  const exists = await tx.menuTax.findFirst({
    where: { id: taxId, cafeId: getCafeId() ?? null },
    select: { id: true },
  });
  if (!exists) throw new BadRequestException('Налог не найден');
}

export async function dishTaxFields(tx: Prisma.TransactionClient, { taxId, taxExempt }: { taxId?: string | null; taxExempt?: boolean }) {
  if (taxExempt === true) {
    if (taxId) throw new BadRequestException('Выберите налог или режим «Без налога»');
    return { taxId: null, taxExempt: true };
  }
  await assertMenuTax(tx, taxId);
  return { taxId, taxExempt: taxId !== undefined ? false : taxExempt ?? undefined };
}

// The taxable base is the actual selling price after discounts, grouped by rate on the receipt.
export function calculateSaleTaxes(lines: TaxableLine[]) {
  const totals = new Map<string, TaxableLine>();
  for (const line of lines) {
    if (!line.salesAmount.gt(0)) continue;
    const previous = totals.get(line.rate.id);
    totals.set(line.rate.id, previous ? { ...previous, salesAmount: previous.salesAmount.add(line.salesAmount) } : line);
  }
  return [...totals.values()].map(({ rate, salesAmount }) => {
    const divisor = rate.type === MenuTaxType.vat ? rate.rate.add(100) : 100;
    return {
      taxId: rate.id, name: rate.name, rate: rate.rate, type: rate.type, salesAmount,
      amount: salesAmount.mul(rate.rate).div(divisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    };
  }).filter((row) => row.salesAmount.gt(0));
}

export async function recordOrderTaxes(
  tx: Prisma.TransactionClient, orderId: string, cafeId: string | null, items: SaleItem[], soldAt: Date,
  roundedPayable?: Prisma.Decimal,
) {
  const active = items.filter((item) => item.status !== 'cancelled' && item.status !== 'rejected');
  const dishIds = [...new Set(active.flatMap(({ dishId }) => dishId ? [dishId] : []))];
  if (!dishIds.length) return;
  const settings = await tx.settings.findFirst({ where: { cafeId }, select: { taxesEnabled: true } });
  if (!settings?.taxesEnabled) return;
  const dishes = await tx.dish.findMany({
    where: { cafeId, id: { in: dishIds } },
    select: { id: true, taxExempt: true, tax: { select: rateSelect }, category: { select: { tax: { select: rateSelect } } } },
  });
  const rates = new Map(dishes.map((dish) => [dish.id, dish.taxExempt ? null : (dish.tax ?? dish.category.tax)]));
  const prorated = roundedPayable === undefined ? null : allocateCents(roundedPayable.mul(100).round().toNumber(),
    active.map(({ finalPrice }) => Math.max(0, finalPrice.mul(100).round().toNumber())));
  const lines = active.flatMap((item, index) => {
    const rate = item.dishId ? rates.get(item.dishId) : null;
    const salesAmount = prorated ? new Prisma.Decimal(prorated[index]).div(100) : item.finalPrice;
    return rate && rate.cafeId === cafeId && salesAmount.gt(0) ? [{ itemId: item.id, rate, salesAmount }] : [];
  });
  const itemAmountsByTax = new Map<string, Record<string, string>>();
  for (const { itemId, rate, salesAmount } of lines) {
    const itemAmounts = itemAmountsByTax.get(rate.id) ?? {};
    itemAmounts[itemId] = salesAmount.toString();
    itemAmountsByTax.set(rate.id, itemAmounts);
  }
  const snapshot = calculateSaleTaxes(lines);
  if (snapshot.length) {
    await tx.orderTax.createMany({ data: snapshot.map((line) => ({ ...line, orderId, cafeId, soldAt, itemAmounts: itemAmountsByTax.get(line.taxId) })) });
  }
}
