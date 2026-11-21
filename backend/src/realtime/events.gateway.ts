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
import { Prisma } from '@prisma/client';
import { ROOMS, SERVER_EVENTS, QR_CLIENT_EVENTS } from './events';
import { getJwtAccessSecret } from '../auth/jwt.config';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId, runWithTenant } from '../tenant/tenant-context';
import { assertCafeActive } from '../platform/cafe-status';
import { resolveUserPermissions } from '../common/permissions';
import { projectWorkspaceUser } from '../common/workspace-access';
import type { AuthUser } from '../common/decorators/current-user.decorator';

const QR_OFFLINE_CART_TTL_MS = 60 * 60 * 1000;
const QR_OFFLINE_CART_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const STAFF_ACCESS_CHECK_INTERVAL_MS = 30_000;
const socketUserSelect = { id: true, role: true, name: true, phone: true, cafeId: true, isActive: true,
  prepStation: true, positionId: true, permissions: true, position: { select: { role: true, permissions: true, isStarter: true } } } satisfies Prisma.UserSelect;
type SocketEmployee = Prisma.UserGetPayload<{ select: typeof socketUserSelect }>;

function socketActor(user: SocketEmployee, workspace?: unknown) {
  return projectWorkspaceUser({ id: user.id, role: user.role, name: user.name, phone: user.phone,
    cafeId: user.cafeId, prepStation: user.prepStation, positionId: user.positionId,
    permissions: resolveUserPermissions(user) }, workspace);
}

function socketAccessFingerprint(user: AuthUser) {
  return JSON.stringify({ cafeId: user.cafeId, identityRole: user.identityRole, role: user.role,
    workspace: user.workspace, prepStation: user.prepStation, positionId: user.positionId,
    access: user.access, permissions: user.permissions });
}

interface SocketUser {
  id: string;
  role: string;
  name: string;
  cafeId: string | null;
}

