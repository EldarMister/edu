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
  STOP_TALK: 'ptt_stop_talk',
  CHANNEL_BUSY: 'ptt_channel_busy',
  CHANNEL_FREE: 'ptt_channel_free',
  AUDIO_MESSAGE: 'ptt_audio_message',
  AUDIO_FRAME: 'ptt_audio_frame',
  AUDIO_PACKET: 'ptt_audio_packet',
  TALK_DENIED: 'ptt_talk_denied',
  PRESENCE: 'ptt_presence',
} as const;

// Целый аудиофайл (Telegram-модель) заметно больше отдельного чанка —
// допускаем ~8 МБ base64, чего хватает на длинное голосовое сообщение.
const MAX_AUDIO_CHARS = 8_000_000;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
// Live frames contain 40 ms of mono, 16 kHz, signed 16-bit PCM.
const LIVE_FRAME_BYTES = 1280;
// A compact Opus packet has a 16-byte talk ID and one or two CBR 40 ms frames at 12 kbit/s.
const OPUS_HEADER_BYTES = 16;
const OPUS_FRAME_BYTES = 60;
const LIVE_IDLE_MS = 4000;
// TCP and the initial channel grant can deliver several seconds of queued frames together.
const FRAME_BURST = 110;
const FRAMES_PER_SECOND = 30;
const TALK_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

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
  startedAt: string;
  role: string;
  name?: string;
  live?: { id: string; opusHeader?: Buffer; frames: number; lastFrameAt: number; timeout: NodeJS.Timeout };
}

interface JoinBody {
  channel?: PttChannel | null;
}

interface TalkBody {
  channel?: PttChannel;
  talkId?: string;
  codec?: 'opus';
}

interface AudioFrameBody extends TalkBody {
  audio?: Buffer;
}

interface AudioMessageBody extends TalkBody {
  chunk?: string;
  mimeType?: string;
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

    if (!client.connected) return { ok: false, reason: 'disconnected' };
    const id = body?.talkId;
    if (id !== undefined && (typeof id !== 'string' || !TALK_ID.test(id))) {
      return { ok: false, reason: 'invalid_talk_id' };
    }

    const codec = body?.codec;
    if (codec !== undefined && (codec !== 'opus' || !id)) return { ok: false, reason: 'invalid_codec' };

    const key = this.lockKey(user.cafeId, channel);
    const current = this.findBlockingLock(user.cafeId, channel);
    if (current) {
      if (this.locks.get(key) === current && current.socketId === client.id
        && current.live?.id === id && (current.live?.opusHeader ? 'opus' : undefined) === codec) {
        return { ok: true, channel, talkId: id, codec };
      }
      return this.deny(client, channel, 'busy', current.userId);
    }

