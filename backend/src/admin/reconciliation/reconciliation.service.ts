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

const DAY_MS = 86_400_000;
const BISHKEK_UTC_OFFSET_MIN = 6 * 60;
const BISHKEK_UTC_OFFSET_MS = BISHKEK_UTC_OFFSET_MIN * 60_000;

function bishkekDayStartUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - BISHKEK_UTC_OFFSET_MS);
}

function parseBusinessDate(value: string | undefined, fallback: Date): Date {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return bishkekDayStartUtc(Number(m[1]), Number(m[2]), Number(m[3]));

  const bishkek = new Date(fallback.getTime() + BISHKEK_UTC_OFFSET_MS);
  return bishkekDayStartUtc(
    bishkek.getUTCFullYear(),
    bishkek.getUTCMonth() + 1,
    bishkek.getUTCDate(),
  );
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
    const from = parseBusinessDate(body.from, new Date(today.getTime() - 6 * DAY_MS));
    const to = parseBusinessDate(body.to, today);
    const toEnd = new Date(to.getTime() + DAY_MS); // включительно по день
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
      waiter: o.waiter?.name ?? 'QR-меню',
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
