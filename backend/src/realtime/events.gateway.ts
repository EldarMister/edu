import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ROOMS, SERVER_EVENTS, QR_CLIENT_EVENTS } from './events';
import { getJwtAccessSecret } from '../auth/jwt.config';

interface SocketUser {
  id: string;
  role: string;
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
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('EventsGateway');

  constructor(private readonly jwt: JwtService) {}

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
      const user: SocketUser = { id: payload.sub, role: payload.role };
      client.data.user = user;

      if (user.role === 'KITCHEN' || user.role === 'BAR') {
        // Бар получает ту же ленту, что и кухня; экран фильтрует позиции по станции.
        client.join(ROOMS.KITCHEN);
      } else if (user.role === 'WAITER') {
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

  handleDisconnect(client: Socket) {
    const user = client.data.user as SocketUser | undefined;
    if (user) {
      this.logger.log(`Disconnected: ${user.role} ${user.id}`);
    }
    // Гость QR-меню вышел — сообщим столу, чтобы обновили счётчик/онлайн.
    const qr = client.data.qr as { tableId: string; guestKey?: string } | undefined;
    if (qr) {
      this.server.to(ROOMS.qrTable(qr.tableId)).emit(SERVER_EVENTS.QR_GUEST_LEFT, {
        tableId: qr.tableId,
        guestKey: qr.guestKey,
      });
    }
  }

  /** Гость QR-меню входит в комнату своего стола (tableId получен из публичного /menu). */
  @SubscribeMessage(QR_CLIENT_EVENTS.JOIN)
  handleQrJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { tableId?: string; guestKey?: string },
  ) {
    const tableId = body?.tableId;
    if (!tableId) return { ok: false };
    client.join(ROOMS.qrTable(tableId));
    client.data.qr = { tableId, guestKey: body.guestKey };
    this.server.to(ROOMS.qrTable(tableId)).emit(SERVER_EVENTS.QR_GUEST_JOINED, {
      tableId,
      guestKey: body.guestKey,
    });
    return { ok: true };
  }

  /** Гость покидает комнату стола. */
  @SubscribeMessage(QR_CLIENT_EVENTS.LEAVE)
  handleQrLeave(@ConnectedSocket() client: Socket, @MessageBody() body: { tableId?: string }) {
    const tableId = body?.tableId ?? (client.data.qr as { tableId?: string } | undefined)?.tableId;
    if (!tableId) return { ok: false };
    client.leave(ROOMS.qrTable(tableId));
    this.server.to(ROOMS.qrTable(tableId)).emit(SERVER_EVENTS.QR_GUEST_LEFT, {
      tableId,
      guestKey: (client.data.qr as { guestKey?: string } | undefined)?.guestKey,
    });
    client.data.qr = undefined;
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
}
