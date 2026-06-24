import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import webpush, { PushSubscription as WebPushSubscription } from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { PushSubscriptionDto, RegisterDeviceDto } from './dto';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

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
    // Native push (мобильное приложение) работает независимо от Web Push (VAPID).
    await this.sendNativeToUsers([userId], payload);

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
    // Native push для роли (мобильные устройства).
    const devices = await this.prisma.userDevice.findMany({
      where: { isActive: true, pushToken: { not: null }, user: { role, isActive: true } },
      select: { pushToken: true },
    });
    await this.sendNativeToTokens(
      devices.map((d) => d.pushToken).filter((t): t is string => !!t),
      payload,
    );

    if (!this.configured) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { user: { role, isActive: true } },
    });
    await this.sendToSubscriptions(subscriptions, payload);
  }

  // ---------- Native push (React Native через Expo Push) ----------

  /** Регистрирует/обновляет мобильное устройство для native push. */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    await this.prisma.userDevice.upsert({
      where: { pushToken: dto.pushToken },
      update: {
        userId,
        platform: dto.platform,
        deviceId: dto.deviceId,
        appVersion: dto.appVersion,
        isActive: true,
      },
      create: {
        userId,
        pushToken: dto.pushToken,
        platform: dto.platform,
        deviceId: dto.deviceId,
        appVersion: dto.appVersion,
      },
    });
    return { ok: true };
  }

  /** Отключает устройство (при logout). */
  async unregisterDevice(userId: string, pushToken: string) {
    await this.prisma.userDevice.deleteMany({ where: { userId, pushToken } });
    return { ok: true };
  }

  private async sendNativeToUsers(userIds: string[], payload: PushPayload) {
    const devices = await this.prisma.userDevice.findMany({
      where: { userId: { in: userIds }, isActive: true, pushToken: { not: null } },
      select: { pushToken: true },
    });
    await this.sendNativeToTokens(
      devices.map((d) => d.pushToken).filter((t): t is string => !!t),
      payload,
    );
  }

  /** Отправка через Expo Push API. Токены вида ExponentPushToken[...]. */
  private async sendNativeToTokens(tokens: string[], payload: PushPayload) {
    if (tokens.length === 0) return;

    const messages = tokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      sound: 'default',
      priority: 'high',
      data: {
        type: payload.type,
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        url: payload.url,
      },
    }));

    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push failed: HTTP ${res.status}`);
        return;
      }
      // Деактивируем устройства с невалидными токенами (DeviceNotRegistered).
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      const tickets = json.data ?? [];
      const deadTokens = tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
      if (deadTokens.length > 0) {
        await this.prisma.userDevice
          .deleteMany({ where: { pushToken: { in: deadTokens } } })
          .catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(`Expo push error: ${(err as Error).message}`);
    }
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