/**
 * Единый шлюз реального времени.
 * Клиент с JWT получает события в комнатах своего кафе и своей роли.
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
  private accessTimer?: NodeJS.Timeout;
  private checkingAccess = false;

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
    this.accessTimer = setInterval(() => {
      void this.revalidateStaffConnections().catch((error: unknown) => this.logger.error('Failed to revalidate staff socket access', error));
    }, STAFF_ACCESS_CHECK_INTERVAL_MS);
    this.accessTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.accessTimer) clearInterval(this.accessTimer);
  }

  /** One batched lookup per interval, regardless of the number of devices per employee. */
  async revalidateStaffConnections() {
    if (this.checkingAccess || !this.server?.sockets?.sockets) return;
    const clients = [...this.server.sockets.sockets.values()].filter((client) => client.data.user);
    if (!clients.length) return;
    this.checkingAccess = true;
    try {
      const ids = [...new Set(clients.map((client) => (client.data.user as SocketUser).id))];
      const users = await runWithTenant({}, async () => await this.prisma.user.findMany({ where: { id: { in: ids } }, select: socketUserSelect }));
      const byId = new Map(users.map((user) => [user.id, user]));
      for (const client of clients) {
        const before = client.data.user as AuthUser;
        const employee = byId.get(before.id);
        try {
          if (!employee?.isActive || socketAccessFingerprint(socketActor(employee, before.workspace)) !== client.data.accessFingerprint) {
            client.disconnect(true);
          }
        } catch { client.disconnect(true); }
      }
    } finally { this.checkingAccess = false; }
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
        select: socketUserSelect,
      });
      if (!dbUser || !dbUser.isActive) {
        client.disconnect(true);
        return;
      }
      await assertCafeActive(this.prisma, dbUser.cafeId);

      const user = socketActor(dbUser, client.handshake.auth?.workspace);
      client.data.user = user;
      client.data.accessFingerprint = socketAccessFingerprint(user);
      client.join(ROOMS.cafeStaff(user.cafeId));
      // The legacy personal room also carries work-time updates for kitchen, bar and management.
      client.join(ROOMS.waiter(user.id));

      if (user.role === 'KITCHEN' || user.role === 'BAR') {
        // Бар получает ту же ленту, что и кухня; экран фильтрует позиции по станции.
        client.join(ROOMS.cafeKitchen(user.cafeId));
      } else if (user.role === 'WAITER') {
        client.join(ROOMS.cafeWaiters(user.cafeId));
        if (user.permissions.actions.printReceipts && user.permissions.ownerOperations?.printRequests !== false) {
          client.join(ROOMS.cafeReceiptPrinters(user.cafeId));
        }
      } else if (user.role === 'ADMIN' || user.role === 'OWNER') {
        const { orders, staff, checks } = user.permissions.sections;
        if (orders || staff || checks) client.join(ROOMS.cafeManagement(user.cafeId));
        if (orders) client.join(ROOMS.cafeKitchen(user.cafeId));
        if (user.role === 'ADMIN') {
          client.join(ROOMS.cafeAdmins(user.cafeId));
        }
        if (checks && user.permissions.ownerOperations?.printRequests !== false) client.join(ROOMS.cafeReceiptPrinters(user.cafeId));
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
    @MessageBody() body: { tableId?: string; guestKey?: string; tableToken?: string },
  ) {
    const tableId = body?.tableId;
    const guestKey = body?.guestKey;
    if (typeof tableId !== 'string' || typeof guestKey !== 'string' || !tableId || !guestKey) return { ok: false };
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, isActive: true },
      select: { cafeId: true, qrToken: true },
    });
    if (!table) return { ok: false };
    if (body.tableToken !== table.qrToken) {
      const lastVisit = await this.prisma.qrTableSession.findFirst({
        where: { tableId },
        orderBy: { createdAt: 'desc' },
        select: { guests: { where: { guestKey }, select: { id: true }, take: 1 } },
      });
      if (!lastVisit?.guests.length) return { ok: false };
    }
    try {
      await assertCafeActive(this.prisma, table.cafeId);
    } catch {
      return { ok: false };
    }
    if (client.data.qr) await this.releaseQrGuest(client, false);
    client.join(ROOMS.qrTable(tableId));
    client.data.qr = { tableId, guestKey };
    await this.retainQrGuest(tableId, guestKey);
    this.server.to(ROOMS.qrTable(tableId)).emit(SERVER_EVENTS.QR_GUEST_JOINED, { tableId });
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

  private cafeFor(payload: unknown) {
    const explicitCafe = payload && typeof payload === 'object' && 'cafeId' in payload ? payload.cafeId : undefined;
    return typeof explicitCafe === 'string' || explicitCafe === null ? explicitCafe : getCafeId();
  }

  emitToKitchen(event: string, payload: unknown) {
    this.server.to(ROOMS.cafeKitchen(this.cafeFor(payload))).emit(event, payload);
  }

  emitToWaiter(waiterId: string | null | undefined, event: string, payload: unknown) {
    // QR-заказ может быть без официанта — тогда персональной комнаты нет.
    if (!waiterId) return;
    this.server.to(ROOMS.waiter(waiterId)).emit(event, payload);
  }

  emitToWaiters(event: string, payload: unknown) {
    this.server.to(ROOMS.cafeWaiters(this.cafeFor(payload))).emit(event, payload);
  }

  emitToAdmin(event: string, payload: unknown) {
    this.server.to(ROOMS.cafeManagement(this.cafeFor(payload))).emit(event, payload);
  }

  emitToReceiptPrinters(event: string, payload: unknown) {
    this.server.to(ROOMS.cafeReceiptPrinters(this.cafeFor(payload))).emit(event, payload);
  }

  emitToCafeAdmins(cafeId: string | null | undefined, event: string, payload: unknown) {
    if (!cafeId) return;
    this.server.to(ROOMS.cafeAdmins(cafeId)).emit(event, payload);
  }

  /** События стола, меню и настроек получают только сотрудники кафе. */
  emitBroadcast(event: string, payload: unknown) {
    this.server.to(ROOMS.cafeStaff(this.cafeFor(payload))).emit(event, payload);
  }

  /** Плановое обновление рейтинга затрагивает меню всех заведений. */
  emitPopularityRefresh() {
    this.server.emit(SERVER_EVENTS.MENU_UPDATED, { source: 'dish-popularity-cron' });
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
      this.server.to(ROOMS.qrTable(qr.tableId)).emit(SERVER_EVENTS.QR_GUEST_LEFT, { tableId: qr.tableId });
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
