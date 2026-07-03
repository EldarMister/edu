import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { getJwtAccessSecret } from '../auth/jwt.config';
import { PrismaService } from '../prisma/prisma.service';
import { assertCafeActive } from '../platform/cafe-status';

const PTT_CHANNELS = ['general', 'waiters', 'kitchen', 'admin'] as const;
type PttChannel = (typeof PTT_CHANNELS)[number];

const PTT_EVENTS = {
  JOIN: 'ptt_join',
  START_TALK: 'ptt_start_talk',
  CHUNK: 'ptt_chunk',
  STOP_TALK: 'ptt_stop_talk',
  CHANNEL_BUSY: 'ptt_channel_busy',
  CHANNEL_FREE: 'ptt_channel_free',
  AUDIO_STREAM: 'ptt_audio_stream',
  TALK_DENIED: 'ptt_talk_denied',
  PRESENCE: 'ptt_presence',
} as const;

const MAX_CHUNK_CHARS = 512_000;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

interface SocketUser {
  id: string;
  role: string;
  name?: string;
  cafeId: string | null;
}

type AuthenticatedSocketUser = SocketUser & { cafeId: string };

interface TalkLock {
  socketId: string;
  userId: string;
  role: string;
  name?: string;
}

interface JoinBody {
  channel?: PttChannel | null;
}

interface TalkBody {
  channel?: PttChannel;
}