    const lock: TalkLock = {
      socketId: client.id, userId: user.id, role: user.role, name: user.name, startedAt: new Date().toISOString(),
    };
    if (id) {
      const timeout = setTimeout(() => {
        client.emit(PTT_EVENTS.TALK_DENIED, { channel, talkId: id, reason: 'audio_timeout' });
        this.releaseTalker(client, channel, id);
      }, LIVE_IDLE_MS);
      timeout.unref();
      const opusHeader = codec === 'opus' ? Buffer.from(id.replaceAll('-', ''), 'hex') : undefined;
      lock.live = { id, opusHeader, frames: FRAME_BURST, lastFrameAt: Date.now(), timeout };
    }
    this.locks.set(key, lock);
    this.server.to(this.broadcastRooms(user.cafeId, channel)).emit(PTT_EVENTS.CHANNEL_BUSY, this.talker(channel, lock));
    return { ok: true, channel, talkId: id, codec };
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_FRAME)
  handleAudioFrame(@ConnectedSocket() client: Socket, @MessageBody() body: AudioFrameBody) {
    const user = this.getCachedUser(client);
    const channel = body?.channel;
    if (!user || !this.isChannel(channel) || client.data.pttChannel !== channel) return;
    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    const live = lock?.live;
    const audio = body?.audio;
    if (!lock || !live || live.opusHeader || lock.socketId !== client.id || live.id !== body?.talkId
      || !Buffer.isBuffer(audio) || audio.length !== LIVE_FRAME_BYTES) return;
    if (!this.acceptFrames(client, channel, live, 1)) return;
    client.to(this.broadcastRooms(user.cafeId, channel)).emit(PTT_EVENTS.AUDIO_FRAME, {
      channel, talkId: live.id, audio, senderId: user.id, senderName: user.name, senderRole: user.role,
    });
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_PACKET)
  handleAudioPacket(@ConnectedSocket() client: Socket, @MessageBody() packet: unknown) {
    const user = this.getCachedUser(client);
    const channel = client.data.pttChannel;
    if (!user || !this.isChannel(channel) || !Buffer.isBuffer(packet)) return;
    const count = (packet.length - OPUS_HEADER_BYTES) / OPUS_FRAME_BYTES;
    if (count !== 1 && count !== 2) return;
    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    const live = lock?.live;
    if (!lock || !live?.opusHeader || lock.socketId !== client.id
      || !live.opusHeader.equals(packet.subarray(0, OPUS_HEADER_BYTES))) return;
    if (!this.acceptFrames(client, channel, live, count)) return;
    client.to(this.broadcastRooms(user.cafeId, channel)).emit(PTT_EVENTS.AUDIO_PACKET, packet);
  }

  private acceptFrames(client: Socket, channel: PttChannel, live: NonNullable<TalkLock['live']>, count: number) {
    const now = Date.now();
    live.frames = Math.min(FRAME_BURST, live.frames + Math.max(0, now - live.lastFrameAt) * FRAMES_PER_SECOND / 1000);
    live.lastFrameAt = now;
    if (live.frames < count) {
      client.emit(PTT_EVENTS.TALK_DENIED, { channel, talkId: live.id, reason: 'audio_backlog' });
      this.releaseTalker(client, channel, live.id);
      return false;
    }
    live.frames -= count;
    live.timeout.refresh();
    return true;
  }

  private talker(channel: PttChannel, lock: TalkLock) {
    return {
      channel, talkId: lock.live?.id, codec: lock.live?.opusHeader ? 'opus' : undefined,
      speaker: { id: lock.userId, role: lock.role, name: lock.name }, startedAt: lock.startedAt,
    };
  }

  @SubscribeMessage(PTT_EVENTS.AUDIO_MESSAGE)
  async handleAudioMessage(@ConnectedSocket() client: Socket, @MessageBody() body: AudioMessageBody) {
    const user = await this.getUser(client);
    if (!user) return this.deny(client, body?.channel, 'unauthorized');

    const channel = await this.resolveChannel(client, user, body, false);
    if (!channel) return this.deny(client, undefined, 'not_in_channel');

    const lock = this.locks.get(this.lockKey(user.cafeId, channel));
    if (!lock || lock.socketId !== client.id) {
      return this.deny(client, channel, lock ? 'busy' : 'not_talker', lock?.userId);
    }

    if (lock.live) return { ok: false, reason: 'invalid_audio' };
    const chunk = body?.chunk;
    if (!this.isValidAudio(chunk)) return { ok: false, reason: 'invalid_audio' };

    // Telegram-модель: получили цельный base64-файл. Обычные каналы слышит
    // только своя комната, а канал «Все» транслируется во все PTT-комнаты кафе.
    client.to(this.broadcastRooms(user.cafeId, channel)).emit(PTT_EVENTS.AUDIO_MESSAGE, {
      channel,
      senderId: user.id,
      senderRole: user.role,
      senderName: user.name,
      mimeType: typeof body.mimeType === 'string' ? body.mimeType.slice(0, 80) : 'application/octet-stream',
      chunk,
      sentAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  @SubscribeMessage(PTT_EVENTS.STOP_TALK)
  async handleStopTalk(@ConnectedSocket() client: Socket, @MessageBody() body: TalkBody) {
    const user = await this.getUser(client);
    const channel = user ? await this.resolveChannel(client, user, body, false) : null;
    this.releaseTalker(client, channel, body?.talkId ?? null);
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
    const general = this.locks.get(this.lockKey(user.cafeId, 'general'));
    const active = general ?? this.locks.get(this.lockKey(user.cafeId, nextChannel));
    if (active?.live?.opusHeader) {
      client.emit(PTT_EVENTS.CHANNEL_BUSY, this.talker(general ? 'general' : nextChannel, active));
    }
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

  private releaseTalker(client: Socket, preferredChannel?: PttChannel | null, expectedTalkId?: string | null) {
    const user = this.getCachedUser(client);
    if (!user) return;
    const channels = preferredChannel ? [preferredChannel] : PTT_CHANNELS;
    for (const channel of channels) {
      const key = this.lockKey(user.cafeId, channel);
      const lock = this.locks.get(key);
      if (!lock || lock.socketId !== client.id) continue;
      if (expectedTalkId !== undefined && (lock.live?.id ?? null) !== expectedTalkId) continue;
      if (lock.live) clearTimeout(lock.live.timeout);
      this.locks.delete(key);
      this.server.to(this.broadcastRooms(user.cafeId, channel)).emit(PTT_EVENTS.CHANNEL_FREE, {
        channel, talkId: lock.live?.id,
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

  private isValidAudio(chunk: unknown): chunk is string {
    return (
      typeof chunk === 'string' &&
      chunk.length > 0 &&
      chunk.length <= MAX_AUDIO_CHARS &&
      BASE64_RE.test(chunk)
    );
  }

  private findBlockingLock(cafeId: string, channel: PttChannel): TalkLock | undefined {
    if (channel === 'general') {
      for (const candidate of PTT_CHANNELS) {
        const lock = this.locks.get(this.lockKey(cafeId, candidate));
        if (lock) return lock;
      }
      return undefined;
    }
    return this.locks.get(this.lockKey(cafeId, 'general')) ?? this.locks.get(this.lockKey(cafeId, channel));
  }

  private broadcastRooms(cafeId: string, channel: PttChannel) {
    return channel === 'general'
      ? PTT_CHANNELS.map((candidate) => this.room(cafeId, candidate))
      : this.room(cafeId, channel);
  }

  private room(cafeId: string, channel: PttChannel) {
    return `restaurant_${cafeId}_${channel}`;
  }

  private lockKey(cafeId: string, channel: PttChannel) {
    return `${cafeId}:${channel}`;
  }
}
