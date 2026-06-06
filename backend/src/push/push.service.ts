import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import webpush, { PushSubscription as WebPushSubscription } from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { PushSubscriptionDto } from './dto';

export interface PushPayload {
  title: string;
  body: string;
  type?: 'info' | 'success' | 'error';
  orderId?: string;
  orderNumber?: string;
  url?: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(private prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@edupos.local';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
    } else {
      this.logger.warn('Web Push is disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
    }
  }

  getPublicKey() {
    return { enabled: this.configured, publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
  }

  async subscribe(userId: string, dto: PushSubscriptionDto) {
    if (!this.configured) {
      throw new BadRequestException('Push-уведомления не настроены на сервере');
    }

    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: {
        userId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent,
      },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent,
      },
    });

    return { ok: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { ok: true };
  }

  async notifyUser(userId: string, payload: PushPayload) {
    if (!this.configured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    await this.sendToSubscriptions(subscriptions, payload);
  }

  async notifyWaiter(waiterId: string, payload: PushPayload) {
    return this.notifyUser(waiterId, payload);
  }

  async notifyRole(role: Role, payload: PushPayload) {
    if (!this.configured) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { user: { role, isActive: true } },
    });
    await this.sendToSubscriptions(subscriptions, payload);
  }

  private async sendToSubscriptions(
    subscriptions: { endpoint: string; p256dh: string; auth: string }[],
    payload: PushPayload,
  ) {
    if (subscriptions.length === 0) return;

    await Promise.all(
      subscriptions.map(async (sub) => {
        const pushSub: WebPushSubscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };

        try {
          await webpush.sendNotification(pushSub, JSON.stringify(payload));
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => undefined);
            return;
          }
          this.logger.warn(`Failed to send push notification: ${statusCode ?? 'unknown error'}`);
        }
      }),
    );
  }
}
