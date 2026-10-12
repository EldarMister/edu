import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import webpush, { PushSubscription as WebPushSubscription } from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { PushProvider, Role } from '@prisma/client';
import { PushSubscriptionDto, RegisterDeviceDto } from './dto';
import { cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { Interval } from '@nestjs/schedule';
import { getCafeId } from '../tenant/tenant-context';
import { randomUUID } from 'node:crypto';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';

export interface PushPayload {
  notificationId?: string;
  at?: string;
  title: string;
  body: string;
  type?: 'info' | 'success' | 'error';
  orderId?: string;
  orderNumber?: string;
  url?: string;
  channel?: 'orders' | 'kitchen' | 'payments';
}

type NativeDevice = { pushToken: string | null; pushProvider: PushProvider; userId: string };

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;
  private fcm: Messaging | null = null;
  private expoReceipts = new Map<string, { token: string; at: number }>();
  private checkingReceipts = false;

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
    payload = { notificationId: randomUUID(), at: new Date().toISOString(), ...payload };
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
    payload = { notificationId: randomUUID(), at: new Date().toISOString(), ...payload };
    const tenantId = cafeId ?? getCafeId();
    const userWhere = { role, isActive: true, ...(tenantId ? { cafeId: tenantId } : {}) };
    // Native push для роли (мобильные устройства).
    const devices = await this.prisma.userDevice.findMany({
      where: { isActive: true, pushToken: { not: null }, user: userWhere },
      select: { pushToken: true, pushProvider: true, userId: true },
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
    const provider = dto.provider ?? PushProvider.EXPO;
    if (provider === PushProvider.EXPO && !/^(ExponentPushToken|ExpoPushToken)\[[\w-]+\]$/.test(dto.pushToken)) {
      throw new BadRequestException('Некорректный Expo push token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { cafeId: true } });
    await this.prisma.$transaction(async (tx) => {
      // One installation has one active token, even after rotation or account switching.
      if (dto.deviceId) {
        await tx.userDevice.deleteMany({ where: { deviceId: dto.deviceId, pushProvider: provider, pushToken: { not: dto.pushToken } } });
      }
      await tx.userDevice.upsert({
        where: { pushToken: dto.pushToken },
        update: {
          userId,
          cafeId: user?.cafeId,
          platform: dto.platform,
          pushProvider: dto.provider ?? PushProvider.EXPO,
          deviceId: dto.deviceId,
          appVersion: dto.appVersion,
          isActive: true,
        },
        create: {
          userId,
          cafeId: user?.cafeId,
          pushToken: dto.pushToken,
          platform: dto.platform,
          pushProvider: dto.provider ?? PushProvider.EXPO,
          deviceId: dto.deviceId,
          appVersion: dto.appVersion,
        },
      });
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
      where: { userId: { in: userIds }, isActive: true, pushToken: { not: null }, user: { isActive: true } },
      select: { pushToken: true, pushProvider: true, userId: true },
    });
    await this.sendNativeToDevices(devices, payload);
  }

  private async sendNativeToDevices(devices: NativeDevice[], payload: PushPayload) {
    const expoDevices = devices.filter((device) => device.pushProvider === PushProvider.EXPO && device.pushToken);
    const fcmDevices = devices
      .filter((device) => device.pushProvider === PushProvider.FCM);

    await Promise.all([
      this.sendExpo(expoDevices, payload),
      // A per-user data payload prevents taps for an old account opening the new account.
      ...[...new Set(fcmDevices.map((device) => device.userId))].map((userId) =>
        this.sendFcm(fcmDevices.filter((device) => device.userId === userId).map((device) => device.pushToken!).filter(Boolean), payload, userId)),
    ]);
  }

  /** Отправка через Expo Push API для существующих RN-устройств. */
  private async sendExpo(devices: NativeDevice[], payload: PushPayload) {
    if (devices.length === 0) return;
    for (let offset = 0; offset < devices.length; offset += 100) {
      const batch = devices.slice(offset, offset + 100);
      const tokens = batch.map((device) => device.pushToken!);

      const messages = batch.map((device) => ({
        to: device.pushToken,
        title: payload.title,
        body: payload.body,
        sound: payload.channel === 'kitchen' ? 'new_order.mp3' : payload.channel === 'payments' ? 'payment_sound.mp3' : 'notify.mp3',
        channelId: `${payload.channel ?? 'orders'}_v3`,
        priority: 'high',
        ttl: 3600,
        data: {
          notificationId: payload.notificationId,
          at: payload.at,
          recipientUserId: device.userId,
          type: payload.type,
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
          url: payload.url,
          channel: payload.channel,
        },
      }));

      try {
        const res = await this.requestExpo(EXPO_PUSH_ENDPOINT, messages);
        if (!res.ok) {
          this.logger.warn(`Expo push failed: HTTP ${res.status}`);
          continue;
        }
        // Деактивируем устройства с невалидными токенами (DeviceNotRegistered).
        const json = (await res.json()) as { data?: { status: string; id?: string; details?: { error?: string } }[] };
        const tickets = json.data ?? [];
        tickets.forEach((ticket, index) => {
          if (ticket.status === 'ok' && ticket.id) this.expoReceipts.set(ticket.id, { token: tokens[index], at: Date.now() });
          else if (ticket.status === 'error' && ticket.details?.error !== 'DeviceNotRegistered') this.logger.warn(`Expo push ticket: ${ticket.details?.error ?? 'unknown error'}`);
        });
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
  }

  /** FCM HTTP v1 через Firebase Admin SDK. Multicast ограничен 500 токенами. */
  private async sendFcm(tokens: string[], payload: PushPayload, recipientUserId: string) {
    if (tokens.length === 0) return;
    if (!this.fcm) {
      this.logger.warn('FCM push skipped: Firebase service account is not configured.');
      return;
    }

    const data = Object.fromEntries(
      Object.entries({
        recipientUserId,
        notificationId: payload.notificationId,
        at: payload.at,
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

  private expoHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Accept: 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) };
  }

  private async requestExpo(url: string, body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST', headers: this.expoHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
        });
        if (response.ok || attempt >= 2 || (response.status !== 429 && response.status < 500)) return response;
      } catch (error) { if (attempt >= 2) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }

  /** Tickets mean accepted, receipts report actual handoff to FCM/APNs. */
  @Interval(60_000)
  async checkExpoReceipts() {
    if (this.checkingReceipts || this.expoReceipts.size === 0) return;
    this.checkingReceipts = true;
    try {
      const now = Date.now();
      for (const [id, receipt] of this.expoReceipts) if (now - receipt.at > 24 * 60 * 60_000) this.expoReceipts.delete(id);
      const ids = [...this.expoReceipts].filter(([, receipt]) => now - receipt.at >= 60_000).slice(0, 1000).map(([id]) => id);
      if (!ids.length) return;
      const res = await this.requestExpo(EXPO_RECEIPTS_ENDPOINT, { ids });
      if (!res.ok) { this.logger.warn(`Expo receipts failed: HTTP ${res.status}`); return; }
      const json = await res.json() as { data?: Record<string, { status: string; details?: { error?: string } }> };
      for (const [id, receipt] of Object.entries(json.data ?? {})) {
        const token = this.expoReceipts.get(id)?.token;
        this.expoReceipts.delete(id);
        if (receipt.status === 'error') {
          if (receipt.details?.error === 'DeviceNotRegistered' && token) await this.prisma.userDevice.deleteMany({ where: { pushToken: token } });
          else this.logger.warn(`Expo push receipt: ${receipt.details?.error ?? 'unknown error'}`);
        }
      }
    } catch (error) { this.logger.warn(`Expo receipts error: ${(error as Error).message}`); }
    finally { this.checkingReceipts = false; }
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
