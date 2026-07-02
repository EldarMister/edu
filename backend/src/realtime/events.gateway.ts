import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ROOMS, SERVER_EVENTS, QR_CLIENT_EVENTS } from './events';
import { getJwtAccessSecret } from '../auth/jwt.config';
import { PrismaService } from '../prisma/prisma.service';
import { assertCafeActive } from '../platform/cafe-status';

const QR_OFFLINE_CART_TTL_MS = 60 * 60 * 1000;
const QR_OFFLINE_CART_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

interface SocketUser {
  id: string;
  role: string;
  cafeId: string | null;
}

/**
 * Единый шлюз реального времени.
 * Клиент подключается с JWT в auth.token; по роли его добавляют в нужные комнаты:
 *  - кухня → ROOMS.KITCHEN
 *  - официант → персональная комната waiter:<id>
 *  - админ/владелец → ROOMS.ADMIN
 *  - только админ → ROOMS.ADMIN_ONLY
 */
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('EventsGateway');
  private readonly qrPresence = new Map<string, number>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredOfflineGuestItems().catch((error: unknown) => {
        this.logger.error('Failed to cleanup expired QR guest items', error);
      });
    }, QR_OFFLINE_CART_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');

    if (!token) {
      // Гость QR-меню подключается без JWT. Он не входит ни в одну служебную комнату —
      // только в комнату своего стола после события qr:join (ниже).
      client.data.guest = true;
      this.logger.log(`Connected: QR guest (${client.id})`);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, {
        secret: getJwtAccessSecret(),
      });
      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, cafeId: true, isActive: true },
      });
      if (!dbUser || !dbUser.isActive) {
        client.disconnect(true);
        return;
      }
      await assertCafeActive(this.prisma, dbUser.cafeId);

      const user: SocketUser = { id: dbUser.id, role: dbUser.role, cafeId: dbUser.cafeId };
      client.data.user = user;

      if (user.role === 'KITCHEN' || user.role === 'BAR') {
        // Бар получает ту же ленту, что и кухня; экран фильтрует позиции по станции.
        client.join(ROOMS.KITCHEN);
      } else if (user.role === 'WAITER') {
        client.join(ROOMS.WAITERS);
        client.join(ROOMS.waiter(user.id));
      } else if (user.role === 'ADMIN' || user.role === 'OWNER') {
        client.join(ROOMS.ADMIN);
        client.join(ROOMS.KITCHEN); // админ видит и кухонную ленту
        if (user.role === 'ADMIN') client.join(ROOMS.ADMIN_ONLY);
      }

      this.logger.log(`Connected: ${user.role} ${user.id} (${client.id})`);
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const user = client.data.user as SocketUser | undefined;
    if (user) {
      this.logger.log(`Disconnected: ${user.role} ${user.id}`);
    }
    // Гость QR-меню вышел — сообщим столу, чтобы обновили счётчик/онлайн.
    const qr = client.data.qr as { tableId: string; guestKey?: string } | undefined;
    if (qr) {
      await this.releaseQrGuest(client);
    }
  }

  /** Гость QR-меню входит в комнату своего стола (tableId получен из публичного /menu). */
  @SubscribeMessage(QR_CLIENT_EVENTS.JOIN)
  async handleQrJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { tableId?: string; guestKey?: string },
  ) {
    const tableId = body?.tableId;
    if (!tableId) return { ok: false };
    if (client.data.qr) await this.releaseQrGuest(client, false);
    client.join(ROOMS.qrTable(tableId));
    client.data.qr = { tableId, guestKey: body.guestKey };
    await this.retainQrGuest(tableId, body.guestKey);
    this.server.to(ROOMS.qrTable(tableId)).emit(SERVER_EVENTS.QR_GUEST_JOINED, {
      tableId,
      guestKey: body.guestKey,
    });
    await this.emitQrSessionSnapshot(tableId);
    return { ok: true };
  }

  /** Гость покидает комнату стола. */
  @SubscribeMessage(QR_CLIENT_EVENTS.LEAVE)
  async handleQrLeave(@ConnectedSocket() client: Socket, @MessageBody() body: { tableId?: string }) {
    const tableId = body?.tableId ?? (client.data.qr as { tableId?: string } | undefined)?.tableId;
    if (!tableId) return { ok: false };
    await this.releaseQrGuest(client);
    return { ok: true };
  }

  // ---- API для сервисов ----

  emitToKitchen(event: string, payload: unknown) {
    this.server.to(ROOMS.KITCHEN).emit(event, payload);
  }

  emitToWaiter(waiterId: string | null | undefined, event: string, payload: unknown) {
    // QR-заказ может быть без официанта — тогда персональной комнаты нет.
    if (!waiterId) return;
    this.server.to(ROOMS.waiter(waiterId)).emit(event, payload);
  }

  emitToWaiters(event: string, payload: unknown) {
    this.server.to(ROOMS.WAITERS).emit(event, payload);
  }

  emitToAdmin(event: string, payload: unknown) {
    this.server.to(ROOMS.ADMIN).emit(event, payload);
  }

  emitToAdminOnly(event: string, payload: unknown) {
    this.server.to(ROOMS.ADMIN_ONLY).emit(event, payload);
  }

  /** Широковещательно (например, изменение статуса стола видят все). */
  emitBroadcast(event: string, payload: unknown) {
    this.server.emit(event, payload);
  }

  /** Всем гостям QR-меню конкретного стола. */
  emitToQrTable(tableId: string, event: string, payload: unknown) {
    this.server.to(ROOMS.qrTable(tableId)).emit(event, payload);
  }

  private presenceKey(tableId: string, guestKey: string) {
    return `${tableId}:${guestKey}`;
  }

  private async retainQrGuest(tableId: string, guestKey?: string) {
    if (!guestKey) return;
    const key = this.presenceKey(tableId, guestKey);
    this.qrPresence.set(key, (this.qrPresence.get(key) ?? 0) + 1);
    const session = await this.prisma.qrTableSession.findFirst({
      where: { tableId, status: 'draft', submittedOrderId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!session) return;
    await this.prisma.qrGuest.updateMany({
      where: { sessionId: session.id, guestKey },
      data: { isOnline: true, lastSeenAt: new Date() },
    });
  }

  private async releaseQrGuest(client: Socket, emit = true) {
    const qr = client.data.qr as { tableId: string; guestKey?: string } | undefined;
    if (!qr) return;
    client.leave(ROOMS.qrTable(qr.tableId));
    client.data.qr = undefined;

    if (qr.guestKey) {
      const key = this.presenceKey(qr.tableId, qr.guestKey);
      const next = Math.max(0, (this.qrPresence.get(key) ?? 1) - 1);
      if (next > 0) {
        this.qrPresence.set(key, next);
      } else {
        this.qrPresence.delete(key);
        const session = await this.prisma.qrTableSession.findFirst({
          where: { tableId: qr.tableId, status: 'draft', submittedOrderId: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (session) {
          await this.prisma.qrGuest.updateMany({
            where: { sessionId: session.id, guestKey: qr.guestKey },
            data: { isOnline: false, lastSeenAt: new Date() },
          });
        }
      }
    }

    if (emit) {
      this.server.to(ROOMS.qrTable(qr.tableId)).emit(SERVER_EVENTS.QR_GUEST_LEFT, {
        tableId: qr.tableId,
        guestKey: qr.guestKey,
      });
      await this.emitQrSessionSnapshot(qr.tableId);
    }
  }

  private async emitQrSessionSnapshot(tableId: string) {
    await this.cleanupExpiredOfflineGuestItems(tableId);

    const session = await this.prisma.qrTableSession.findFirst({
      where: { tableId, status: 'draft', submittedOrderId: null },
      orderBy: { createdAt: 'desc' },
      include: {
        table: { select: { number: true, hall: { select: { name: true } } } },
        guests: { orderBy: { createdAt: 'asc' } },
        items: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) return;

    const guests = session.guests
      .map((g) => {
        const isOnline = this.qrPresence.has(this.presenceKey(tableId, g.guestKey));
        return { id: g.id, guestLabel: g.guestLabel, isOnline };
      })
      .filter((g) => g.isOnline);
    const onlineGuestIds = new Set(guests.map((g) => g.id));
    const labelById = new Map(guests.map((g) => [g.id, g.guestLabel]));
    let total = 0;
    let count = 0;
    const items = session.items
      .filter((i) => onlineGuestIds.has(i.guestId))
      .map((i) => {
        const line = Number(i.snapshotPrice) * i.quantity;
        total += line;
        count += i.quantity;
        return {
          id: i.id,
          guestId: i.guestId,
          guestLabel: labelById.get(i.guestId) ?? 'Гость',
          dishId: i.dishId,
          variantId: i.variantId,
          name: i.snapshotName,
          variantName: i.variantName,
          quantity: i.quantity,
          price: String(i.snapshotPrice),
          lineTotal: String(round2(line)),
          comment: i.comment,
        };
      });

    this.server.to(ROOMS.qrTable(tableId)).emit(SERVER_EVENTS.QR_CART_UPDATED, {
      sessionId: session.id,
      status: session.status,
      table: { id: tableId, number: session.table.number, hall: session.table.hall?.name ?? null },
      guests,
      items,
      itemCount: count,
      activeGuestCount: guests.length,
      totalAmount: String(round2(total)),
      submittedOrderId: session.submittedOrderId,
    });
  }

  private async cleanupExpiredOfflineGuestItems(tableId?: string) {
    const cutoff = new Date(Date.now() - QR_OFFLINE_CART_TTL_MS);
    await this.prisma.qrSessionItem.deleteMany({
      where: {
        guest: {
          isOnline: false,
          lastSeenAt: { lt: cutoff },
          session: {
            status: 'draft',
            ...(tableId ? { tableId } : {}),
          },
        },
      },
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