interface ChunkBody extends TalkBody {
  chunk?: string;
  mimeType?: string;
  seq?: number;
}

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    credentials: true,
  },
})
export class PttGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('PttGateway');
  private readonly locks = new Map<string, TalkLock>();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  handleDisconnect(client: Socket) {
    const channel = client.data.pttChannel as PttChannel | undefined;
    this.releaseTalker(client);
    if (channel) {
      void this.emitPresence(client, channel);
    }
  }

  @SubscribeMessage(PTT_EVENTS.JOIN)
  async handleJoin(@ConnectedSocket() client: Socket, @MessageBody() body: JoinBody) {
    const user = await this.getUser(client);
    if (!user) return this.deny(client, undefined, 'unauthorized');

    const nextChannel = body?.channel ?? null;
    if (nextChannel === null) {
      this.releaseTalker(client);
      this.leaveCurrentChannel(client);
      return { ok: true, channel: null };
    }
    if (!this.isChannel(nextChannel)) return this.deny(client, undefined, 'invalid_channel');

    const onlineCount = await this.joinChannel(client, user, nextChannel);
    return { ok: true, channel: nextChannel, onlineCount };
  }

  @SubscribeMessage(PTT_EVENTS.START_TALK)
  async handleStartTalk(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody) {
    const user = await this.getUser(client);
    if (!user) return this.deny(client, body?.channel, 'unauthorized');

    const channel = await this.resolveChannel(client, user, body, true);
    if (!channel) return this.deny(client, undefined, 'not_in_channel');

    const key = this.lockKey(user.cafeId, channel);
    const current = this.locks.get(key);
    if (current && current.socketId !== client.id) {
      return this.deny(client, channel, 'busy', current.userId);
    }

    const lock: TalkLock = { socketId: client.id, userId: user.id, role: user.role, name: user.name };
    this.locks.set(key, lock);
    this.server.to(this.room(user.cafeId, channel)).emit(PTT_EVENTS.CHANNEL_BUSY, {
      channel,
      speaker: { id: user.id, role: user.role, name: user.name },
      startedAt: new Date().toISOString(),
    });
    return { ok: true, channel };
  }

  @SubscribeMessage(PTT_EVENTS.CHUNK)
  async handleChunk(@ConnectedSocket() client: Socket, @MessageBody() body: ChunkBody) {
    const user = await this.getUser(client);
    if (!user) return this.deny(client, body?.channel, 'unauthorized');

    const channel = await this.resolveChannel(client, user, body, false);
    if (!channel) return this.deny(client, undefined, 'not_in_channel');

    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    if (!lock || lock.socketId !== client.id) {
      return this.deny(client, channel, lock ? 'busy' : 'not_talker', lock?.userId);
    }

    const chunk = body?.chunk;
    if (!this.isValidChunk(chunk)) return { ok: false, reason: 'invalid_chunk' };

    client.to(this.room(user.cafeId, channel)).emit(PTT_EVENTS.AUDIO_STREAM, {
      channel,
      senderId: user.id,
      senderRole: user.role,
      senderName: user.name,
      mimeType: typeof body.mimeType === 'string' ? body.mimeType.slice(0, 80) : 'application/octet-stream',
      seq: Number.isFinite(body.seq) ? body.seq : undefined,
      chunk,
      sentAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  @SubscribeMessage(PTT_EVENTS.STOP_TALK)
  async handleStopTalk(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody) {
    const user = await this.getUser(client);
    const channel = user ? await this.resolveChannel(client, user, body, false) : null;
    this.releaseTalker(client, channel);
    return { ok: true };
  }

  private getCachedUser(client: Socket): AuthenticatedSocketUser | null {
    const user = client.data.user as SocketUser | undefined;
    if (!user?.id || !user.role || !user.cafeId) return null;
    return user as AuthenticatedSocketUser;
  }

  private async resolveChannel(
    client: Socket,
    user: AuthenticatedSocketUser,
    body: TalkBody | undefined,
    autoJoin: boolean,
  ): Promise<PttChannel | null> {
    const bodyChannel = body?.channel;
    const joinedChannel = client.data.pttChannel as PttChannel | undefined;
    if (bodyChannel && this.isChannel(bodyChannel) && bodyChannel === joinedChannel) return bodyChannel;
    if (!bodyChannel && joinedChannel && this.isChannel(joinedChannel)) return joinedChannel;
    if (autoJoin && bodyChannel && this.isChannel(bodyChannel)) {
      await this.joinChannel(client, user, bodyChannel);
      return bodyChannel;
    }
    return null;
  }

  private async joinChannel(
    client: Socket,
    user: AuthenticatedSocketUser,
    nextChannel: PttChannel,
  ): Promise<number> {
    const previous = client.data.pttChannel as PttChannel | undefined;
    if (previous && previous !== nextChannel) {
      this.releaseTalker(client);
      client.leave(this.room(user.cafeId, previous));
      client.data.pttChannel = undefined;
      await this.emitPresenceFor(user.cafeId, previous);
    }

    const room = this.room(user.cafeId, nextChannel);
    client.join(room);
    client.data.pttChannel = nextChannel;
    return this.emitPresenceFor(user.cafeId, nextChannel);
  }

  private leaveCurrentChannel(client: Socket) {
    const user = this.getCachedUser(client);
    const channel = client.data.pttChannel as PttChannel | undefined;
    if (!user || !channel) return;
    client.leave(this.room(user.cafeId, channel));
    client.data.pttChannel = undefined;
    void this.emitPresence(client, channel);
  }

  private releaseTalker(client: Socket, preferredChannel?: PttChannel | null) {
    const user = this.getCachedUser(client);
    if (!user) return;
    const channels = preferredChannel ? [preferredChannel] : PTT_CHANNELS;
    for (const channel of channels) {
      const key = this.lockKey(user.cafeId, channel);
      const lock = this.locks.get(key);
      if (!lock || lock.socketId !== client.id) continue;
      this.locks.delete(key);
      this.server.to(this.room(user.cafeId, channel)).emit(PTT_EVENTS.CHANNEL_FREE, {
        channel,
        speakerId: user.id,
        freedAt: new Date().toISOString(),
      });
    }
  }

  private async emitPresence(client: Socket, channel: PttChannel): Promise<number> {
    const user = this.getCachedUser(client);
    if (!user) return 0;
    return this.emitPresenceFor(user.cafeId, channel);
  }

  private async emitPresenceFor(cafeId: string, channel: PttChannel): Promise<number> {
    const room = this.room(cafeId, channel);
    const sockets = await this.server.in(room).fetchSockets();
    const uniqueUsers = new Set<string>();
    for (const socket of sockets) {
      const socketUser = socket.data.user as SocketUser | undefined;
      if (socketUser?.id && socketUser.cafeId === cafeId) uniqueUsers.add(socketUser.id);
    }
    const onlineCount = uniqueUsers.size;
    this.server.to(room).emit(PTT_EVENTS.PRESENCE, { channel, onlineCount });
    return onlineCount;
  }

  private async hydrateUserFromToken(client: Socket): Promise<AuthenticatedSocketUser | null> {
    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '');
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, {
        secret: getJwtAccessSecret(),
      });
      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, name: true, cafeId: true, isActive: true },
      });
      if (!dbUser?.isActive || !dbUser.cafeId) return null;
      await assertCafeActive(this.prisma, dbUser.cafeId);
      const user: AuthenticatedSocketUser = {
        id: dbUser.id,
        role: dbUser.role,
        name: dbUser.name,
        cafeId: dbUser.cafeId,
      };
      client.data.user = user;
      return user;
    } catch {
      return null;
    }
  }

  private async getUser(client: Socket): Promise<AuthenticatedSocketUser | null> {
    const cached = this.getCachedUser(client);
    if (cached) return cached;
    return this.hydrateUserFromToken(client);
  }

  private deny(client: Socket, channel: PttChannel | undefined, reason: string, speakerId?: string) {
    client.emit(PTT_EVENTS.TALK_DENIED, { channel, reason, speakerId });
    if (reason !== 'busy') {
      this.logger.warn(`PTT denied ${client.id}: ${reason}`);
    }
    return { ok: false, reason, speakerId };
  }

  private isChannel(value: unknown): value is PttChannel {
    return typeof value === 'string' && PTT_CHANNELS.includes(value as PttChannel);
  }

  private isValidChunk(chunk: unknown): chunk is string {
    return (
      typeof chunk === 'string' &&
      chunk.length > 0 &&
      chunk.length <= MAX_CHUNK_CHARS &&
      BASE64_RE.test(chunk)
    );
  }

  private room(cafeId: string, channel: PttChannel) {
    return `restaurant_${cafeId}_${channel}`;
  }

  private lockKey(cafeId: string, channel: PttChannel) {
    return `${cafeId}:${channel}`;
  }
}
