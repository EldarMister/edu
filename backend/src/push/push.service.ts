import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import webpush, { PushSubscription as WebPushSubscription } from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { PushProvider, Role } from '@prisma/client';
import { PushSubscriptionDto, RegisterDeviceDto } from './dto';
import { cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  type?: 'info' | 'success' | 'error';
  orderId?: string;
  orderNumber?: string;
  url?: string;
  channel?: 'orders' | 'kitchen' | 'payments';
}

type NativeDevice = { pushToken: string | null; pushProvider: PushProvider };

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;
  private fcm: Messaging | null = null;

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

    this.configureFcm();
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

  async notifyRole(role: Role, payload: PushPayload, cafeId?: string | null) {
    const userWhere = { role, isActive: true, ...(cafeId ? { cafeId } : {}) };
    // Native push для роли (мобильные устройства).
    const devices = await this.prisma.userDevice.findMany({
      where: { isActive: true, pushToken: { not: null }, user: userWhere },
      select: { pushToken: true, pushProvider: true },
    });
    await this.sendNativeToDevices(devices, {
      ...payload,
      channel: payload.channel ?? (role === Role.KITCHEN || role === Role.BAR ? 'kitchen' : 'orders'),
    });

    if (!this.configured) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { user: userWhere },
    });
    await this.sendToSubscriptions(subscriptions, payload);
  }

  // ---------- Native push (Expo legacy + Kotlin/FCM) ----------

  /** Регистрирует/обновляет мобильное устройство для native push. */
  async registerDevice(userId: string, dto: RegisterDeviceDto) {
    await this.prisma.userDevice.upsert({
      where: { pushToken: dto.pushToken },
      update: {
        userId,
        platform: dto.platform,
        pushProvider: dto.provider ?? PushProvider.EXPO,
        deviceId: dto.deviceId,
        appVersion: dto.appVersion,
        isActive: true,
      },
      create: {
        userId,
        pushToken: dto.pushToken,
        platform: dto.platform,
        pushProvider: dto.provider ?? PushProvider.EXPO,
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
      select: { pushToken: true, pushProvider: true },
    });
    await this.sendNativeToDevices(devices, payload);
  }

  private async sendNativeToDevices(devices: NativeDevice[], payload: PushPayload) {
    const expoTokens = devices
      .filter((device) => device.pushProvider === PushProvider.EXPO)
      .map((device) => device.pushToken)
      .filter((token): token is string => !!token);
    const fcmTokens = devices
      .filter((device) => device.pushProvider === PushProvider.FCM)
      .map((device) => device.pushToken)
      .filter((token): token is string => !!token);

    await Promise.all([
      this.sendExpo(expoTokens, payload),
      this.sendFcm(fcmTokens, payload),
    ]);
  }

  /** Отправка через Expo Push API для существующих RN-устройств. */
  private async sendExpo(tokens: string[], payload: PushPayload) {
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
        channel: payload.channel,
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

  /** FCM HTTP v1 через Firebase Admin SDK. Multicast ограничен 500 токенами. */
  private async sendFcm(tokens: string[], payload: PushPayload) {
    if (tokens.length === 0) return;
    if (!this.fcm) {
      this.logger.warn('FCM push skipped: Firebase service account is not configured.');
      return;
    }

    const data = Object.fromEntries(
      Object.entries({
        type: payload.type,
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        url: payload.url,
      })
        .filter((entry): entry is [string, string] => entry[1] != null)
        .map(([key, value]) => [key, String(value)]),
    );
    const channelId = `${payload.channel ?? 'orders'}_v4`;

    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      try {
        const response = await this.fcm.sendEachForMulticast({
          tokens: batch,
          notification: { title: payload.title, body: payload.body },
          data,
          android: {
            priority: 'high',
            collapseKey: payload.orderId ? `order-${payload.orderId}` : undefined,
            notification: { channelId, sound: 'default' },
          },
        });
        const invalid = response.responses.flatMap((result, index) => {
          const code = result.error?.code;
          return code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
            ? [batch[index]]
            : [];
        });
        if (invalid.length > 0) {
          await this.prisma.userDevice.deleteMany({ where: { pushToken: { in: invalid } } });
        }
      } catch (err) {
        this.logger.warn(`FCM push error: ${(err as Error).message}`);
      }
    }
  }

  private configureFcm() {
    const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!base64 && !json) {
      this.logger.warn(
        'FCM is disabled: set FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_SERVICE_ACCOUNT_JSON.',
      );
      return;
    }

    try {
      const raw = base64 ? Buffer.from(base64, 'base64').toString('utf8') : json!;
      const parsed = JSON.parse(raw) as Record<string, string>;
      const account: ServiceAccount = {
        projectId: parsed.project_id ?? parsed.projectId,
        clientEmail: parsed.client_email ?? parsed.clientEmail,
        privateKey: (parsed.private_key ?? parsed.privateKey)?.replace(/\\n/g, '\n'),
      };
      const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
      this.fcm = getMessaging(app);
    } catch (err) {
      this.logger.error(`FCM initialization failed: ${(err as Error).message}`);
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
