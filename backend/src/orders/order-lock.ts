import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';

/** Shared serialization point for cooking, editing, cancellation and payment. Always reread after acquiring it. */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const cafeId = getCafeId();
  const rows = cafeId
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} AND cafe_id = ${cafeId} FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('Заказ не найден');
}
