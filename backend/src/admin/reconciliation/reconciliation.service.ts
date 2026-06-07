import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseStatement } from './statement-parser';
import { reconcile } from './matcher';
import type { OrderLite, ReconResult } from './reconciliation.types';

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

@Injectable()
export class ReconciliationService {
  constructor(private prisma: PrismaService) {}

  async reconcile(
    file: UploadedFileLike | undefined,
    body: { from?: string; to?: string; toleranceMin?: string },
  ): Promise<ReconResult> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Файл выписки не загружен');
    }

    const today = new Date();
    const from = startOfDay(parseDate(body.from, new Date(today.getTime() - 6 * 86_400_000)));
    const to = parseDate(body.to, today);
    const toEnd = new Date(startOfDay(to).getTime() + 86_400_000); // включительно по день
    const toleranceMin = clampTolerance(Number(body.toleranceMin));

    // Только оплаченные заказы периода, проходящие через банк (нал не попадает в выписку).
    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.paid,
        closedAt: { gte: from, lt: toEnd },
        OR: [{ paymentMethod: { in: ['qr', 'card'] } }, { paymentMethod: null }],
      },
      select: {
        id: true,
        orderNumber: true,
        finalAmount: true,
        paymentMethod: true,
        closedAt: true,
        createdAt: true,
        comment: true,
        waiter: { select: { name: true } },
      },
      orderBy: { closedAt: 'asc' },
    });

    const orderLites: OrderLite[] = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      time: o.closedAt ?? o.createdAt,
      amount: Number(o.finalAmount),
      paymentMethod: o.paymentMethod,
      waiter: o.waiter.name,
      comment: o.comment,
    }));

    const ops = await parseStatement(file.buffer, file.originalname, file.mimetype);
    if (ops.length === 0) {
      throw new BadRequestException(
        'В файле не найдено операций с датой и суммой. Проверьте формат выписки.',
      );
    }

    const result = reconcile(orderLites, ops, toleranceMin);
    result.from = from.toISOString();
    result.to = to.toISOString();
    return result;
  }
}

function clampTolerance(min: number): number {
  if (!Number.isFinite(min)) return 3;
  return Math.min(60, Math.max(1, Math.round(min)));
}
