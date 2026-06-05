import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ROOMS } from './events';

interface SocketUser {
  id: string;
  role: string;
}

/**
 * Единый шлюз реального времени.
 * Клиент подключается с JWT в auth.token; по роли его добавляют в нужные комнаты:
 *  - кухня → ROOMS.KITCHEN
 *  - официант → персональная комната waiter:<id>
 *  - админ/владелец → ROOMS.ADMIN (на будущее)
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
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'change-me-access-secret',
      });
      const user: SocketUser = { id: payload.sub, role: payload.role };
      client.data.user = user;

      if (user.role === 'KITCHEN') {
        client.join(ROOMS.KITCHEN);
      } else if (user.role === 'WAITER') {
        client.join(ROOMS.waiter(user.id));
      } else if (user.role === 'ADMIN' || user.role === 'OWNER') {
        client.join(ROOMS.ADMIN);
        client.join(ROOMS.KITCHEN); // админ видит и кухонную ленту
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
  }

  // ---- API для сервисов ----

  emitToKitchen(event: string, payload: unknown) {
    this.server.to(ROOMS.KITCHEN).emit(event, payload);
  }

  emitToWaiter(waiterId: string, event: string, payload: unknown) {
    this.server.to(ROOMS.waiter(waiterId)).emit(event, payload);
  }

  emitToAdmin(event: string, payload: unknown) {
    this.server.to(ROOMS.ADMIN).emit(event, payload);
  }

  /** Широковещательно (например, изменение статуса стола видят все). */
  emitBroadcast(event: string, payload: unknown) {
    this.server.emit(event, payload);
  }
}
