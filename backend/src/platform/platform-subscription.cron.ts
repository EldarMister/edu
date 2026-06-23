import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CafeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Авто-приостановка кафе, у которых истёк срок «оплачено до». */
@Injectable()
export class PlatformSubscriptionCron {
  private readonly logger = new Logger('PlatformSubscription');

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async autoSuspendExpired() {
    const res = await this.prisma.cafe.updateMany({
      where: { status: CafeStatus.active, paidUntil: { not: null, lt: new Date() } },
      data: {
        status: CafeStatus.suspended,
        suspendedAt: new Date(),
        suspendedReason: 'Не оплачено (срок истёк)',
      },
    });
    if (res.count > 0) {
      this.logger.warn(`Авто-приостановка: ${res.count} кафе с истёкшей подпиской`);
    }
  }
}
